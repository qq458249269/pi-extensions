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
| `filter-output.ts` | 本地 `~/.pi/agent/extensions/` | 工具结果送往模型前过滤噪音代码与测试冗余、脱敏 API 密钥等敏感信息，省 token |

### B. 编程增强（其次）

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
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget。需配主题：运行 `fix-tps-theme.ps1` 或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |

## 可选（未安装，按需再装）

| 扩展 | 说明 |
|---|---|
| `pi-hermes-memory` | 持久记忆 + SQLite FTS5 会话搜索 + 秘密扫描。注意：`~/.pi/agent/pi-hermes-memory/` 仍有旧数据残留，装前可清理 |
| `@xzzpig/pi-goal-x` | 长期目标模式（`/goal-set`、任务列表、autoContinue、状态覆盖层）；社区分支中维护较活跃 |
| `@juicesharp/rpiv-todo` | 模型可见 todo 列表 + `/todos` + 实时面板 |
| `pi-web-access` | 网页搜索、URL 抓取、GitHub 克隆、PDF/YouTube 理解 |
| `@injaneity/pi-computer-use` | 观察并控制 macOS/Windows/Linux 桌面应用，需平台权限授予 |
| `pi-rewind` | 每工具快照 + `/rewind` 回滚 + Esc+Esc，防误操作重跑浪费上下文 |
| `pi-simplify` | 审查最近改动代码的可读性/一致性/可维护性 |

## 安装与配置

```bash
# 全部已装项 = 阶段 A（缓存/节省）+ 阶段 B（编程增强）
pi install npm:pi-tool-search npm:pi-mcp-adapter npm:pi-observational-memory \
  npm:pi-cache-graph npm:pi-plugin-signal-grep
pi install npm:pi-readseek npm:pi-code-review npm:@plannotator/pi-extension \
  npm:@ff-labs/pi-fff npm:@khanhicetea/pi-better-tool npm:pi-background-tasks npm:pi-tps
# 本地 ts 扩展：手动放入 ~/.pi/agent/extensions/（本仓库 .backup-20250915/extensions-ts/ 有副本）
```

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
4. 可选扩展安装前确认与 `pi-tool-search` 的工具加载互不冲突。

## 变更记录

- 2025-09-15：全部卸载（原 12 npm 包 + 5 个 ts 扩展），备份至 `.backup-20250915/`；按「缓存/节省 → 编程增强」重装 11 npm 包 + 5 个本地 ts。移除：`pi-tps`（转可选）、`pi-goal-x`、`rpiv-todo`、`pi-web-access`、`pi-computer-use`、`pi-hermes-memory`（其扩展曾启用，数据残留未清）、`pi-simplify`、`pi-rewind`。
- 2025-09-15（同日二次）：**安装 `pi-tps`**（含 `fix-tps-theme.ps1` 主题配置），从可选转为已装；移除可选清单中的 `@qualisero/pi-agent-scip`。