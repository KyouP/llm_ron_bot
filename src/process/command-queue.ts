import { diagnosticLogger as diag, logLaneDequeue, logLaneEnqueue } from "../logging/diagnostic.js";
import { CommandLane } from "./lanes.js";

// Minimal in-process queue to serialize command executions.
// Default lane ("main") preserves the existing behavior. Additional lanes allow
// low-risk parallelism (e.g. cron jobs) without interleaving stdin / logs for
// the main auto-reply workflow.
// 最小化进程内队列，用于序列化命令执行。
// 默认通道（“主通道”）保持现有行为。额外的通道允许低风险并行处理（如定时任务），
// 同时避免与主自动回复工作流的输入/输出日志发生交错。

type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  warnAfterMs: number;
  onWait?: (waitMs: number, queuedAhead: number) => void;
};

type LaneState = {
  lane: string;
  queue: QueueEntry[];
  active: number;
  maxConcurrent: number;
  draining: boolean;
};

const lanes = new Map<string, LaneState>();

function getLaneState(lane: string): LaneState {
  const existing = lanes.get(lane);
  if (existing) {
    return existing;
  }
  const created: LaneState = {
    lane,
    queue: [],
    active: 0,
    maxConcurrent: 1,
    draining: false,
  };
  lanes.set(lane, created);
  return created;
}

/**
 * 处理指定队列的任务队列
 * 
 * 该函数是队列并发控制的核心执行器。它会在不超过最大并发数的前提下，
 * 持续从队列中取出待执行任务并异步执行。执行完毕后自动调度下一个任务。
 * 该函数是可重入的，通过 `state.draining` 标志防止重复调用。
 * 
 * @param lane - 队列标识符
 */
function drainLane(lane: string) {
  const state = getLaneState(lane);
  // 避免重复进入队列循环
  if (state.draining) {
    return;
  }
  state.draining = true;

  /**
   * 任务泵：只要还有并发容量且队列非空，就取出任务执行
   */
  const pump = () => {
    while (state.active < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift() as QueueEntry;   // 从队首取出待执行任务
      const waitedMs = Date.now() - entry.enqueuedAt;    // 任务已等待时长

      // 若等待时间超过阈值，触发警告回调并记录诊断日志
      if (waitedMs >= entry.warnAfterMs) {
        entry.onWait?.(waitedMs, state.queue.length);
        diag.warn(
          `lane wait exceeded: lane=${lane} waitedMs=${waitedMs} queueAhead=${state.queue.length}`,
        );
      }

      // 记录任务出队信息（用于监控）
      logLaneDequeue(lane, waitedMs, state.queue.length);

      // 增加活动任务计数，并异步执行任务
      state.active += 1;
      void (async () => {
        const startTime = Date.now();
        try {
          const result = await entry.task();   // 执行实际任务
          state.active -= 1;
          diag.debug(
            `lane task done: lane=${lane} durationMs=${Date.now() - startTime} active=${state.active} queued=${state.queue.length}`,
          );
          pump();   // 任务完成，尝试继续处理后续任务
          entry.resolve(result);   // 将结果返回给调用方
        } catch (err) {
          state.active -= 1;
          // 某些探测性质的队列（如认证探测、会话探测）错误无须记录为错误日志，避免无用数据
          const isProbeLane = lane.startsWith("auth-probe:") || lane.startsWith("session:probe-");
          if (!isProbeLane) {
            diag.error(
              `lane task error: lane=${lane} durationMs=${Date.now() - startTime} error="${String(err)}"`,
            );
          }
          pump();   // 即使任务失败，仍可继续处理后续任务
          entry.reject(err);   // 将错误传递回调用方
        }
      })();
    }
    // 当队列为空或已达到并发上限时，结束队列状态
    state.draining = false;
  };

  pump();
}

/**
 * 设置指定命令队列的最大并发数
 * 
 * 每个命令队列维护一个任务队列和当前活动任务计数。该方法调整命令队列的并发上限，
 * 并触发命令队列操作（如果尚未处理或处理被挂起）。
 * 
 * @param lane - 命令队列标识符（若为空则使用主车道 CommandLane.Main）
 * @param maxConcurrent - 期望的最大并发任务数，将向下取整并确保至少为1
 */
export function setCommandLaneConcurrency(lane: string, maxConcurrent: number) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = getLaneState(cleaned);
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  drainLane(cleaned);
}

export function enqueueCommandInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  },
): Promise<T> {
  const cleaned = lane.trim() || CommandLane.Main;
  const warnAfterMs = opts?.warnAfterMs ?? 2_000;
  const state = getLaneState(cleaned);
  return new Promise<T>((resolve, reject) => {
    state.queue.push({
      task: () => task(),
      resolve: (value) => resolve(value as T),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      onWait: opts?.onWait,
    });
    logLaneEnqueue(cleaned, state.queue.length + state.active);
    drainLane(cleaned);
  });
}

export function enqueueCommand<T>(
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  },
): Promise<T> {
  return enqueueCommandInLane(CommandLane.Main, task, opts);
}

export function getQueueSize(lane: string = CommandLane.Main) {
  const resolved = lane.trim() || CommandLane.Main;
  const state = lanes.get(resolved);
  if (!state) {
    return 0;
  }
  return state.queue.length + state.active;
}

export function getTotalQueueSize() {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.queue.length + s.active;
  }
  return total;
}

export function clearCommandLane(lane: string = CommandLane.Main) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = lanes.get(cleaned);
  if (!state) {
    return 0;
  }
  const removed = state.queue.length;
  state.queue.length = 0;
  return removed;
}
