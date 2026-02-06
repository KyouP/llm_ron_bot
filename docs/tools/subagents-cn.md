# 子代理

子代理是从现有代理运行中生成的、在后台运行的代理实例。它们在独立的会话 (`agent:<agentId>:subagent:<uuid>`) 中运行，并在完成后，将其结果**通告**回请求方的聊天频道。

## 斜杠命令

使用 `/subagents` 来检查或控制**当前会话**的子代理运行：

- `/subagents list`
- `/subagents stop <id|#|all>`
- `/subagents log <id|#> [limit] [tools]`
- `/subagents info <id|#>`
- `/subagents send <id|#> <message>`

`/subagents info` 可显示运行的元数据（状态、时间戳、会话ID、transcript路径、cleanup设置）。

主要目标：

-   并行化“研究/长任务/慢速工具”工作，避免阻塞主运行。
-   默认保持子代理隔离（会话分离 + 可选的沙箱机制）。
-   严格控制工具暴露范围以防误用：子代理默认**无法**使用会话工具。
-   避免嵌套扩散：子代理不能再生成子代理。

成本说明：每个子代理拥有**独立的**上下文和tokens使用量。对于繁重或重复性任务，可为子代理设置成本更低的模型，而为主代理保留更高质量的模型。可通过 `agents.defaults.subagents.model` 配置或各代理的覆盖项进行配置。

## 工具

使用 `sessions_spawn` 工具：

-   启动一个子代理运行（设置 `deliver: false`，全局通道为 `subagent`）
-   随后运行一个通告步骤，并将通告回复发送到请求方聊天频道
-   默认模型：继承调用方模型，除非设置了 `agents.defaults.subagents.model`（或各代理的 `agents.list[].subagents.model`）；显式指定的 `sessions_spawn.model` 参数优先级最高。
-   默认thinking模式：继承调用方设置，除非设置了 `agents.defaults.subagents.thinking`（或各代理的 `agents.list[].subagents.thinking`）；显式指定的 `sessions_spawn.thinking` 参数优先级最高。

工具参数：

-   `task` (必需)
-   `label?` (可选)
-   `agentId?` (可选；若被允许，可在另一个代理ID下生成子代理)
-   `model?` (可选；覆盖子代理使用的模型；无效值将被忽略，子代理将使用默认模型运行，并在工具结果中记录警告)
-   `thinking?` (可选；覆盖子代理运行的thinking级别)
-   `runTimeoutSeconds?` (默认 `0`；设置后，子代理运行将在N秒后中止)
-   `cleanup?` (`delete|keep`，默认 `keep`)

允许列表：

-   `agents.list[].subagents.allowAgents`: 可通过 `agentId` 参数指定的代理ID列表（`["*"]` 表示允许任何代理）。默认值：仅允许请求方代理自身。

发现可用代理：

-   使用 `agents_list` 工具查看当前允许用于 `sessions_spawn` 的代理ID。

自动归档：

-   子代理会话将在 `agents.defaults.subagents.archiveAfterMinutes`（默认：60）分钟后自动归档。
-   归档操作使用 `sessions.delete`，并将transcript文件重命名为 `*.deleted.<timestamp>`（保存在同一文件夹）。
-   `cleanup: "delete"` 会在通告后立即归档（但仍通过重命名保留transcript文件）。
-   **注意**：自动归档是**尽力而为**的；若网关重启，未触发的归档计时器会丢失。
-   **重要**：`runTimeoutSeconds` 参数**不会**触发自动归档；它仅停止运行。会话本身会保留直至达到自动归档时间。

## 认证

子代理的认证依据**代理ID**（而非会话类型）进行解析：

-   子代理会话密钥格式为 `agent:<agentId>:subagent:<uuid>`。
-   从该代理对应的 `agentDir` 加载认证存储。
-   主代理的认证配置文件会作为**后备**被合并进来；当配置冲突时，子代理自身的配置文件优先级高于主代理配置文件。

**重要说明**：此合并是**叠加式**的，因此主代理的配置文件始终作为后备可用。目前不支持各代理完全隔离的独立认证。

## 通告机制

子代理通过一个通告步骤回传结果：

-   通告步骤在子代理会话内部运行（而非请求方会话）。
-   若子代理的回复恰好为 `ANNOUNCE_SKIP`，则不发布任何消息。
-   否则，通告回复会通过一次后续的 `agent` 调用（`deliver=true`）发布到请求方聊天频道。
-   通告回复在支持时会保持原有的线程/话题路由（如Slack线程、Telegram话题、Matrix线程）。
-   通告消息会被规范化为一个稳定的模板：
    -   `状态:` 根据运行结果衍生（`success`、`error`、`timeout` 或 `unknown`）。
    -   `结果:` 通告步骤中的摘要内容（若缺失则显示 `(not available)`）。
    -   `备注:` 错误详情及其他有用的上下文信息。
-   `状态` 并非从模型输出推断，而是来源于运行时的结果信号。

通告负载的末尾包含一行统计信息（即使消息被包装）：

-   运行时间（例如，`runtime 5m12s`）
-   Tokens使用量（input/output/total）
-   若配置了模型定价则显示估算成本 (`models.providers.*.models[].cost`)
-   `sessionKey`、`sessionId` 及transcript路径（以便主代理可通过 `sessions_history` 获取历史记录或直接查看磁盘文件）

## 工具策略（子代理可用工具）

默认情况下，子代理可以访问**除会话工具外的所有工具**：

-   `sessions_list`
-   `sessions_history`
-   `sessions_send`
-   `sessions_spawn`

可通过配置覆盖此默认行为：

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxConcurrent: 1,
      },
    },
  },
  tools: {
    subagents: {
      tools: {
        // deny 列表优先级最高
        deny: ["gateway", "cron"],
        // 若设置了 allow 列表，则工具访问变为“仅允许”模式（但 deny 列表仍优先生效）
        // allow: ["read", "exec", "process"]
      },
    },
  },
}
```

## 并发控制

子代理使用一个专用的进程内队列通道：

-   通道名称：`subagent`
-   并发数：由 `agents.defaults.subagents.maxConcurrent` 控制（默认 `8`）

## 停止运行

-   在请求方聊天中发送 `/stop` 命令，将中止请求方会话，并**同时停止**由该会话生成的所有活跃子代理运行。

## 限制

-   子代理的通告机制是**尽力而为**的。如果网关重启，未完成的“通告回传”工作会丢失。
-   子代理仍共享同一个网关进程资源；应将 `maxConcurrent` 视为一道安全阀。
-   `sessions_spawn` 工具调用总是**非阻塞**的：它会立即返回 `{ status: "accepted", runId, childSessionKey }`。
-   子代理的上下文中仅注入 `AGENTS.md` 和 `TOOLS.md` 文件（不注入 `SOUL.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md` 或 `BOOTSTRAP.md`）。