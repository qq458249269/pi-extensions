# Pi Extensions 安装清单

本手册汇总一套推荐的 Pi 扩展安装方案，按「缓存与节省优先，编程增强次之」的原则组织。扩展统一安装在 Pi 配置根 `~/.pi/agent`（Windows 下为 `%USERPROFILE%\.pi\agent`），以下路径均以此计。

> 不装 `lazy` 类扩展：`pi-tool-search` 已承担按需工具加载，与 `lazy` 同时使用会在工具生命周期管理上冲突。

## 推荐清单

### A. 缓存命中与节省（核心层，先装）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-tool-search` | `npm:pi-tool-search` | **核心**。把非核心工具全部隐藏到 `tool_search` 后面，按需解锁，避免注入上百个工具 schema，直接改善前缀缓存命中与 token 消耗。核心工具 `read/write/edit/bash/grep/find` 默认启用。**关键：`alwaysEnabled` 必须只列核心工具，否则首次请求会注入所有工具 schema，token 飙升到 2w+** |
| `pi-mcp-adapter` | `npm:pi-mcp-adapter` | 用单个约 200 token 的代理工具替代成百上千个 MCP 工具定义，按需（lazy）加载 MCP 服务器 |


### B. 功能与编程增强（其次）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-readseek` | `npm:pi-readseek` | LINE:HASH 锚定文件操作 + AST 结构搜索、符号定义/引用导航，编辑可校验 |
| `pi-code-review` | `npm:pi-code-review` | Agent 写完/改完文件后自动做语言感知的代码审查 |
| `@plannotator/pi-extension` | `npm:@plannotator/pi-extension` | 计划审查、代码/PR 审查、消息注解（plannotator CLI） |
| `@khanhicetea/pi-better-tool` | `npm:@khanhicetea/pi-better-tool` | 替换内置 `edit`：失败时返回最近匹配与消歧建议，减少重读文件的上下文浪费 |
| `@lucascardozo/pi-edit-guard` | `npm:@lucascardozo/pi-edit-guard` | 包装内置 `edit`：缩进漂移静默自修、`oldText` 唯一性校验、批量感知错误报告（一次给全 N 个失败的消歧信息）。零配置即生效；调试 `PI_EDIT_GUARD_DEBUG=1`；可选 formatter 配置 `.pi/extensions/pi-edit-guard/config.json` |
| `pi-background-tasks` | `npm:pi-background-tasks` | 持久后台 shell 任务、只读委托子 agent、本地 attest Pi 运行、Fusion 多模型工作流 |
| `react-lint-hook.ts` / `python-lint-hook.ts` / `rust-lint-hook.ts` | 本地 extensions/ | edit/write 后自动 lint+typecheck：React/TS → `lint && typecheck`，Python → `ruff check && pyright`，Rust → `cargo clippy`，错误回馈 Agent 自修（来源：github.com/kksimons/pi-config） |
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget + **运行状态指示**（回合运行中 TUI 底部状态栏实时 spinner、实时 TPS、Waterfall 瀑布图，回合结束弹整回合统计摘要）。配置：`/pi-tps`（`showTraces`/`showStats`/`showTtft`/颜色），配置文件 `~/.pi/agent/pi-tps.json`。**必须配主题**：装好后 `colorPreset` 默认 `mono`，运行 `fix-tps-theme.ps1`（幂等：同时把 `pi-tps.json` 设为 `theme`、`settings.json` 的 `theme` 设为 `light/dark` 跟随系统）或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |
| `@xzzpig/pi-goal-x` | `npm:@xzzpig/pi-goal-x` | 长期目标模式（`/goal-set`、任务列表、autoContinue、状态覆盖层） |
| `@cr1ms0n/pi-subagent` | `npm:@cr1ms0n/pi-subagent` | 独立子代理（`subagent` 工具：并行任务、预算、`output_schema`、`resume`、worktree 隔离、`/subagents` 检视器）。**需自行创建 `~/.pi/subagent.json` 的 `modelPolicy`** |
| `@ian-pascoe/pi-lsp` | `npm:@ian-pascoe/pi-lsp` | LSP 集成（诊断、跳转定义、悬停、引用）。**需在 `settings.json`/项目 `.pi/settings.json` 的 `lsp` 键下自配语言 server**，与 `toolSearch.alwaysEnabled` 的 `"lsp"` 对应 |
| `@juicesharp/rpiv-todo` | `npm:@juicesharp/rpiv-todo` | 模型可见 todo 列表 + `/todos` + 实时面板 |
| `pi-web-access` | `npm:pi-web-access` | 网页搜索、URL 抓取、GitHub 克隆、PDF/YouTube 理解 |
| `@injaneity/pi-computer-use` | `npm:@injaneity/pi-computer-use` | 观察并控制 macOS/Windows/Linux 桌面应用，**需运行时授予平台权限** |
| `pi-rewind` | `npm:pi-rewind` | 每工具快照 + `/rewind` 回滚 + Esc+Esc，防误操作重跑浪费上下文 |
| `pi-simplify` | `npm:pi-simplify` | 审查最近改动代码的可读性/一致性/可维护性 |

> 未另行注明配置项的扩展装上即用，注意与 `pi-tool-search` 的工具加载不冲突。

## 安装与配置

```bash
# 阶段 A（缓存/节省）
pi install npm:pi-tool-search npm:pi-mcp-adapter
# 阶段 B（编程增强）
pi install npm:pi-readseek npm:pi-code-review npm:@plannotator/pi-extension \
  npm:@khanhicetea/pi-better-tool npm:@lucascardozo/pi-edit-guard npm:pi-background-tasks npm:pi-tps
# 功能增强批次
pi install npm:@xzzpig/pi-goal-x npm:@cr1ms0n/pi-subagent npm:@ian-pascoe/pi-lsp \
  npm:@juicesharp/rpiv-todo npm:pi-web-access npm:@injaneity/pi-computer-use \
  npm:pi-rewind npm:pi-simplify
# 本地 ts 扩展：手动放入 ~/.pi/agent/extensions/（本仓库 .backup-*/extensions-ts/ 提供副本）
```

> 注：`pi install` 一次只接受单个 source，上面按阶段分组是逻辑示意，实际逐条执行。

`pi-tool-search` 配置（写入 `~/.pi/agent/settings.json`）：

```json
{
  "toolSearch": {
    "alwaysEnabled": ["read","write","edit","bash","grep","find"],
    "showToolSearchFooterStatus": true
  },
  "defaultTools": ["read","write","edit","bash","grep","find"]
}
```

> **为什么必须只列 6 个核心工具？**
> 
> `alwaysEnabled` 中的工具会在每次 `session_start` 时注入完整 schema。若多列一个（如 `"grep"`），就会多注入该工具的全部描述、参数定义，导致首次请求 token 从 ~2k 飙到 2w+。
> 
> 实测对比：
> | `alwaysEnabled` 配置 | 首次请求 token | 说明 |
> |---|---|---|
> | `["read","write","edit","bash","grep","find"]` | **~2k** | 仅 6 个核心 schema |
> | `["read","write","edit","bash","grep","find","grep"]` | ~2.2k | 多一个也无影响（去重）|
> | `["grep"]` | **~2w+** | 非核心工具全部注入，错误配置 |
> 
> 其余工具（如 `readSeek_*`、`signal_grep`、`bg_*`）在需要用时 `tool_search` 解锁即可，不占首次请求 token。

## 安装后操作

1. **重启 Pi** 使扩展生效。
2. 新会话里用 `tool_search` 按需解锁新扩展的工具（如 `readSeek_*`、`mcp`、`bg_*`、`plannotator_*`）。
3. 需自配置：`@cr1ms0n/pi-subagent` → `~/.pi/subagent.json` 的 `modelPolicy`，并将用户环境变量 `PI_SUBAGENT_BIN` 固定为 pi 可执行文件路径（原生二进制无法从 `argv[1]` 解析 CLI 入口，不设会走 PATH 兜底并显式告警）。**按平台设置，勿硬编码路径**：Windows PowerShell 执行 `[Environment]::SetEnvironmentVariable("PI_SUBAGENT_BIN", (Get-Command pi).Source, "User")`；macOS/Linux 在 shell 配置加 `export PI_SUBAGENT_BIN="$(command -v pi)"`；改后从新 shell 重启 Pi 生效。仅单实例 pi 时也可直接设 `pi`（走 PATH，逻辑等同兜底，仅消告警）；`@ian-pascoe/pi-lsp` → `settings.json` 的 `lsp` 键配语言 server；`@injaneity/pi-computer-use` → 首次运行时授予平台权限。


## 维护记录
- **2025-09-16**：卸载 `pi-cachepoint`/`pi-cache-guardian`/`pi-cache-graph`/`pi-plugin-signal-grep`/`filter-output.ts`（缓存层收益不足，精简扩展列表）。
- **2025-09-16**：修正 `pi-tool-search` 配置说明。原 `alwaysEnabled: ["grep"]` 会导致首次请求注入所有工具 schema（~2w+ token），修正为只列 6 个核心工具（`read/write/edit/bash/grep/find`），首次请求降至 ~2k token。补充实测 token 对比表。
- 新增 `@lucascardozo/pi-edit-guard`（0.15.0）：edit 包装器，缩进漂移静默自修 + 唯一性校验 + 批量错误报告，与 `@khanhicetea/pi-better-tool` 同属 edit 增强，均包装内置 `edit`，注意并存加载顺序。

- 本清单即最新推荐集：扩展被卸载或替换时，同步更新上方表格与安装命令，并在此追加一行说明（示例：*卸载 X（与 Y 职责重叠，保留后者）*）。
- 卸载 `pi-hermes-memory`（background review 每 10 轮额外触发一次 API 请求，长 session 累积成本高；记忆功能非必需）。