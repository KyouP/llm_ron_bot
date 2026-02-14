import { diagnosticLogger as diag, logLaneDequeue, logLaneEnqueue } from "../logging/diagnostic.js";
import { CommandLane } from "./lanes.js";
/**
 * Dedicated error type thrown when a queued command is rejected because
 * its lane was cleared.  Callers that fire-and-forget enqueued tasks can
 * catch (or ignore) this specific type to avoid unhandled-rejection noise.
 * 
 * 当队列命令因其所属通道被清除而被拒绝时抛出的专用错误类型。
 * 采用即发即弃方式处理入队任务的调用方可以捕获（或忽略）此特定类型，
 * 以避免产生未处理的拒绝噪声。
 */
export class CommandLaneClearedError extends Error {
  constructor(lane?: string) {
    super(lane ? `Command lane "${lane}" cleared` : "Command lane cleared");
    this.name = "CommandLaneClearedError";
  }
}

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
  activeTaskIds: Set<number>;
  maxConcurrent: number;
  draining: boolean;
  generation: number;
};

const lanes = new Map<string, LaneState>();
let nextTaskId = 1;

function getLaneState(lane: string): LaneState {
  const existing = lanes.get(lane);
  if (existing) {
    return existing;
  }
  const created: LaneState = {
    lane,
    queue: [],
    activeTaskIds: new Set(),
    maxConcurrent: 1,
    draining: false,
    generation: 0,
  };
  lanes.set(lane, created);
  return created;
}

function completeTask(state: LaneState, taskId: number, taskGeneration: number): boolean {
  if (taskGeneration !== state.generation) {
    return false;
  }
  state.activeTaskIds.delete(taskId);
  return true;
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
    while (state.activeTaskIds.size < state.maxConcurrent && state.queue.length > 0) {
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
      const taskId = nextTaskId++;
      const taskGeneration = state.generation;
      // 增加活动任务计数，并异步执行任务
      state.activeTaskIds.add(taskId);
      void (async () => {
        const startTime = Date.now();
        try {
          const result = await entry.task();   // 执行实际任务
          const completedCurrentGeneration = completeTask(state, taskId, taskGeneration);
          if (completedCurrentGeneration) {
            diag.debug(
              `lane task done: lane=${lane} durationMs=${Date.now() - startTime} active=${state.activeTaskIds.size} queued=${state.queue.length}`,
            );
            pump();   // 任务完成，尝试继续处理后续任务
          }
          entry.resolve(result);   // 将结果返回给调用方
        } catch (err) {
          const completedCurrentGeneration = completeTask(state, taskId, taskGeneration);
          // 某些探测性质的队列（如认证探测、会话探测）错误无须记录为错误日志，避免无用数据干扰诊断。
          const isProbeLane = lane.startsWith("auth-probe:") || lane.startsWith("session:probe-");
          if (!isProbeLane) {
            diag.error(
              `lane task error: lane=${lane} durationMs=${Date.now() - startTime} error="${String(err)}"`,
            );
          }
          if (completedCurrentGeneration) {
            pump();   // 即使任务失败，仍可继续处理后续任务
          }
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
    logLaneEnqueue(cleaned, state.queue.length + state.activeTaskIds.size);
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
  return state.queue.length + state.activeTaskIds.size;
}

export function getTotalQueueSize() {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.queue.length + s.activeTaskIds.size;
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
  const pending = state.queue.splice(0);
  for (const entry of pending) {
    entry.reject(new CommandLaneClearedError(cleaned));
  }
  return removed;
}

/**
 * Reset all lane runtime state to idle. Used after SIGUSR1 in-process
 * restarts where interrupted tasks' finally blocks may not run, leaving
 * stale active task IDs that permanently block new work from draining.
 *
 * Bumps lane generation and clears execution counters so stale completions
 * from old in-flight tasks are ignored. Queued entries are intentionally
 * preserved — they represent pending user work that should still execute
 * after restart.
 *
 * After resetting, drains any lanes that still have queued entries so
 * preserved work is pumped immediately rather than waiting for a future
 * `enqueueCommandInLane()` call (which may never come).
 * 
 * 将所有通道运行时状态重置为空闲。用于 SIGUSR1 进程内重启后，被中断任务的
 * finally 块可能未执行，导致留下过时的活动任务 ID，从而永久阻塞新工作的排出。
 *
 * 该操作会提升通道代并清除执行计数器，使旧的在途任务产生的过时完成事件被忽略。
 * 队列条目则有意保留——它们代表重启后仍应执行的待处理用户工作。
 *
 * 重置后，会立即排出所有仍包含队列条目的通道，使保留的工作被即时推进，
 * 而无需等待未来的 `enqueueCommandInLane()` 调用（该调用可能永远不会发生）。
 */
export function resetAllLanes(): void {
  const lanesToDrain: string[] = [];
  for (const state of lanes.values()) {
    state.generation += 1;
    state.activeTaskIds.clear();
    state.draining = false;
    if (state.queue.length > 0) {
      lanesToDrain.push(state.lane);
    }
  }
  // Drain after the full reset pass so all lanes are in a clean state first.
  for (const lane of lanesToDrain) {
    drainLane(lane);
  }
}

/**
 * Returns the total number of actively executing tasks across all lanes
 * (excludes queued-but-not-started entries).
 */
export function getActiveTaskCount(): number {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.activeTaskIds.size;
  }
  return total;
}

/**
 * Wait for all currently active tasks across all lanes to finish.
 * Polls at a short interval; resolves when no tasks are active or
 * when `timeoutMs` elapses (whichever comes first).
 *
 * New tasks enqueued after this call are ignored — only tasks that are
 * already executing are waited on.
 *
 * 等待所有通道中当前活动的任务完成。
 * 以短间隔轮询；当没有任务活动或 `timeoutMs` 超时时解决（以先到者为准）。
 *
 * 在此调用之后入队的新任务将被忽略——仅等待已在执行的任务。
 */
export function waitForActiveTasks(timeoutMs: number): Promise<{ drained: boolean }> {
  // Keep shutdown/drain checks responsive without busy looping.
  const POLL_INTERVAL_MS = 50;
  const deadline = Date.now() + timeoutMs;
  const activeAtStart = new Set<number>();
  for (const state of lanes.values()) {
    for (const taskId of state.activeTaskIds) {
      activeAtStart.add(taskId);
    }
  }

  return new Promise((resolve) => {
    const check = () => {
      if (activeAtStart.size === 0) {
        resolve({ drained: true });
        return;
      }

      let hasPending = false;
      for (const state of lanes.values()) {
        for (const taskId of state.activeTaskIds) {
          if (activeAtStart.has(taskId)) {
            hasPending = true;
            break;
          }
        }
        if (hasPending) {
          break;
        }
      }

      if (!hasPending) {
        resolve({ drained: true });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ drained: false });
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };
    check();
  });
}
