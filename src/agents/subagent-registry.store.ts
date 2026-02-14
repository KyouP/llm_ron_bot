import path from "node:path";
import type { SubagentRunRecord } from "./subagent-registry.js";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";

export type PersistedSubagentRegistryVersion = 1 | 2;

type PersistedSubagentRegistryV1 = {
  version: 1;
  runs: Record<string, LegacySubagentRunRecord>;
};

type PersistedSubagentRegistryV2 = {
  version: 2;
  runs: Record<string, PersistedSubagentRunRecord>;
};

type PersistedSubagentRegistry = PersistedSubagentRegistryV1 | PersistedSubagentRegistryV2;

const REGISTRY_VERSION = 2 as const;

type PersistedSubagentRunRecord = SubagentRunRecord;

type LegacySubagentRunRecord = PersistedSubagentRunRecord & {
  announceCompletedAt?: unknown;
  announceHandled?: unknown;
  requesterChannel?: unknown;
  requesterAccountId?: unknown;
};

export function resolveSubagentRegistryPath(): string {
  return path.join(resolveStateDir(), "subagents", "runs.json");
}

/**
 * 从磁盘加载子代理运行记录
 * 1. 解析为PersistedSubagentRegistry类型
 * 2. 处理旧版本数据迁移（V1 -> V2）
 * 
 * @returns 包含子代理运行记录的Map，键为runId
 */
export function loadSubagentRegistryFromDisk(): Map<string, SubagentRunRecord> {
  const pathname = resolveSubagentRegistryPath();
  console.log(`加载子代理注册文件: ${pathname}`);
  const raw = loadJsonFile(pathname);
  if (!raw || typeof raw !== "object") {
    return new Map();
  }
  // TODO: 处理旧版本V1/V2时return空Map
  const record = raw as Partial<PersistedSubagentRegistry>;
  if (record.version !== 1 && record.version !== 2) {
    return new Map();
  }
  const runsRaw = record.runs;
  if (!runsRaw || typeof runsRaw !== "object") {
    return new Map();
  }
  const out = new Map<string, SubagentRunRecord>(); // 存储处理后的结果

 /**
 * 将旧版本subagent运行记录转换为新格式
 * 
 * 主要功能：
 * 1. 检测version=1的旧版数据
 * 2. 将旧字段映射到新字段结构
 * 3. 规范化请求来源信息
 * 4. 自动保存迁移后的数据
 * 
 * @param record 包含版本信息的父记录
 * @param runsRaw 原始运行记录对象，键为runId
 * @returns 处理后的记录Map
 */
const isLegacy = record.version === 1; // 检测是否为旧版本数据
let migrated = false; // 标记是否有数据被迁移

// 遍历所有原始运行记录
  for (const [runId, entry] of Object.entries(runsRaw)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
  
  // 类型断言：假设entry符合旧版记录结构
  const typed = entry as LegacySubagentRunRecord;
  
  if (!typed.runId || typeof typed.runId !== "string") {
    continue;
  }
  
  // 处理完成时间字段迁移
  // 旧版本使用announceCompletedAt，新版本使用cleanupCompletedAt
    const legacyCompletedAt =
      isLegacy && typeof typed.announceCompletedAt === "number"
        ? typed.announceCompletedAt  // 旧版本字段
        : undefined;
    // 优先使用新字段，回退到旧字段（如果存在）
    const cleanupCompletedAt =
      typeof typed.cleanupCompletedAt === "number" ? typed.cleanupCompletedAt : legacyCompletedAt;
    // 处理清理状态字段迁移
    // 旧版本逻辑更复杂，需要推导清理状态
    const cleanupHandled =
      typeof typed.cleanupHandled === "boolean"
        ? typed.cleanupHandled
        : isLegacy
          ? Boolean(typed.announceHandled ?? cleanupCompletedAt)  // 旧版本推导逻辑
          : undefined;  // 非旧版本且没有新字段则为undefined

  // 规范化请求来源信息
  // 旧版本使用分立的channel和accountId，新版本统一为requesterOrigin
    const requesterOrigin = normalizeDeliveryContext(
      typed.requesterOrigin ?? {
        channel: typeof typed.requesterChannel === "string" ? typed.requesterChannel : undefined,
        accountId:
          typeof typed.requesterAccountId === "string" ? typed.requesterAccountId : undefined,
      },
    );
    // 移除不再需要的旧字段，避免数据污染
    const {
    announceCompletedAt: _announceCompletedAt,  // 旧版完成时间
    announceHandled: _announceHandled,          // 旧版处理状态
    requesterChannel: _channel,                  // 旧版通道字段
    requesterAccountId: _accountId,              // 旧版账户ID
    ...rest  // 保留其他所有字段
    } = typed;
  
  // 构建新的记录对象
  out.set(runId, {
    ...rest,                  // 保留原记录的其他字段
    requesterOrigin,          // 规范化的请求来源
    cleanupCompletedAt,       // 统一后的完成时间
    cleanupHandled,           // 统一后的处理状态
    });
  
    // 标记发生了数据迁移
    if (isLegacy) {
      migrated = true;
    }
  }

  // 如果发生了迁移，保存到磁盘
  if (migrated) {
    try {
      saveSubagentRegistryToDisk(out);
  } catch (error) {
    // 忽略迁移保存失败，避免阻塞主流程
    console.warn('Migration save failed:', error)
    }
  }
  return out;
}

/**
 * 保存子代理运行记录到磁盘
 * 
 * 主要功能：
 * 1. 将子代理运行记录转换为持久化格式
 * 2. 包含版本信息和运行记录数组
 * 
 * @param runs 包含子代理运行记录的Map，键为runId
 */
export function saveSubagentRegistryToDisk(runs: Map<string, SubagentRunRecord>) {
  const pathname = resolveSubagentRegistryPath();
  const serialized: Record<string, PersistedSubagentRunRecord> = {};
  for (const [runId, entry] of runs.entries()) {
    serialized[runId] = entry;
  }
  const out: PersistedSubagentRegistry = {
    version: REGISTRY_VERSION,
    runs: serialized,
  };
  saveJsonFile(pathname, out);
}
