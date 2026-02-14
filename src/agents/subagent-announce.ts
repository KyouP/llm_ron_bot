import crypto from "node:crypto";
import path from "node:path";
import { resolveQueueSettings } from "../auto-reply/reply/queue.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveMainSessionKey,
  resolveSessionFilePath,
  resolveStorePath,
} from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { formatDurationCompact } from "../infra/format-time/format-duration.ts";
import { normalizeMainKey } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import {
  type DeliveryContext,
  deliveryContextFromSession,
  mergeDeliveryContext,
  normalizeDeliveryContext,
} from "../utils/delivery-context.js";
import {
  isEmbeddedPiRunActive,
  queueEmbeddedPiMessage,
  waitForEmbeddedPiRunEnd,
} from "./pi-embedded.js";
import { type AnnounceQueueItem, enqueueAnnounce } from "./subagent-announce-queue.js";
import { readLatestAssistantReply } from "./tools/agent-step.js";

function formatTokenCount(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(Math.round(value));
}

function formatUsd(value?: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

function resolveModelCost(params: {
  provider?: string;
  model?: string;
  config: ReturnType<typeof loadConfig>;
}):
  | {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }
  | undefined {
  const provider = params.provider?.trim();
  const model = params.model?.trim();
  if (!provider || !model) {
    return undefined;
  }
  const models = params.config.models?.providers?.[provider]?.models ?? [];
  const entry = models.find((candidate) => candidate.id === model);
  return entry?.cost;
}

async function waitForSessionUsage(params: { sessionKey: string }) {
  const cfg = loadConfig();
  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  let entry = loadSessionStore(storePath)[params.sessionKey];
  if (!entry) {
    return { entry, storePath };
  }
  const hasTokens = () =>
    entry &&
    (typeof entry.totalTokens === "number" ||
      typeof entry.inputTokens === "number" ||
      typeof entry.outputTokens === "number");
  if (hasTokens()) {
    return { entry, storePath };
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    entry = loadSessionStore(storePath)[params.sessionKey];
    if (hasTokens()) {
      break;
    }
  }
  return { entry, storePath };
}

type DeliveryContextSource = Parameters<typeof deliveryContextFromSession>[0];

function resolveAnnounceOrigin(
  entry?: DeliveryContextSource,
  requesterOrigin?: DeliveryContext,
): DeliveryContext | undefined {
  // requesterOrigin (captured at spawn time) reflects the channel the user is
  // actually on and must take priority over the session entry, which may carry
  // stale lastChannel / lastTo values from a previous channel interaction.
  return mergeDeliveryContext(requesterOrigin, deliveryContextFromSession(entry));
}

async function sendAnnounce(item: AnnounceQueueItem) {
  const origin = item.origin;
  const threadId =
    origin?.threadId != null && origin.threadId !== "" ? String(origin.threadId) : undefined;
  await callGateway({
    method: "agent",
    params: {
      sessionKey: item.sessionKey,
      message: item.prompt,
      channel: origin?.channel,
      accountId: origin?.accountId,
      to: origin?.to,
      threadId,
      deliver: true,
      idempotencyKey: crypto.randomUUID(),
    },
    expectFinal: true,
    timeoutMs: 60_000,
  });
}

function resolveRequesterStoreKey(
  cfg: ReturnType<typeof loadConfig>,
  requesterSessionKey: string,
): string {
  const raw = requesterSessionKey.trim();
  if (!raw) {
    return raw;
  }
  if (raw === "global" || raw === "unknown") {
    return raw;
  }
  if (raw.startsWith("agent:")) {
    return raw;
  }
  const mainKey = normalizeMainKey(cfg.session?.mainKey);
  if (raw === "main" || raw === mainKey) {
    return resolveMainSessionKey(cfg);
  }
  const agentId = resolveAgentIdFromSessionKey(raw);
  return `agent:${agentId}:${raw}`;
}

function loadRequesterSessionEntry(requesterSessionKey: string) {
  const cfg = loadConfig();
  const canonicalKey = resolveRequesterStoreKey(cfg, requesterSessionKey);
  const agentId = resolveAgentIdFromSessionKey(canonicalKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[canonicalKey];
  return { cfg, entry, canonicalKey };
}

/**
 * 可能将子代理通知加入队列 TODO 未看
 * 
 * 这个函数是通知流程的智能分发器，根据系统配置和当前会话状态决定如何最佳处理子代理完成通知：
 * 1. steered 直接转向嵌入式PI处理
 * 2. queued 加入队列等待后续处理
 * 3. none 不进行任何队列操作
 * 
 * 函数根据队列设置模式和会话活跃状态做出决策，确保通知以最合适的方式传递。
 * 
 * @param params 队列处理参数
 * @param params.requesterSessionKey 请求方（主代理）的会话标识符
 * @param params.triggerMessage 触发消息（子代理完成通知的具体内容）
 * @param params.summaryLine 可选摘要行，用于队列中快速识别通知内容
 * @param params.requesterOrigin 可选的请求来源投递上下文
 * @returns 返回处理结果："steered"表示已转向处理，"queued"表示已加入队列，"none"表示未执行队列操作
 */
async function maybeQueueSubagentAnnounce(params: {
  requesterSessionKey: string;
  triggerMessage: string;
  summaryLine?: string;
  requesterOrigin?: DeliveryContext;
}): Promise<"steered" | "queued" | "none"> {
  // 加载请求方会话的配置和条目信息，用于后续决策
  const { cfg, entry } = loadRequesterSessionEntry(params.requesterSessionKey);
  // 解析请求方的标准存储键，用于唯一标识这个会话
  const canonicalKey = resolveRequesterStoreKey(cfg, params.requesterSessionKey);
  
  // 获取会话ID，如果没有会话ID则无法进行队列操作
  const sessionId = entry?.sessionId;
  if (!sessionId) {
    return "none"; // 无有效会话ID，无法进行队列操作
  }

  // 根据配置和会话信息解析队列设置，包括队列模式和策略
  const queueSettings = resolveQueueSettings({
    cfg,
    channel: entry?.channel ?? entry?.lastChannel, // 使用当前通道或最后使用的通道
    sessionEntry: entry,
  });

  // 检查当前嵌入式PI运行是否活跃（嵌入式PI可能是内部的处理器或代理）
  const isActive = isEmbeddedPiRunActive(sessionId);

  // 检查是否应该使用转向模式（steer模式直接将消息传递给嵌入式PI处理）
  const shouldSteer = queueSettings.mode === "steer" || queueSettings.mode === "steer-backlog";
  if (shouldSteer) {
    // 尝试将消息转向嵌入式PI处理
    const steered = queueEmbeddedPiMessage(sessionId, params.triggerMessage);
    if (steered) {
      return "steered"; // 成功转向处理
    }
  }

  // 检查是否应该使用跟进模式（followup模式将通知加入队列等待后续处理）
  const shouldFollowup =
    queueSettings.mode === "followup" ||
    queueSettings.mode === "collect" ||
    queueSettings.mode === "steer-backlog" || // steer-backlog模式既可能转向也可能队列
    queueSettings.mode === "interrupt"; // interrupt模式通常需要立即处理
  
  // 如果会话活跃且符合跟进条件，或者即使会话活跃但使用steer模式时
  // 注意：steer模式在上面的shouldSteer条件中已经处理，这里可能是备用逻辑
  if (isActive && (shouldFollowup || queueSettings.mode === "steer")) {
    // 解析通知的来源信息，优先使用传入的requesterOrigin，否则使用会话条目中的信息
    const origin = resolveAnnounceOrigin(entry, params.requesterOrigin);

    // 将通知加入队列
    enqueueAnnounce({
      key: canonicalKey, // 使用标准存储键作为队列键
      item: {
        prompt: params.triggerMessage, // 触发消息内容
        summaryLine: params.summaryLine, // 可选的摘要行
        enqueuedAt: Date.now(), // 入队时间戳
        sessionKey: canonicalKey, // 会话标识符
        origin, // 来源信息
      },
      settings: queueSettings, // 队列设置
      send: sendAnnounce, // 发送函数引用
    });
    
    return "queued"; // 成功加入队列
  }

  // 不符合任何队列条件，返回"none"表示未执行队列操作
  return "none";
}

async function buildSubagentStatsLine(params: {
  sessionKey: string;
  startedAt?: number;
  endedAt?: number;
}) {
  const cfg = loadConfig();
  const { entry, storePath } = await waitForSessionUsage({
    sessionKey: params.sessionKey,
  });

  const sessionId = entry?.sessionId;
  let transcriptPath: string | undefined;
  if (sessionId && storePath) {
    try {
      transcriptPath = resolveSessionFilePath(sessionId, entry, {
        sessionsDir: path.dirname(storePath),
      });
    } catch {
      transcriptPath = undefined;
    }
  }

  const input = entry?.inputTokens;
  const output = entry?.outputTokens;
  const total =
    entry?.totalTokens ??
    (typeof input === "number" && typeof output === "number" ? input + output : undefined);
  const runtimeMs =
    typeof params.startedAt === "number" && typeof params.endedAt === "number"
      ? Math.max(0, params.endedAt - params.startedAt)
      : undefined;

  const provider = entry?.modelProvider;
  const model = entry?.model;
  const costConfig = resolveModelCost({ provider, model, config: cfg });
  const cost =
    costConfig && typeof input === "number" && typeof output === "number"
      ? (input * costConfig.input + output * costConfig.output) / 1_000_000
      : undefined;

  const parts: string[] = [];
  const runtime = formatDurationCompact(runtimeMs);
  parts.push(`runtime ${runtime ?? "n/a"}`);
  if (typeof total === "number") {
    const inputText = typeof input === "number" ? formatTokenCount(input) : "n/a";
    const outputText = typeof output === "number" ? formatTokenCount(output) : "n/a";
    const totalText = formatTokenCount(total);
    parts.push(`tokens ${totalText} (in ${inputText} / out ${outputText})`);
  } else {
    parts.push("tokens n/a");
  }
  const costText = formatUsd(cost);
  if (costText) {
    parts.push(`est ${costText}`);
  }
  parts.push(`sessionKey ${params.sessionKey}`);
  if (sessionId) {
    parts.push(`sessionId ${sessionId}`);
  }
  if (transcriptPath) {
    parts.push(`transcript ${transcriptPath}`);
  }

  return `Stats: ${parts.join(" \u2022 ")}`;
}

function loadSessionEntryByKey(sessionKey: string) {
  const cfg = loadConfig();
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  return store[sessionKey];
}

async function readLatestAssistantReplyWithRetry(params: {
  sessionKey: string;
  initialReply?: string;
  maxWaitMs: number;
}): Promise<string | undefined> {
  const RETRY_INTERVAL_MS = 100;
  let reply = params.initialReply?.trim() ? params.initialReply : undefined;
  if (reply) {
    return reply;
  }

  const deadline = Date.now() + Math.max(0, Math.min(params.maxWaitMs, 15_000));
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    const latest = await readLatestAssistantReply({ sessionKey: params.sessionKey });
    if (latest?.trim()) {
      return latest;
    }
  }
  return reply;
}

export function buildSubagentSystemPrompt(params: {
  requesterSessionKey?: string;
  requesterOrigin?: DeliveryContext;
  childSessionKey: string;
  label?: string;
  task?: string;
}) {
  const taskText =
    typeof params.task === "string" && params.task.trim()
      ? params.task.replace(/\s+/g, " ").trim()
      : "{{TASK_DESCRIPTION}}";
  const lines = [
    "# Subagent Context",
    "",
    "You are a **subagent** spawned by the main agent for a specific task.",
    "",
    "## Your Role",
    `- You were created to handle: ${taskText}`,
    "- Complete this task. That's your entire purpose.",
    "- You are NOT the main agent. Don't try to be.",
    "",
    "## Rules",
    "1. **Stay focused** - Do your assigned task, nothing else",
    "2. **Complete the task** - Your final message will be automatically reported to the main agent",
    "3. **Don't initiate** - No heartbeats, no proactive actions, no side quests",
    "4. **Be ephemeral** - You may be terminated after task completion. That's fine.",
    "",
    "## Output Format",
    "When complete, your final response should include:",
    "- What you accomplished or found",
    "- Any relevant details the main agent should know",
    "- Keep it concise but informative",
    "",
    "## What You DON'T Do",
    "- NO user conversations (that's main agent's job)",
    "- NO external messages (email, tweets, etc.) unless explicitly tasked with a specific recipient/channel",
    "- NO cron jobs or persistent state",
    "- NO pretending to be the main agent",
    "- Only use the `message` tool when explicitly instructed to contact a specific external recipient; otherwise return plain text and let the main agent deliver it",
    "",
    "## Session Context",
    params.label ? `- Label: ${params.label}` : undefined,
    params.requesterSessionKey ? `- Requester session: ${params.requesterSessionKey}.` : undefined,
    params.requesterOrigin?.channel
      ? `- Requester channel: ${params.requesterOrigin.channel}.`
      : undefined,
    `- Your session: ${params.childSessionKey}.`,
    "",
  ].filter((line): line is string => line !== undefined);
  return lines.join("\n");
}

export type SubagentRunOutcome = {
  status: "ok" | "error" | "timeout" | "unknown";
  error?: string;
};

export type SubagentAnnounceType = "subagent task" | "cron job";

/**
 * 执行子代理任务完成后的通知流程
 * 
 * 当子代理任务完成时，此函数负责：
 * 1. 等待任务完成（如果需要）
 * 2. 收集任务结果和统计信息
 * 3. 构建用户友好的通知消息
 * 4. 通过队列或直接通知方式告知主代理
 * 5. 执行会话清理操作
 * 
 * 这是一个关键的协调函数，用于确保子代理任务的闭环管理。
 * 
 * @param params 通知流程参数
 * @param params.childSessionKey 子代理会话的唯一标识符
 * @param params.childRunId 子代理运行的唯一ID
 * @param params.requesterSessionKey 请求方（主代理）的会话标识符
 * @param params.requesterOrigin 请求来源的投递上下文（用于消息路由）
 * @param params.requesterDisplayKey 请求方的显示标识符（用于日志/调试）
 * @param params.task 子代理执行的任务描述
 * @param params.timeoutMs 等待任务完成的最大超时时间（毫秒）
 * @param params.cleanup 清理策略："delete"删除会话，"keep"保留会话
 * @param params.roundOneReply 可选的首轮回复，如果已存在则直接使用
 * @param params.waitForCompletion 是否等待任务完成（默认等待）
 * @param params.startedAt 任务开始时间戳（可选，用于统计）
 * @param params.endedAt 任务结束时间戳（可选，用于统计）
 * @param params.label 子代理的标签/名称（用于友好显示）
 * @param params.outcome 任务结果（如果已知）
 * @param params.announceType 通知类型（默认"subagent task"）
 * @returns 返回布尔值，表示是否成功发送了通知
 */
export async function runSubagentAnnounceFlow(params: {
  childSessionKey: string;
  childRunId: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  timeoutMs: number;
  cleanup: "delete" | "keep";
  roundOneReply?: string;
  waitForCompletion?: boolean;
  startedAt?: number;
  endedAt?: number;
  label?: string;
  outcome?: SubagentRunOutcome;
  announceType?: SubagentAnnounceType;
}): Promise<boolean> {
  let didAnnounce = false;
  let shouldDeleteChildSession = params.cleanup === "delete";
  try {
    // 规范化请求来源，确保投递上下文的格式一致性
    const requesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
    const childSessionId = (() => {
      const entry = loadSessionEntryByKey(params.childSessionKey);
      return typeof entry?.sessionId === "string" && entry.sessionId.trim()
        ? entry.sessionId.trim()
        : undefined;
    })();
    // 如果没有预先提供的回复且需要等待任务完成（默认行为），限制最大为120秒
    const settleTimeoutMs = Math.min(Math.max(params.timeoutMs, 1), 120_000);
    let reply = params.roundOneReply; // 从参数获取第一轮回复（如果有）
    let outcome: SubagentRunOutcome | undefined = params.outcome;
    // Lifecycle "end" can arrive before auto-compaction retries finish. If the
    // subagent is still active, wait for the embedded run to fully settle.
    // 生命周期“结束”可能在自动压缩重试完成之前到达。如果子代理仍处于活动状态，请等待嵌入运行完全稳定。
    if (childSessionId && isEmbeddedPiRunActive(childSessionId)) {
      const settled = await waitForEmbeddedPiRunEnd(childSessionId, settleTimeoutMs);
      if (!settled && isEmbeddedPiRunActive(childSessionId)) {
        // The child run is still active (e.g., compaction retry still in progress).
        // Defer announcement so we don't report stale/partial output.
        // Keep the child session so output is not lost while the run is still active.
        // 子运行（例如压缩重试）仍在进行中。
        // 推迟通知，以避免报告过时或不完整的输出。
        // 保留子会话，以便在运行仍处于活动状态时不会丢失输出。
        shouldDeleteChildSession = false;
        return false;
      }
    }

    if (!reply && params.waitForCompletion !== false) {
      const waitMs = settleTimeoutMs;
      
      // 调用agent等待子代理任务完成
      const wait = await callGateway<{
        status?: string;
        startedAt?: number;
        endedAt?: number;
        error?: string;
      }>({
        method: "agent.wait", // 等待代理完成的方法
        params: {
          runId: params.childRunId,
          timeoutMs: waitMs,
        },
        timeoutMs: waitMs + 2000, // 网关调用超时（比等待时间多2秒）
      });
      const waitError = typeof wait?.error === "string" ? wait.error : undefined;
      if (wait?.status === "timeout") {
        outcome = { status: "timeout" }; // 任务超时
      } else if (wait?.status === "error") {
        outcome = { status: "error", error: waitError }; // 任务出错
      } else if (wait?.status === "ok") {
        outcome = { status: "ok" }; // 任务成功完成
      }
      if (typeof wait?.startedAt === "number" && !params.startedAt) {
        params.startedAt = wait.startedAt;
      }
      if (typeof wait?.endedAt === "number" && !params.endedAt) {
        params.endedAt = wait.endedAt;
      }
      // 双重检查：如果等待状态是超时但尚未设置结果，设置为超时
      if (wait?.status === "timeout") {
        if (!outcome) {
          outcome = { status: "timeout" };
        }
      }
      // 读取SubAgent会话的最新回复
      reply = await readLatestAssistantReply({ sessionKey: params.childSessionKey });
    }

    // 如果还没有回复（无论是从参数还是等待后），再次尝试读取SubAgent
    if (!reply) {
      reply = await readLatestAssistantReply({ sessionKey: params.childSessionKey });
    }

    if (!reply?.trim()) {
      reply = await readLatestAssistantReplyWithRetry({
        sessionKey: params.childSessionKey,
        initialReply: reply,
        maxWaitMs: params.timeoutMs,
      });
    }

    if (!reply?.trim() && childSessionId && isEmbeddedPiRunActive(childSessionId)) {
      // Avoid announcing "(no output)" while the child run is still producing output.
      // 避免在子运行仍在产生输出时报告“(no output)”。
      shouldDeleteChildSession = false;
      return false;
    }

    if (!outcome) {
      outcome = { status: "unknown" };
    }

    // Build stats
    // 构建统计信息行：包含令牌使用、时间等统计信息
    const statsLine = await buildSubagentStatsLine({
      sessionKey: params.childSessionKey,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
    });

    // Build status label
    const statusLabel =
      outcome.status === "ok"
        ? "completed successfully" // 成功完成
        : outcome.status === "timeout"
          ? "timed out" // 超时
          : outcome.status === "error"
            ? `failed: ${outcome.error || "unknown error"}` // 失败，包含错误信息
            : "finished with unknown status"; // 未知状态

    // Build instructional message for main agent
    // 构建用于触发主代理的通知消息
    const announceType = params.announceType ?? "subagent task"; // 任务标签
    const taskLabel = params.label || params.task || "task";
    const triggerMessage = [
      `A ${announceType} "${taskLabel}" just ${statusLabel}.`,
      "", // 空行分隔
      "Findings:", // 发现/结果部分
      reply || "(no output)", // 实际回复内容，没有则显示占位符
      "",
      statsLine,
      "",
      // 给主agent的指令：如何向用户呈现这些信息
      // "Summarize this naturally for the user. Keep it brief (1-2 sentences). Flow it into the conversation naturally.",
      // `Do not mention technical details like tokens, stats, or that this was a ${announceType}.`,
      // "You can respond with NO_REPLY if no announcement is needed (e.g., internal task with no user-facing result).",
    "请为用户自然地总结以下内容。保持简洁（1-2句话）。自然地融入对话流程中。",
    "不需要提及技术细节，例如令牌数量、统计数据或这是一个${announceType}。",
    "如果不需要进行通知（例如，没有用户可见结果的内部任务），你可以用'NO_REPLY'来回应。",
    ].join("\n");
    
    // 尝试将通知加入队列（异步处理，避免阻塞）
    const queued = await maybeQueueSubagentAnnounce({
      requesterSessionKey: params.requesterSessionKey,
      triggerMessage,
      summaryLine: taskLabel,
      requesterOrigin,
    });

    // 检查队列处理结果，如果成功直接返回
      if (queued === "steered" || queued === "queued") {
      didAnnounce = true;
      return true;
    }

    /** 
    * 队列处理失败，直接向主代理发送消息
    */
    // Send to main agent - it will respond in its own voice
    // 如果没有来源信息，从请求方会话中加载
    let directOrigin = requesterOrigin;
    if (!directOrigin) {
      const { entry } = loadRequesterSessionEntry(params.requesterSessionKey);
      directOrigin = deliveryContextFromSession(entry);
    }
    await callGateway({
      method: "agent", // 调用代理方法
      params: {
        sessionKey: params.requesterSessionKey,
        message: triggerMessage, // 触发消息
        deliver: true,
        channel: directOrigin?.channel,
        accountId: directOrigin?.accountId,
        to: directOrigin?.to,
        threadId:
          directOrigin?.threadId != null && directOrigin.threadId !== ""
            ? String(directOrigin.threadId)
            : undefined,
        idempotencyKey: crypto.randomUUID(),
      },
      expectFinal: true, // 期望最终响应（非流式） TODO 检查参数使用
      timeoutMs: 60_000, // 60秒超时
    });

    didAnnounce = true;
  } catch (err) {
    defaultRuntime.error?.(`Subagent announce failed: ${String(err)}`);
    // Best-effort follow-ups; ignore failures to avoid breaking the caller response.
  } finally {
    // Patch label after all writes complete
    if (params.label) {
      try {
        await callGateway({
          method: "sessions.patch", // 会话补丁方法
          params: { key: params.childSessionKey, label: params.label },
          timeoutMs: 10_000, // 10秒超时
        });
      } catch (err) {
        defaultRuntime.error?.(`Subagent sessions.patch failed: ${String(err)}`);
      }
    }
    // 如果清理策略是删除，尝试删除会话
    if (shouldDeleteChildSession) {
      try {
        await callGateway({
          method: "sessions.delete", // 删除会话方法
          params: { key: params.childSessionKey, deleteTranscript: true },
          timeoutMs: 10_000, // 10秒超时
        });
      } catch (err) {
        defaultRuntime.error?.(`Subagent sessions.delete failed: ${String(err)}`);
      }
    }
  }
  return didAnnounce;
}
