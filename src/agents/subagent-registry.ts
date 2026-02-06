import { loadConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { onAgentEvent } from "../infra/agent-events.js";
import { type DeliveryContext, normalizeDeliveryContext } from "../utils/delivery-context.js";
import { runSubagentAnnounceFlow, type SubagentRunOutcome } from "./subagent-announce.js";
import {
  loadSubagentRegistryFromDisk,
  saveSubagentRegistryToDisk,
} from "./subagent-registry.store.js";
import { resolveAgentTimeoutMs } from "./timeout.js";

export type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: "delete" | "keep";
  label?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
};

const subagentRuns = new Map<string, SubagentRunRecord>();
let sweeper: NodeJS.Timeout | null = null;
let listenerStarted = false;
let listenerStop: (() => void) | null = null;
// Use var to avoid TDZ when init runs across circular imports during bootstrap.
var restoreAttempted = false;

/**
 * 持久化保存子代理运行记录(转发)
 * 
 * 主要功能：
 * 1. 将子代理运行记录转换为持久化格式
 * 2. 包含版本信息和运行记录数组
 * 
 * @param runs 包含子代理运行记录的Map，键为runId
 */
function persistSubagentRuns() {
  try {
    saveSubagentRegistryToDisk(subagentRuns);
  } catch (err) {
    console.error("Failed to persist subagent runs", err);
  }
}

const resumedRuns = new Set<string>();
/**
 * 恢复子代理运行（从运行记录中恢复处理）
 * 
 * 该函数用于恢复中断或未完成的子代理运行，通常用于系统重启后恢复运行状态。
 * 它会检查运行记录并决定是立即执行清理通知，还是重新等待任务完成。
 * 
 * @param runId - 要恢复的子代理运行ID
 */
function resumeSubagentRun(runId: string) {
  if (!runId || resumedRuns.has(runId)) {
    return;
  }
  
  // 从全局运行记录中获取对应的子代理运行条目
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return;
  }
  
  if (entry.cleanupCompletedAt) {
    return;
  }

  // 情况1：如果运行已经结束（有结束时间戳）
  if (typeof entry.endedAt === "number" && entry.endedAt > 0) {
    if (!beginSubagentCleanup(runId)) {
      return;
    }
    
    const requesterOrigin = normalizeDeliveryContext(entry.requesterOrigin);
    
    // 异步执行子代理通知流程
    void runSubagentAnnounceFlow({
      childSessionKey: entry.childSessionKey,
      childRunId: entry.runId,
      requesterSessionKey: entry.requesterSessionKey,
      requesterOrigin,
      requesterDisplayKey: entry.requesterDisplayKey,
      task: entry.task,
      timeoutMs: 30_000, // 30秒超时
      cleanup: entry.cleanup,
      waitForCompletion: false,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      label: entry.label,
      outcome: entry.outcome,
    }).then((didAnnounce) => {
      finalizeSubagentCleanup(runId, entry.cleanup, didAnnounce);
    });
    
    // 标记该运行已经恢复，避免重复处理
    resumedRuns.add(runId);
    return;
  }

  // 情况2：运行尚未结束，需要在重启后重新等待完成

  const cfg = loadConfig();
  const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, undefined);
  void waitForSubagentCompletion(runId, waitTimeoutMs);
  resumedRuns.add(runId);
}

/**
 * 恢复SubAgent状态（只执行一次）
 * 
 * 该函数用于在系统重启后恢复之前中断的SubAgent运行记录。
 * 它会从磁盘加载SubAgent注册信息，并根据运行状态进行处理。
 * 
 * @returns void
 */
function restoreSubagentRunsOnce() {
  if (restoreAttempted) {
    return;
  }
  restoreAttempted = true;
  try {
    // 从磁盘加载SubAgent注册
    const restored = loadSubagentRegistryFromDisk();
    if (restored.size === 0) {
      return;
    }
    for (const [runId, entry] of restored.entries()) {
      if (!runId || !entry) {
        continue;
      }
      // Keep any newer in-memory entries.
      // 在内存中保持最新记录
      if (!subagentRuns.has(runId)) {
        subagentRuns.set(runId, entry);
      }
    }


    ensureListener();
    if ([...subagentRuns.values()].some((entry) => entry.archiveAtMs)) {
      startSweeper();
    }
    // Resume pending work.
    //恢复中断
    for (const runId of subagentRuns.keys()) {
      resumeSubagentRun(runId);
    }
  } catch (error) {
    console.warn('Restore subagent failed:', error);
  }
}

function resolveArchiveAfterMs(cfg?: ReturnType<typeof loadConfig>) {
  const config = cfg ?? loadConfig();
  const minutes = config.agents?.defaults?.subagents?.archiveAfterMinutes ?? 60;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(minutes)) * 60_000;
}

function resolveSubagentWaitTimeoutMs(
  cfg: ReturnType<typeof loadConfig>,
  runTimeoutSeconds?: number,
) {
  return resolveAgentTimeoutMs({ cfg, overrideSeconds: runTimeoutSeconds });
}

/**
 * 60s后清理子代理
 * @returns void
 */
function startSweeper() {
  if (sweeper) {
    return;
  }
  sweeper = setInterval(() => {
    void sweepSubagentRuns();
  }, 60_000);
  sweeper.unref?.();
  //unref()方法告诉Node.js：如果这个定时器是事件循环中唯一的活动，允许进程退出而不必等待定时器
  //?.()是可选链调用，确保sweeper对象存在unref方法时才调用（兼容性处理）
}

function stopSweeper() {
  if (!sweeper) {
    return;
  }
  clearInterval(sweeper);
  sweeper = null;
}

async function sweepSubagentRuns() {
  const now = Date.now();
  let mutated = false;
  for (const [runId, entry] of subagentRuns.entries()) {
    if (!entry.archiveAtMs || entry.archiveAtMs > now) {
      continue;
    }
    subagentRuns.delete(runId);
    mutated = true;
    try {
      await callGateway({
        method: "sessions.delete",
        params: { key: entry.childSessionKey, deleteTranscript: true },
        timeoutMs: 10_000,
      });
    } catch {
      // ignore
    }
  }
  if (mutated) {
    persistSubagentRuns();
  }
  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}

/**
 * 确保子代理生命周期事件监听器被初始化（仅一次）
 * 该函数用于监听子代理的开始、结束和错误事件，记录运行状态并触发清理流程
 */
function ensureListener() {
  //单例
  if (listenerStarted) {
    return;
  }
  listenerStarted = true;
  
  // 注册代理事件监听器，返回的 stop 函数可用于后续取消监听
  listenerStop = onAgentEvent((evt) => {
    // 忽略无效事件或非生命周期事件
    if (!evt || evt.stream !== "lifecycle") {
      return;
    }
    
    const entry = subagentRuns.get(evt.runId);
    if (!entry) {
      return;
    }
    
    // 获取事件阶段（start/end/error）
    const phase = evt.data?.phase;
    
    if (phase === "start") {
      // 记录开始时间，确保数据类型为数字
      const startedAt = typeof evt.data?.startedAt === "number" 
        ? evt.data.startedAt 
        : undefined;
      
      if (startedAt) {
        entry.startedAt = startedAt;
        persistSubagentRuns(); // 保存子代理
      }
      return;
    }
    
    // 只处理结束或错误事件，忽略其他阶段
    if (phase !== "end" && phase !== "error") {
      return;
    }
    
    // 记录结束时间
    const endedAt = typeof evt.data?.endedAt === "number" 
      ? evt.data.endedAt 
      : Date.now();
    
    entry.endedAt = endedAt;
    
    if (phase === "error") {
      const error = typeof evt.data?.error === "string" 
        ? evt.data.error 
        : undefined;
      entry.outcome = { status: "error", error };
    } else {
      entry.outcome = { status: "ok" };
    }
    
    // 更新持久化存储
    persistSubagentRuns();
    
    // 开始清理流程，如果清理未开始则返回
    if (!beginSubagentCleanup(evt.runId)) {
      return;
    }
    
    // 规范化请求来源信息
    const requesterOrigin = normalizeDeliveryContext(entry.requesterOrigin);
    
    // 异步执行结果通知流程
    void runSubagentAnnounceFlow({
      childSessionKey: entry.childSessionKey,
      childRunId: entry.runId,
      requesterSessionKey: entry.requesterSessionKey,
      requesterOrigin,
      requesterDisplayKey: entry.requesterDisplayKey,
      task: entry.task,
      timeoutMs: 30_000, // 30秒超时
      cleanup: entry.cleanup,
      waitForCompletion: false, // 不等待完成
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      label: entry.label,
      outcome: entry.outcome,
    }).then((didAnnounce) => {
      // 通知完成后执行最终清理
      finalizeSubagentCleanup(evt.runId, entry.cleanup, didAnnounce);
    });
  });
}

function finalizeSubagentCleanup(runId: string, cleanup: "delete" | "keep", didAnnounce: boolean) {
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return;
  }
  if (cleanup === "delete") {
    subagentRuns.delete(runId);
    persistSubagentRuns();
    return;
  }
  if (!didAnnounce) {
    // Allow retry on the next wake if the announce failed.
    // 若announce失败，则允许在下次唤醒时重试。
    entry.cleanupHandled = false;
    persistSubagentRuns();
    return;
  }
  entry.cleanupCompletedAt = Date.now();
  persistSubagentRuns();
}

function beginSubagentCleanup(runId: string) {
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return false;
  }
  if (entry.cleanupCompletedAt) {
    return false;
  }
  if (entry.cleanupHandled) {
    return false;
  }
  entry.cleanupHandled = true;
  persistSubagentRuns();
  return true;
}

export function registerSubagentRun(params: {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: "delete" | "keep";
  label?: string;
  runTimeoutSeconds?: number;
}) {
  const now = Date.now();
  const cfg = loadConfig();
  const archiveAfterMs = resolveArchiveAfterMs(cfg);
  const archiveAtMs = archiveAfterMs ? now + archiveAfterMs : undefined;
  const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, params.runTimeoutSeconds);
  const requesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
  subagentRuns.set(params.runId, {
    runId: params.runId,
    childSessionKey: params.childSessionKey,
    requesterSessionKey: params.requesterSessionKey,
    requesterOrigin,
    requesterDisplayKey: params.requesterDisplayKey,
    task: params.task,
    cleanup: params.cleanup,
    label: params.label,
    createdAt: now,
    startedAt: now,
    archiveAtMs,
    cleanupHandled: false,
  });
  ensureListener();
  persistSubagentRuns();
  if (archiveAfterMs) {
    startSweeper();
  }
  // Wait for subagent completion via gateway RPC (cross-process).
  // The in-process lifecycle listener is a fallback for embedded runs.
  void waitForSubagentCompletion(params.runId, waitTimeoutMs);
}

async function waitForSubagentCompletion(runId: string, waitTimeoutMs: number) {
  try {
    const timeoutMs = Math.max(1, Math.floor(waitTimeoutMs));
    const wait = await callGateway<{
      status?: string;
      startedAt?: number;
      endedAt?: number;
      error?: string;
    }>({
      method: "agent.wait",
      params: {
        runId,
        timeoutMs,
      },
      timeoutMs: timeoutMs + 10_000,
    });
    if (wait?.status !== "ok" && wait?.status !== "error") {
      return;
    }
    const entry = subagentRuns.get(runId);
    if (!entry) {
      return;
    }
    let mutated = false;
    if (typeof wait.startedAt === "number") {
      entry.startedAt = wait.startedAt;
      mutated = true;
    }
    if (typeof wait.endedAt === "number") {
      entry.endedAt = wait.endedAt;
      mutated = true;
    }
    if (!entry.endedAt) {
      entry.endedAt = Date.now();
      mutated = true;
    }
    const waitError = typeof wait.error === "string" ? wait.error : undefined;
    entry.outcome =
      wait.status === "error" ? { status: "error", error: waitError } : { status: "ok" };
    mutated = true;
    if (mutated) {
      persistSubagentRuns();
    }
    if (!beginSubagentCleanup(runId)) {
      return;
    }
    const requesterOrigin = normalizeDeliveryContext(entry.requesterOrigin);
    void runSubagentAnnounceFlow({
      childSessionKey: entry.childSessionKey,
      childRunId: entry.runId,
      requesterSessionKey: entry.requesterSessionKey,
      requesterOrigin,
      requesterDisplayKey: entry.requesterDisplayKey,
      task: entry.task,
      timeoutMs: 30_000,
      cleanup: entry.cleanup,
      waitForCompletion: false,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      label: entry.label,
      outcome: entry.outcome,
    }).then((didAnnounce) => {
      finalizeSubagentCleanup(runId, entry.cleanup, didAnnounce);
    });
  } catch {
    // ignore
  }
}

export function resetSubagentRegistryForTests() {
  subagentRuns.clear();
  resumedRuns.clear();
  stopSweeper();
  restoreAttempted = false;
  if (listenerStop) {
    listenerStop();
    listenerStop = null;
  }
  listenerStarted = false;
  persistSubagentRuns();
}

export function addSubagentRunForTests(entry: SubagentRunRecord) {
  subagentRuns.set(entry.runId, entry);
  persistSubagentRuns();
}

export function releaseSubagentRun(runId: string) {
  const didDelete = subagentRuns.delete(runId);
  if (didDelete) {
    persistSubagentRuns();
  }
  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}

export function listSubagentRunsForRequester(requesterSessionKey: string): SubagentRunRecord[] {
  const key = requesterSessionKey.trim();
  if (!key) {
    return [];
  }
  return [...subagentRuns.values()].filter((entry) => entry.requesterSessionKey === key);
}

/**
 * 初始化SubAgent
 */
export function initSubagentRegistry() {
  restoreSubagentRunsOnce();
}
