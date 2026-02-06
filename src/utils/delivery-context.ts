import { normalizeAccountId } from "./account-id.js";
import { normalizeMessageChannel } from "./message-channel.js";

export type DeliveryContext = {
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
};

export type DeliveryContextSessionSource = {
  channel?: string;
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
  deliveryContext?: DeliveryContext;
};

/**
 * 规范化投递上下文（DeliveryContext）对象
 * 
 * 此函数对输入的投递上下文进行清洗和规范化处理，确保字段格式一致并去除不必要的空白字符。
 * 如果所有规范化后的字段都为空，则返回 undefined，避免创建无效的上下文对象。
 * 
 * @param context - 可选的原始投递上下文对象，可能包含各种格式的字段
 * @returns 规范化后的投递上下文对象，如果所有字段都无效则返回 undefined
 */
export function normalizeDeliveryContext(context?: DeliveryContext): DeliveryContext | undefined {
  if (!context) {
    return undefined;
  }

  const channel =
    typeof context.channel === "string"
      ? (normalizeMessageChannel(context.channel) ?? context.channel.trim())
      : undefined;

  // 去除空白字符
  const to = typeof context.to === "string" ? context.to.trim() : undefined;
  const accountId = normalizeAccountId(context.accountId);
  const threadId =
    typeof context.threadId === "number" && Number.isFinite(context.threadId)
      ? Math.trunc(context.threadId)
      : typeof context.threadId === "string"
      ? context.threadId.trim()
      :undefined;
  const normalizedThreadId =
    typeof threadId === "string" ? (threadId ? threadId : undefined) : threadId;
    
  if (!channel && !to && !accountId && normalizedThreadId == null) {
    return undefined;
  }

  // 构建规范化后的上下文对象
  const normalized: DeliveryContext = {
    channel: channel || undefined, // 确保明确设置为 undefined（而非空字符串）
    to: to || undefined,
    accountId,
  };

  // 只有在 threadId 有值时才添加到对象中（可选字段）
  if (normalizedThreadId != null) {
    normalized.threadId = normalizedThreadId;
  }

  return normalized;
}

export function normalizeSessionDeliveryFields(source?: DeliveryContextSessionSource): {
  deliveryContext?: DeliveryContext;
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
} {
  if (!source) {
    return {
      deliveryContext: undefined,
      lastChannel: undefined,
      lastTo: undefined,
      lastAccountId: undefined,
      lastThreadId: undefined,
    };
  }

  const merged = mergeDeliveryContext(
    normalizeDeliveryContext({
      channel: source.lastChannel ?? source.channel,
      to: source.lastTo,
      accountId: source.lastAccountId,
      threadId: source.lastThreadId,
    }),
    normalizeDeliveryContext(source.deliveryContext),
  );

  if (!merged) {
    return {
      deliveryContext: undefined,
      lastChannel: undefined,
      lastTo: undefined,
      lastAccountId: undefined,
      lastThreadId: undefined,
    };
  }

  return {
    deliveryContext: merged,
    lastChannel: merged.channel,
    lastTo: merged.to,
    lastAccountId: merged.accountId,
    lastThreadId: merged.threadId,
  };
}

export function deliveryContextFromSession(
  entry?: DeliveryContextSessionSource & { origin?: { threadId?: string | number } },
): DeliveryContext | undefined {
  if (!entry) {
    return undefined;
  }
  const source: DeliveryContextSessionSource = {
    channel: entry.channel,
    lastChannel: entry.lastChannel,
    lastTo: entry.lastTo,
    lastAccountId: entry.lastAccountId,
    lastThreadId: entry.lastThreadId ?? entry.deliveryContext?.threadId ?? entry.origin?.threadId,
    deliveryContext: entry.deliveryContext,
  };
  return normalizeSessionDeliveryFields(source).deliveryContext;
}

export function mergeDeliveryContext(
  primary?: DeliveryContext,
  fallback?: DeliveryContext,
): DeliveryContext | undefined {
  const normalizedPrimary = normalizeDeliveryContext(primary);
  const normalizedFallback = normalizeDeliveryContext(fallback);
  if (!normalizedPrimary && !normalizedFallback) {
    return undefined;
  }
  return normalizeDeliveryContext({
    channel: normalizedPrimary?.channel ?? normalizedFallback?.channel,
    to: normalizedPrimary?.to ?? normalizedFallback?.to,
    accountId: normalizedPrimary?.accountId ?? normalizedFallback?.accountId,
    threadId: normalizedPrimary?.threadId ?? normalizedFallback?.threadId,
  });
}

export function deliveryContextKey(context?: DeliveryContext): string | undefined {
  const normalized = normalizeDeliveryContext(context);
  if (!normalized?.channel || !normalized?.to) {
    return undefined;
  }
  const threadId =
    normalized.threadId != null && normalized.threadId !== "" ? String(normalized.threadId) : "";
  return `${normalized.channel}|${normalized.to}|${normalized.accountId ?? ""}|${threadId}`;
}
