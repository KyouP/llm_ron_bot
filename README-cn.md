# 🦞 OpenClaw — 个人 AI 助手

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/openclaw/openclaw/main/docs/assets/openclaw-logo-text-dark.png">
        <img src="https://raw.githubusercontent.com/openclaw/openclaw/main/docs/assets/openclaw-logo-text.png" alt="OpenClaw" width="500">
    </picture>
</p>

<p align="center">
  <strong>蜕壳！蜕壳！(EXFOLIATE! EXFOLIATE!)</strong>
</p>

<p align="center">
  <a href="https://github.com/openclaw/openclaw/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/openclaw/openclaw/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/openclaw/openclaw/releases"><img src="https://img.shields.io/github/v/release/openclaw/openclaw?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://discord.gg/clawd"><img src="https://img.shields.io/discord/1456350064065904867?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**OpenClaw** 是一个运行在你自有设备上的*个人 AI 助手*。
它能在你已使用的渠道（WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, WebChat）上回复你，还支持扩展渠道如 BlueBubbles, Matrix, Zalo 和 Zalo Personal。它可以在 macOS/iOS/Android 上进行听说交互，并能渲染一个你可以控制的实时 Canvas（画布）。Gateway（网关）仅仅是控制平面——产品本身是这个助手。

如果你想要一个感觉完全本地化、快速且永远在线的个人单用户助手，这就是你的选择。

[官网](https://openclaw.ai) · [文档](https://docs.openclaw.ai) · [DeepWiki](https://deepwiki.com/openclaw/openclaw) · [由此开始](https://docs.openclaw.ai/start/getting-started) · [更新指南](https://docs.openclaw.ai/install/updating) · [展示](https://docs.openclaw.ai/start/showcase) · [常见问题](https://docs.openclaw.ai/start/faq) · [向导](https://docs.openclaw.ai/start/wizard) · [Nix](https://github.com/openclaw/nix-clawdbot) · [Docker](https://docs.openclaw.ai/install/docker) · [Discord](https://discord.gg/clawd)

推荐设置：运行入门向导 (`openclaw onboard`)。它会引导你完成 Gateway、工作区、渠道和技能的设置。CLI 向导是推荐的路径，支持 **macOS, Linux 和 Windows (通过 WSL2; 强烈推荐)**。
支持 npm, pnpm 或 bun。
新安装？从这里开始：[由此开始](https://docs.openclaw.ai/start/getting-started)

**订阅 (OAuth):**

- **[Anthropic](https://www.anthropic.com/)** (Claude Pro/Max)
- **[OpenAI](https://openai.com/)** (ChatGPT/Codex)

模型说明：虽然支持任何模型，但我强烈推荐 **Anthropic Pro/Max (100/200) + Opus 4.5**，因为它具有长上下文优势和更好的抗提示词注入（prompt-injection）能力。参见 [入职指南](https://docs.openclaw.ai/start/onboarding)。

## 模型 (选择 + 认证)

- 模型配置 + CLI: [模型](https://docs.openclaw.ai/concepts/models)
- 认证配置文件轮换 (OAuth vs API keys) + 故障回退: [模型故障转移](https://docs.openclaw.ai/concepts/model-failover)

## 安装 (推荐)

运行环境：**Node ≥22**。

```bash
npm install -g openclaw@latest
# 或者: pnpm add -g openclaw@latest

openclaw onboard --install-daemon
```

向导会安装 Gateway 守护进程（launchd/systemd 用户服务），以便它保持运行。

## 快速开始 (太长不看版)

运行环境：**Node ≥22**。

完整新手指南（认证、配对、渠道）：[由此开始](https://docs.openclaw.ai/start/getting-started)

```bash
openclaw onboard --install-daemon

openclaw gateway --port 18789 --verbose

# 发送一条消息
openclaw message send --to +1234567890 --message "Hello from OpenClaw"

# 与助手对话（可选择回传到任何已连接的渠道：WhatsApp/Telegram/Slack/Discord/Google Chat/Signal/iMessage/BlueBubbles/Microsoft Teams/Matrix/Zalo/Zalo Personal/WebChat）
openclaw agent --message "Ship checklist" --thinking high
```

升级？请查看 [更新指南](https://docs.openclaw.ai/install/updating) (并运行 `openclaw doctor`)。

## 开发通道 (Channels)

- **stable (稳定版)**: 标记发布的版本 (`vYYYY.M.D` 或 `vYYYY.M.D-<patch>`)，npm dist-tag 为 `latest`。
- **beta (测试版)**: 预发布标记 (`vYYYY.M.D-beta.N`)，npm dist-tag 为 `beta` (macOS 应用可能缺失)。
- **dev (开发版)**: `main` 分支的最新动态，npm dist-tag 为 `dev` (当发布时)。

切换通道 (git + npm): `openclaw update --channel stable|beta|dev`。
详情：[开发通道](https://docs.openclaw.ai/install/development-channels)。

## 从源码构建 (开发)

从源码构建时首选 `pnpm`。Bun 是可选的，用于直接运行 TypeScript。

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw

pnpm install
pnpm ui:build # 首次运行时自动安装 UI 依赖
pnpm build

pnpm openclaw onboard --install-daemon

# 开发循环（TS 文件变更时自动重载）
pnpm gateway:watch
```

注意：`pnpm openclaw ...` 会直接运行 TypeScript (通过 `tsx`)。`pnpm build` 会生成 `dist/` 目录，用于通过 Node 或打包好的 `openclaw` 二进制文件运行。

## 安全默认值 (私信访问)

OpenClaw 连接到真实的通讯平台。请将入站私信 (DM) 视为 **不可信输入**。

完整安全指南：[安全](https://docs.openclaw.ai/gateway/security)

在 Telegram/WhatsApp/Signal/iMessage/Microsoft Teams/Discord/Google Chat/Slack 上的默认行为：

- **私信配对 (DM pairing)** (`dmPolicy="pairing"` / `channels.discord.dm.policy="pairing"` / `channels.slack.dm.policy="pairing"`): 未知发送者会收到一个简短的配对码，机器人不会处理他们的消息。
- 批准方式：`openclaw pairing approve <channel> <code>` (然后该发送者会被添加到本地白名单存储中)。
- 公开入站私信需要显式开启：设置 `dmPolicy="open"` 并在渠道白名单中包含 `"*"` (`allowFrom` / `channels.discord.dm.allowFrom` / `channels.slack.dm.allowFrom`)。

运行 `openclaw doctor` 可以检测有风险或配置错误的私信策略。

## 亮点

- **[本地优先的 Gateway](https://docs.openclaw.ai/gateway)** — 用于会话、渠道、工具和事件的单一控制平面。
- **[多渠道收件箱](https://docs.openclaw.ai/channels)** — WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, BlueBubbles, Microsoft Teams, Matrix, Zalo, Zalo Personal, WebChat, macOS, iOS/Android。
- **[多智能体路由](https://docs.openclaw.ai/gateway/configuration)** — 将入站渠道/账户/对等端路由到隔离的智能体（工作区 + 每个智能体的会话）。
- **[语音唤醒 (Voice Wake)](https://docs.openclaw.ai/nodes/voicewake) + [对话模式 (Talk Mode)](https://docs.openclaw.ai/nodes/talk)** — macOS/iOS/Android 上基于 ElevenLabs 的全天候语音功能。
- **[实时 Canvas](https://docs.openclaw.ai/platforms/mac/canvas)** — 由智能体驱动的视觉工作区，支持 [A2UI](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui)。
- **[一等公民工具](https://docs.openclaw.ai/tools)** — 浏览器, canvas, 节点, cron, 会话以及 Discord/Slack 动作。
- **[配套应用](https://docs.openclaw.ai/platforms/macos)** — macOS 菜单栏应用 + iOS/Android [节点](https://docs.openclaw.ai/nodes)。
- **[入职引导](https://docs.openclaw.ai/start/wizard) + [技能](https://docs.openclaw.ai/tools/skills)** — 向导式设置，包含捆绑/托管/工作区技能。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=openclaw/openclaw&type=date&legend=top-left)](https://www.star-history.com/#openclaw/openclaw&type=date&legend=top-left)

## 到目前为止我们构建的一切

### 核心平台

- [Gateway WS 控制平面](https://docs.openclaw.ai/gateway) 包含会话、状态、配置、cron、webhooks、[控制 UI](https://docs.openclaw.ai/web) 和 [Canvas 主机](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui)。
- [CLI 界面](https://docs.openclaw.ai/tools/agent-send): gateway, agent, send, [向导 (wizard)](https://docs.openclaw.ai/start/wizard) 和 [医生 (doctor)](https://docs.openclaw.ai/gateway/doctor)。
- [Pi 智能体运行时](https://docs.openclaw.ai/concepts/agent) 运行于 RPC 模式，支持工具流式传输和块流式传输。
- [会话模型](https://docs.openclaw.ai/concepts/session): `main` 用于直接聊天、群组隔离、激活模式、队列模式、自动回复。群组规则：[群组](https://docs.openclaw.ai/concepts/groups)。
- [媒体管道](https://docs.openclaw.ai/nodes/images): 图像/音频/视频、转录钩子、大小限制、临时文件生命周期。音频详情：[音频](https://docs.openclaw.ai/nodes/audio)。

### 渠道

- [渠道](https://docs.openclaw.ai/channels): [WhatsApp](https://docs.openclaw.ai/channels/whatsapp) (Baileys), [Telegram](https://docs.openclaw.ai/channels/telegram) (grammY), [Slack](https://docs.openclaw.ai/channels/slack) (Bolt), [Discord](https://docs.openclaw.ai/channels/discord) (discord.js), [Google Chat](https://docs.openclaw.ai/channels/googlechat) (Chat API), [Signal](https://docs.openclaw.ai/channels/signal) (signal-cli), [iMessage](https://docs.openclaw.ai/channels/imessage) (imsg), [BlueBubbles](https://docs.openclaw.ai/channels/bluebubbles) (扩展), [Microsoft Teams](https://docs.openclaw.ai/channels/msteams) (扩展), [Matrix](https://docs.openclaw.ai/channels/matrix) (扩展), [Zalo](https://docs.openclaw.ai/channels/zalo) (扩展), [Zalo Personal](https://docs.openclaw.ai/channels/zalouser) (扩展), [WebChat](https://docs.openclaw.ai/web/webchat)。
- [群组路由](https://docs.openclaw.ai/concepts/group-messages): 提及（Mention）门控、回复标签、每渠道分块和路由。渠道规则：[渠道](https://docs.openclaw.ai/channels)。

### 应用 + 节点

- [macOS 应用](https://docs.openclaw.ai/platforms/macos): 菜单栏控制平面, [语音唤醒](https://docs.openclaw.ai/nodes/voicewake)/按键通话 (PTT), [对话模式](https://docs.openclaw.ai/nodes/talk) 覆盖层, [WebChat](https://docs.openclaw.ai/web/webchat), 调试工具, [远程 Gateway](https://docs.openclaw.ai/gateway/remote) 控制。
- [iOS 节点](https://docs.openclaw.ai/platforms/ios): [Canvas](https://docs.openclaw.ai/platforms/mac/canvas), [语音唤醒](https://docs.openclaw.ai/nodes/voicewake), [对话模式](https://docs.openclaw.ai/nodes/talk), 相机, 屏幕录制, Bonjour 配对。
- [Android 节点](https://docs.openclaw.ai/platforms/android): [Canvas](https://docs.openclaw.ai/platforms/mac/canvas), [对话模式](https://docs.openclaw.ai/nodes/talk), 相机, 屏幕录制, 可选短信。
- [macOS 节点模式](https://docs.openclaw.ai/nodes): system.run/notify + canvas/camera 暴露。

### 工具 + 自动化

- [浏览器控制](https://docs.openclaw.ai/tools/browser): 专用的 openclaw Chrome/Chromium, 快照, 动作, 上传, 配置文件。
- [Canvas](https://docs.openclaw.ai/platforms/mac/canvas): [A2UI](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui) 推送/重置, eval, 快照。
- [节点 (Nodes)](https://docs.openclaw.ai/nodes): 相机快照/剪辑, 屏幕录制, [location.get](https://docs.openclaw.ai/nodes/location-command), 通知。
- [Cron + 唤醒](https://docs.openclaw.ai/automation/cron-jobs); [webhooks](https://docs.openclaw.ai/automation/webhook); [Gmail Pub/Sub](https://docs.openclaw.ai/automation/gmail-pubsub)。
- [技能平台](https://docs.openclaw.ai/tools/skills): 包含安装门控 + UI 的捆绑、托管和工作区技能。

### 运行时 + 安全

- [渠道路由](https://docs.openclaw.ai/concepts/channel-routing), [重试策略](https://docs.openclaw.ai/concepts/retry), 和 [流式传输/分块](https://docs.openclaw.ai/concepts/streaming)。
- [状态 (Presence)](https://docs.openclaw.ai/concepts/presence), [正在输入指示器](https://docs.openclaw.ai/concepts/typing-indicators), 和 [用量追踪](https://docs.openclaw.ai/concepts/usage-tracking)。
- [模型](https://docs.openclaw.ai/concepts/models), [模型故障转移](https://docs.openclaw.ai/concepts/model-failover), 和 [会话修剪](https://docs.openclaw.ai/concepts/session-pruning)。
- [安全](https://docs.openclaw.ai/gateway/security) 和 [故障排除](https://docs.openclaw.ai/channels/troubleshooting)。

### 运维 + 打包

- [控制 UI](https://docs.openclaw.ai/web) + [WebChat](https://docs.openclaw.ai/web/webchat) 直接由 Gateway 提供服务。
- [Tailscale Serve/Funnel](https://docs.openclaw.ai/gateway/tailscale) 或带令牌/密码认证的 [SSH 隧道](https://docs.openclaw.ai/gateway/remote)。
- [Nix 模式](https://docs.openclaw.ai/install/nix) 用于声明式配置; 基于 [Docker](https://docs.openclaw.ai/install/docker) 的安装。
- [医生 (Doctor)](https://docs.openclaw.ai/gateway/doctor) 迁移, [日志记录](https://docs.openclaw.ai/logging)。

## 工作原理 (简述)

```
WhatsApp / Telegram / Slack / Discord / Google Chat / Signal / iMessage / BlueBubbles / Microsoft Teams / Matrix / Zalo / Zalo Personal / WebChat
               │
               ▼
┌───────────────────────────────┐
│            Gateway            │
│          (控制平面)             │
│     ws://127.0.0.1:18789      │
└──────────────┬────────────────┘
               │
               ├─ Pi agent (RPC)
               ├─ CLI (openclaw …)
               ├─ WebChat UI
               ├─ macOS App
               └─ iOS / Android Nodes
```

## 关键子系统

- **[Gateway WebSocket 网络](https://docs.openclaw.ai/concepts/architecture)** — 用于客户端、工具和事件的单一 WS 控制平面（外加运维：[Gateway 运行手册](https://docs.openclaw.ai/gateway)）。
- **[Tailscale 暴露](https://docs.openclaw.ai/gateway/tailscale)** — 用于 Gateway 仪表板 + WS 的 Serve/Funnel（远程访问：[Remote](https://docs.openclaw.ai/gateway/remote)）。
- **[浏览器控制](https://docs.openclaw.ai/tools/browser)** — openclaw 管理的 Chrome/Chromium，带有 CDP 控制。
- **[Canvas + A2UI](https://docs.openclaw.ai/platforms/mac/canvas)** — 智能体驱动的视觉工作区（A2UI 主机：[Canvas/A2UI](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui)）。
- **[语音唤醒 (Voice Wake)](https://docs.openclaw.ai/nodes/voicewake) + [对话模式 (Talk Mode)](https://docs.openclaw.ai/nodes/talk)** — 始终开启的语音和连续对话。
- **[节点 (Nodes)](https://docs.openclaw.ai/nodes)** — Canvas, 相机快照/剪辑, 屏幕录制, `location.get`, 通知, 加上仅限 macOS 的 `system.run`/`system.notify`。

## Tailscale 访问 (Gateway 仪表板)

OpenClaw 可以自动配置 Tailscale **Serve** (仅 tailnet 内网) 或 **Funnel** (公开互联网)，同时 Gateway 保持绑定在回环地址 (loopback)。配置 `gateway.tailscale.mode`:

- `off`: 不使用 Tailscale 自动化 (默认)。
- `serve`: 仅 tailnet 的 HTTPS，通过 `tailscale serve` (默认使用 Tailscale 身份头)。
- `funnel`: 公开 HTTPS，通过 `tailscale funnel` (需要共享密码认证)。

注意：

- 当启用 Serve/Funnel 时，`gateway.bind` 必须保持为 `loopback` (OpenClaw 会强制执行此操作)。
- 可以通过设置 `gateway.auth.mode: "password"` 或 `gateway.auth.allowTailscale: false` 强制 Serve 需要密码。
- Funnel 除非设置了 `gateway.auth.mode: "password"`，否则拒绝启动。
- 可选：`gateway.tailscale.resetOnExit` 用于在关机时撤销 Serve/Funnel 设置。

详情：[Tailscale 指南](https://docs.openclaw.ai/gateway/tailscale) · [Web 界面](https://docs.openclaw.ai/web)

## 远程 Gateway (Linux 很棒)

在一个小型 Linux 实例上运行 Gateway 是完全可行的。客户端（macOS 应用, CLI, WebChat）可以通过 **Tailscale Serve/Funnel** 或 **SSH 隧道** 连接，并且你仍然可以配对设备节点 (macOS/iOS/Android) 以在需要时执行设备本地的操作。

- **Gateway 主机** 默认运行 exec 工具和渠道连接。
- **设备节点** 通过 `node.invoke` 运行设备本地的操作（`system.run`, 相机, 屏幕录制, 通知）。
  简而言之：exec 在 Gateway 所在处运行；设备操作在设备所在处运行。

详情：[远程访问](https://docs.openclaw.ai/gateway/remote) · [节点](https://docs.openclaw.ai/nodes) · [安全](https://docs.openclaw.ai/gateway/security)

## 通过 Gateway 协议的 macOS 权限

macOS 应用可以以 **node 模式** 运行，并通过 Gateway WebSocket 广播其能力 + 权限映射 (`node.list` / `node.describe`)。客户端随后可以通过 `node.invoke` 执行本地动作：

- `system.run` 运行本地命令并返回 stdout/stderr/退出码；设置 `needsScreenRecording: true` 以要求屏幕录制权限（否则你会得到 `PERMISSION_MISSING`）。
- `system.notify` 发送用户通知，如果通知被拒绝则失败。
- `canvas.*`, `camera.*`, `screen.record`, 和 `location.get` 也通过 `node.invoke` 路由并遵循 TCC 权限状态。

提权 Bash (主机权限) 与 macOS TCC 是分开的：

- 使用 `/elevated on|off` 来切换启用且在白名单内的每会话提权访问。
- Gateway 通过 `sessions.patch` (WS 方法) 将每会话的切换状态与 `thinkingLevel`, `verboseLevel`, `model`, `sendPolicy`, 和 `groupActivation` 一起持久化。

详情：[节点](https://docs.openclaw.ai/nodes) · [macOS 应用](https://docs.openclaw.ai/platforms/macos) · [Gateway 协议](https://docs.openclaw.ai/concepts/architecture)

## 智能体对智能体 (sessions\_\* 工具)

- 使用这些工具跨会话协调工作，无需在聊天界面之间跳转。
- `sessions_list` — 发现活跃会话（智能体）及其元数据。
- `sessions_history` — 获取会话的转录日志。
- `sessions_send` — 给另一个会话发消息；可选的回复乒乓机制 + 公告步骤 (`REPLY_SKIP`, `ANNOUNCE_SKIP`)。

详情：[会话工具](https://docs.openclaw.ai/concepts/session-tool)

## 技能注册表 (ClawHub)

ClawHub 是一个极简的技能注册表。启用 ClawHub 后，智能体可以自动搜索技能并在需要时拉取新技能。

[ClawHub](https://clawhub.com)

## 聊天命令

在 WhatsApp/Telegram/Slack/Google Chat/Microsoft Teams/WebChat 中发送这些命令（群组命令仅限拥有者）：

- `/status` — 简明会话状态（模型 + token 数，可用时显示成本）
- `/new` 或 `/reset` — 重置会话
- `/compact` — 压缩会话上下文（摘要）
- `/think <level>` — 思考等级：off|minimal|low|medium|high|xhigh (仅限 GPT-5.2 + Codex 模型)
- `/verbose on|off` — 详细模式开关
- `/usage off|tokens|full` — 每次回复的用量页脚
- `/restart` — 重启 Gateway（群组中仅限拥有者）
- `/activation mention|always` — 群组激活切换（仅限群组）

## 应用 (可选)

仅 Gateway 本身就能提供极佳的体验。所有应用都是可选的，用于增加额外功能。

如果你计划构建/运行配套应用，请遵循下方的平台运行手册。

### macOS (OpenClaw.app) (可选)

- Gateway 和健康状况的菜单栏控制。
- 语音唤醒 + 按键通话覆盖层。
- WebChat + 调试工具。
- 通过 SSH 控制远程 Gateway。

注意：需要签名构建才能使 macOS 权限在重新构建后保持不变（参见 `docs/mac/permissions.md`）。

### iOS 节点 (可选)

- 通过 Bridge 配对为节点。
- 语音触发转发 + Canvas 界面。
- 通过 `openclaw nodes …` 控制。

运行手册：[iOS 连接](https://docs.openclaw.ai/platforms/ios)。

### Android 节点 (可选)

- 通过与 iOS 相同的 Bridge + 配对流程进行配对。
- 暴露 Canvas, 相机和屏幕捕获命令。
- 运行手册：[Android 连接](https://docs.openclaw.ai/platforms/android)。

## 智能体工作区 + 技能

- 工作区根目录: `~/.openclaw/workspace` (可通过 `agents.defaults.workspace` 配置)。
- 注入的提示词文件: `AGENTS.md`, `SOUL.md`, `TOOLS.md`。
- 技能: `~/.openclaw/workspace/skills/<skill>/SKILL.md`。

## 配置

最小化 `~/.openclaw/openclaw.json` (模型 + 默认值):

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-5",
  },
}
```

[完整配置参考 (所有键 + 示例)。](https://docs.openclaw.ai/gateway/configuration)

## 安全模型 (重要)

- **默认:** 工具在 **main** 会话的主机上运行，因此如果是你一个人使用，智能体拥有完全访问权限。
- **群组/渠道安全:** 设置 `agents.defaults.sandbox.mode: "non-main"` 以在每会话 Docker 沙箱中运行 **非 main 会话** (群组/渠道)；此时 bash 会在 Docker 中运行。
- **沙箱默认值:** 白名单 `bash`, `process`, `read`, `write`, `edit`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`; 黑名单 `browser`, `canvas`, `nodes`, `cron`, `discord`, `gateway`。

详情：[安全指南](https://docs.openclaw.ai/gateway/security) · [Docker + 沙箱](https://docs.openclaw.ai/install/docker) · [沙箱配置](https://docs.openclaw.ai/gateway/configuration)

### [WhatsApp](https://docs.openclaw.ai/channels/whatsapp)

- 链接设备: `pnpm openclaw channels login` (凭据存储在 `~/.openclaw/credentials`)。
- 通过 `channels.whatsapp.allowFrom` 设置允许谁与助手对话的白名单。
- 如果设置了 `channels.whatsapp.groups`，它将成为群组白名单；包含 `"*"` 以允许所有。

### [Telegram](https://docs.openclaw.ai/channels/telegram)

- 设置 `TELEGRAM_BOT_TOKEN` 或 `channels.telegram.botToken` (环境变量优先级更高)。
- 可选：设置 `channels.telegram.groups` (配合 `channels.telegram.groups."*".requireMention`)；设置后，它是一个群组白名单（包含 `"*"` 以允许所有）。按需设置 `channels.telegram.allowFrom` 或 `channels.telegram.webhookUrl` + `channels.telegram.webhookSecret`。

```json5
{
  channels: {
    telegram: {
      botToken: "123456:ABCDEF",
    },
  },
}
```

### [Slack](https://docs.openclaw.ai/channels/slack)

- 设置 `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (或 `channels.slack.botToken` + `channels.slack.appToken`)。

### [Discord](https://docs.openclaw.ai/channels/discord)

- 设置 `DISCORD_BOT_TOKEN` 或 `channels.discord.token` (环境变量优先级更高)。
- 可选：按需设置 `commands.native`, `commands.text`, 或 `commands.useAccessGroups`, 以及 `channels.discord.dm.allowFrom`, `channels.discord.guilds`, 或 `channels.discord.mediaMaxMb`。

```json5
{
  channels: {
    discord: {
      token: "1234abcd",
    },
  },
}
```

### [Signal](https://docs.openclaw.ai/channels/signal)

- 需要 `signal-cli` 和 `channels.signal` 配置段。

### [iMessage](https://docs.openclaw.ai/channels/imessage)

- 仅限 macOS；必须登录信息 (Messages) 应用。
- 如果设置了 `channels.imessage.groups`，它将成为群组白名单；包含 `"*"` 以允许所有。

### [Microsoft Teams](https://docs.openclaw.ai/channels/msteams)

- 配置 Teams 应用 + Bot Framework，然后添加 `msteams` 配置段。
- 通过 `msteams.allowFrom` 设置白名单；群组访问通过 `msteams.groupAllowFrom` 或 `msteams.groupPolicy: "open"`。

### [WebChat](https://docs.openclaw.ai/web/webchat)

- 使用 Gateway WebSocket；没有单独的 WebChat 端口/配置。

浏览器控制 (可选):

```json5
{
  browser: {
    enabled: true,
    color: "#FF4500",
  },
}
```

## 文档

当你完成入职流程并需要更深入的参考时，请使用这些文档。

- [从文档索引开始，用于导航和了解“什么在哪”。](https://docs.openclaw.ai)
- [阅读架构概览，了解 Gateway + 协议模型。](https://docs.openclaw.ai/concepts/architecture)
- [当需要每个键和示例时，使用完整的配置参考。](https://docs.openclaw.ai/gateway/configuration)
- [按照操作运行手册按部就班地运行 Gateway。](https://docs.openclaw.ai/gateway)
- [了解控制 UI/Web 界面如何工作以及如何安全地暴露它们。](https://docs.openclaw.ai/web)
- [了解通过 SSH 隧道或 tailnet 的远程访问。](https://docs.openclaw.ai/gateway/remote)
- [跟随入职向导流程进行引导式设置。](https://docs.openclaw.ai/start/wizard)
- [通过 webhook 界面连接外部触发器。](https://docs.openclaw.ai/automation/webhook)
- [设置 Gmail Pub/Sub 触发器。](https://docs.openclaw.ai/automation/gmail-pubsub)
- [了解 macOS 菜单栏配套应用的详情。](https://docs.openclaw.ai/platforms/mac/menu-bar)
- [平台指南: Windows (WSL2)](https://docs.openclaw.ai/platforms/windows), [Linux](https://docs.openclaw.ai/platforms/linux), [macOS](https://docs.openclaw.ai/platforms/macos), [iOS](https://docs.openclaw.ai/platforms/ios), [Android](https://docs.openclaw.ai/platforms/android)
- [通过故障排除指南调试常见故障。](https://docs.openclaw.ai/channels/troubleshooting)
- [在暴露任何内容之前查阅安全指南。](https://docs.openclaw.ai/gateway/security)

## 高级文档 (发现 + 控制)

- [发现 + 传输 (Transports)](https://docs.openclaw.ai/gateway/discovery)
- [Bonjour/mDNS](https://docs.openclaw.ai/gateway/bonjour)
- [Gateway 配对](https://docs.openclaw.ai/gateway/pairing)
- [远程 Gateway README](https://docs.openclaw.ai/gateway/remote-gateway-readme)
- [控制 UI](https://docs.openclaw.ai/web/control-ui)
- [仪表板](https://docs.openclaw.ai/web/dashboard)

## 运维 & 故障排除

- [健康检查](https://docs.openclaw.ai/gateway/health)
- [Gateway 锁定](https://docs.openclaw.ai/gateway/gateway-lock)
- [后台进程](https://docs.openclaw.ai/gateway/background-process)
- [浏览器故障排除 (Linux)](https://docs.openclaw.ai/tools/browser-linux-troubleshooting)
- [日志记录](https://docs.openclaw.ai/logging)

## 深度解析

- [智能体循环](https://docs.openclaw.ai/concepts/agent-loop)
- [状态 (Presence)](https://docs.openclaw.ai/concepts/presence)
- [TypeBox 模式](https://docs.openclaw.ai/concepts/typebox)
- [RPC 适配器](https://docs.openclaw.ai/reference/rpc)
- [队列](https://docs.openclaw.ai/concepts/queue)

## 工作区 & 技能

- [技能配置](https://docs.openclaw.ai/tools/skills-config)
- [默认 AGENTS](https://docs.openclaw.ai/reference/AGENTS.default)
- [模板: AGENTS](https://docs.openclaw.ai/reference/templates/AGENTS)
- [模板: BOOTSTRAP](https://docs.openclaw.ai/reference/templates/BOOTSTRAP)
- [模板: IDENTITY](https://docs.openclaw.ai/reference/templates/IDENTITY)
- [模板: SOUL](https://docs.openclaw.ai/reference/templates/SOUL)
- [模板: TOOLS](https://docs.openclaw.ai/reference/templates/TOOLS)
- [模板: USER](https://docs.openclaw.ai/reference/templates/USER)

## 平台内部实现

- [macOS 开发设置](https://docs.openclaw.ai/platforms/mac/dev-setup)
- [macOS 菜单栏](https://docs.openclaw.ai/platforms/mac/menu-bar)
- [macOS 语音唤醒](https://docs.openclaw.ai/platforms/mac/voicewake)
- [iOS 节点](https://docs.openclaw.ai/platforms/ios)
- [Android 节点](https://docs.openclaw.ai/platforms/android)
- [Windows (WSL2)](https://docs.openclaw.ai/platforms/windows)
- [Linux 应用](https://docs.openclaw.ai/platforms/linux)

## 邮件钩子 (Gmail)

- [docs.openclaw.ai/gmail-pubsub](https://docs.openclaw.ai/automation/gmail-pubsub)

## Molty

OpenClaw 是为 **Molty** 构建的，它是一只太空龙虾 AI 助手。🦞
作者 Peter Steinberger 和社区。

- [openclaw.ai](https://openclaw.ai)
- [soul.md](https://soul.md)
- [steipete.me](https://steipete.me)
- [@openclaw](https://x.com/openclaw)

## 社区

查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解准则、维护者以及如何提交 PR。
欢迎提交 AI/vibe-coded 的 PR！🤖

特别感谢 [Mario Zechner](https://mariozechner.at/) 的支持以及 [pi-mono](https://github.com/badlogic/pi-mono)。
特别感谢 Adam Doppelt 开发的 lobster.bot。

感谢所有的贡献者 (Clawtributors)：
