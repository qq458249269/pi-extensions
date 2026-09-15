# Pi Extensions 安装清单

本仓库汇总当前环境（`C:\Users\yinxuehao\.pi\agent`）实际启用的 Pi 扩展，按「缓存与节省优先，编程增强次之」的原则组织。2025-09-15 已全量卸载旧扩展并重新规划。

> 不装 `lazy` 类扩展：`pi-tool-search` 已承担按需工具加载，与 `lazy` 同时使用会在工具生命周期管理上冲突。

## 已安装清单

### A. 缓存命中与节省（核心层，先装）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-tool-search` | `npm:pi-tool-search` | **核心**。把非核心工具全部隐藏到 `tool_search` 后面，按需解锁，避免注入上百个工具 schema，直接改善前缀缓存命中与 token 消耗。核心工具 `read/write/edit/bash/grep/find` 默认启用 |
| `pi-mcp-adapter` | `npm:pi-mcp-adapter` | 用单个约 200 token 的代理工具替代成百上千个 MCP 工具定义，按需（lazy）加载 MCP 服务器 |
| `pi-observational-memory` | `npm:pi-observational-memory` | cache-friendly 的分层压缩：压缩时保留观察与反思，避免压缩后上下文前缀全变导致缓存失效 |
| `pi-plugin-signal-grep` | `npm:pi-plugin-signal-grep` | 有界搜索（bounded evidence），只返回可验证的上下文片段，减少搜索结果注入量 |
| `pi-cache-graph` | `npm:pi-cache-graph` | `/cache graph`、`/cache stats` 可视化缓存命中率与每条消息的 token/缓存分解，用于验证上述扩展是否真的利于缓存 |
| `pi-cache-guardian` | `npm:pi-cache-guardian` | 多扩展注入导致的 system prompt 字节漂移会让前缀缓存失效（实测 75% → 0%）。Golden 冻结首轮 system prompt 副本、后续无条件恢复字节级一致；prompt reorder 把稳定内容排前；skills 压缩（4 技能 → 一行索引，31 技能 13.3KB → ~1KB）；剥离 session-overview 每轮变化字段；OpenAI `prompt_cache_retention`/Anthropic TTL 被 400 拒绝时自动降级。`/cache-guardian` 查看每轮 `cacheRead`/`cacheWrite` 统计。env：`PI_CACHE_GUARD=1` 开守护警告（默认阈值 90%）、`PI_CACHE_GUARD_VERBOSE=1` 每轮打印统计 |
| `pi-cachepoint` | `npm:pi-cachepoint` | 在 provider 缓存到期前用**同前缀 shadow summary 请求**让当前模型自生成紧凑 checkpoint（前缀复用缓存，非普通 compaction，保留 recent tail），可经 `/tree` 跳回原上下文。支持 `openai`/`openai-codex`/`anthropic`/`kimi-coding`（后两者各按 5 分钟/1 小时 TTL 调度，Codex/Kimi 始终保守短调度）。`/cachepoint-status` 查看支持状态与定时器。flags：`--cachepoint-min-tokens`（默认 50000）、`--cachepoint-max-summary-tokens`（默认 8192）、`--cachepoint-debug` |
| `pi-hermes-memory` | `npm:pi-hermes-memory` | 持久记忆 + SQLite FTS5 会话搜索 + 秘密扫描；默认 `memoryMode: "policy-only"` 低 token 注入，建议维持默认（`~/.pi/agent/pi-hermes-memory/` 仍有旧数据残留，未清） |
| `filter-output.ts` | 本地 `~/.pi/agent/extensions/` | 工具结果送往模型前过滤噪音代码与测试冗余、脱敏 API 密钥等敏感信息，省 token |

### B. 功能与编程增强（其次）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-readseek` | `npm:pi-readseek` | LINE:HASH 锚定文件操作 + AST 结构搜索、符号定义/引用导航，编辑可校验 |
| `pi-code-review` | `npm:pi-code-review` | Agent 写完/改完文件后自动做语言感知的代码审查 |
| `@plannotator/pi-extension` | `npm:@plannotator/pi-extension` | 计划审查、代码/PR 审查、消息注解（plannotator CLI） |
| `@ff-labs/pi-fff` | `npm:@ff-labs/pi-fff` | Rust SIMD 模糊文件/内容搜索，替换内置 `find`/`grep`，带频率排名与 Git 感知 |
| `@khanhicetea/pi-better-tool` | `npm:@khanhicetea/pi-better-tool` | 替换内置 `edit`：失败时返回最近匹配与消歧建议，减少重读文件的上下文浪费 |
| `pi-background-tasks` | `npm:pi-background-tasks` | 持久后台 shell 任务、只读委托子 agent、本地 attest Pi 运行、Fusion 多模型工作流 |
| `react-lint-hook.ts` / `python-lint-hook.ts` / `rust-lint-hook.ts` | 本地 extensions/ | edit/write 后自动 lint+typecheck：React/TS → `lint && typecheck`，Python → `ruff check && pyright`，Rust → `cargo clippy`，错误回馈 Agent 自修（来源：github.com/kksimons/pi-config） |
| `security.ts` | 本地 extensions/ | 拦截 `bash`，确定性校验危险命令（如 `rm -rf`、`chmod 777`），来源：github.com/michalvavra/agents |
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget + **运行状态指示**（回合运行中 TUI 底部状态栏实时 spinner、实时 TPS、Waterfall 瀑布图，回合结束弹整回合统计摘要）。配置：`/pi-tps`（`showTraces`/`showStats`/`showTtft`/颜色），配置文件 `~/.pi/agent/pi-tps.json`。**必须配主题**：装好后 `colorPreset` 默认 `mono`，运行 `fix-tps-theme.ps1`（幂等：同时把 `pi-tps.json` 设为 `theme`、`settings.json` 的 `theme` 设为 `light/dark` 跟随系统）或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |
| `@xzzpig/pi-goal-x` | `npm:@xzzpig/pi-goal-x` | 长期目标模式（`/goal-set`、任务列表、autoContinue、状态覆盖层） |
| `@cr1ms0n/pi-subagent` | `npm:@cr1ms0n/pi-subagent` | 独立子代理（`subagent` 工具：并行任务、预算、`output_schema`、`resume`、worktree 隔离、`/subagents` 检视器）。**需自行创建 `~/.pi/subagent.json` 的 `modelPolicy`** |
| `@ian-pascoe/pi-lsp` | `npm:@ian-pascoe/pi-lsp` | LSP 集成（诊断、跳转定义、悬停、引用）。**需在 `settings.json`/项目 `.pi/settings.json` 的 `lsp` 键下自配语言 server**，与 `toolSearch.alwaysEnabled` 的 `"lsp"` 对应 |
| `@juicesharp/rpiv-todo` | `npm:@juicesharp/rpiv-todo` | 模型可见 todo 列表 + `/todos` + 实时面板 |
| `pi-web-access` | `npm:pi-web-access` | 网页搜索、URL 抓取、GitHub 克隆、PDF/YouTube 理解 |
| `@injaneity/pi-computer-use` | `npm:@injaneity/pi-computer-use` | 观察并控制 macOS/Windows/Linux 桌面应用，**需运行时授予平台权限** |
| `pi-rewind` | `npm:pi-rewind` | 每工具快照 + `/rewind` 回滚 + Esc+Esc，防误操作重跑浪费上下文 |
| `pi-simplify` | `npm:pi-simplify` | 审查最近改动代码的可读性/一致性/可维护性 |

> 2025-09-15 起「可选」清单已全部转入已装；未另行注明配置项的扩展装上即用，注意与 `pi-tool-search` 的工具加载不冲突。

## 安装与配置

```bash
# 全部已装项 = 阶段 A（缓存/节省）+ 阶段 B（编程增强）
pi install npm:pi-tool-search npm:pi-mcp-adapter npm:pi-observational-memory \
  npm:pi-cache-graph npm:pi-plugin-signal-grep
pi install npm:pi-readseek npm:pi-code-review npm:@plannotator/pi-extension \
  npm:@ff-labs/pi-fff npm:@khanhicetea/pi-better-tool npm:pi-background-tasks npm:pi-tps
# 2025-09-15（同日三次）：缓存层追加 + 原可选全部转正
pi install npm:pi-cache-guardian npm:pi-cachepoint npm:pi-hermes-memory
pi install npm:@xzzpig/pi-goal-x npm:@cr1ms0n/pi-subagent npm:@ian-pascoe/pi-lsp \
  npm:@juicesharp/rpiv-todo npm:pi-web-access npm:@injaneity/pi-computer-use \
  npm:pi-rewind npm:pi-simplify
# 本地 ts 扩展：手动放入 ~/.pi/agent/extensions/（本仓库 .backup-20250915/extensions-ts/ 有副本）
```

> 注：`pi install` 一次只接受单个 source，上面按阶段分组是逻辑示意，实际逐条执行。

`pi-tool-search` 配置（`~/.pi/agent/settings.json`，当前生效）：

```json
{
  "toolSearch": {
    "alwaysEnabled": ["grep"],
    "showToolSearchFooterStatus": true
  }
}
```

`alwaysEnabled` 预解锁除核心工具外的工具名（未知名称静默忽略），每次 `session_start` 读取。

## 安装后操作

1. **重启 Pi** 使扩展生效。
2. 新会话里用 `tool_search` 按需解锁新扩展的工具（如 `readSeek_*`、`signal_grep`、`mcp`、`bg_*`、`plannotator_*`）。
3. `/cache graph` 观察各扩展对缓存命中率的影响；若某扩展导致持续 cache miss，从清单中剔除。
4. `/cache-guardian` 查看每轮缓存统计，需要守护警告时设 `PI_CACHE_GUARD=1`；`/cachepoint-status` 查看自动 checkpoint 状态（依赖 provider 缓存策略，OpenAI 直连建议 `PI_CACHE_RETENTION=long`）。
5. 需自配置：`@cr1ms0n/pi-subagent` → `~/.pi/subagent.json` 的 `modelPolicy`；`@ian-pascoe/pi-lsp` → `settings.json` 的 `lsp` 键配语言 server；`@injaneity/pi-computer-use` → 首次运行时授予平台权限。

## 变更记录

- 2025-09-15：全部卸载（原 12 npm 包 + 5 个 ts 扩展），备份至 `.backup-20250915/`；按「缓存/节省 → 编程增强」重装 11 npm 包 + 5 个本地 ts。移除：`pi-tps`（转可选）、`pi-goal-x`、`rpiv-todo`、`pi-web-access`、`pi-computer-use`、`pi-hermes-memory`（其扩展曾启用，数据残留未清）、`pi-simplify`、`pi-rewind`。
- 2025-09-15（同日二次）：**安装 `pi-tps`**（含 `fix-tps-theme.ps1` 主题配置），从可选转为已装；移除可选清单中的 `@qualisero/pi-agent-scip`；同步远端 readme 中 `@cr1ms0n/pi-subagent`、`@ian-pascoe/pi-lsp` 等内容进可选清单。
- 2025-09-15（同日三次）：**安装 `pi-cache-guardian`、`pi-cachepoint`**（缓存层：golden system prompt 冻结 + 缓存到期前 shadow-summary 自动 checkpoint），可选清单 9 项**全部转正安装**（`pi-hermes-memory` 归入缓存层；`goal-x`/`subagent`/`lsp`/`rpiv-todo`/`web-access`/`computer-use`/`rewind`/`simplify` 归入功能增强），**删除「可选」小节**；readme 同步更新安装命令与配置清单。