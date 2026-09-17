# Pi Extensions 安装清单

本手册汇总一套推荐的 Pi 扩展安装方案，按「缓存与节省优先，编程增强次之」的原则组织。扩展统一安装在 Pi 配置根 `~/.pi/agent`（Windows 下为 `%USERPROFILE%\.pi\agent`），以下路径均以此计。

> 不装 `lazy` 类扩展：`pi-tool-search` 已承担按需工具加载，与 `lazy` 同时使用会在工具生命周期管理上冲突。

## 推荐清单（当前 5 个）

### A. 核心层（先装）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-tool-search` | `npm:pi-tool-search` | **核心**。把非核心工具全部隐藏到 `tool_search` 后面，按需解锁，避免注入上百个工具 schema，直接改善前缀缓存命中与 token 消耗。核心工具 `read/write/edit/bash/grep/find` 默认启用。**关键：`alwaysEnabled` 必须只列核心工具，否则首次请求会注入所有工具 schema，token 飙升到 2w+** |
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget + **运行状态指示**（回合运行中 TUI 底部状态栏实时 spinner、实时 TPS、Waterfall 瀑布图，回合结束弹整回合统计摘要）。配置：`/pi-tps`（`showTraces`/`showStats`/`showTtft`/颜色）。**必须配主题**：装好后 `colorPreset` 默认 `mono`，运行 `fix-tps-theme.ps1`（幂等：同时把 `pi-tps.json` 设为 `theme`、`settings.json` 的 `theme` 设为 `light/dark` 跟随系统）或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |

### B. 功能增强（其次）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `alps-pi` | `npm:alps-pi` | TUI 美化扩展（要求 Pi 0.84.4+）：消息边框线框、输入框美化、内置 Animations 与 `alps` 主题（Synthwave '84 配色）。`/alps-pi` 打开设置界面、`/alps-pi preview` 预览样式；设置写入 settings.json 的 `alps-pi` namespace，`/reload` 或新会话后恢复。**只持久化到 Pi 原生 settings.json，不占工具注入、无 `before_agent_start`，对 token/首请求无影响** |
| `pi-web-access` | `npm:pi-web-access` | 网页搜索、URL 抓取、GitHub 克隆、PDF/YouTube 理解 |
| `@injaneity/pi-computer-use` | `npm:@injaneity/pi-computer-use` | 观察并控制 macOS/Windows/Linux 桌面应用，**需运行时授予平台权限** |

> 未另行注明配置项的扩展装上即用（`tool_search` 按需解锁），注意与 `pi-tool-search` 的工具加载不冲突。主题由 `pi-tps` 与 `alps-pi` 共同接管：`pi-tps` 看运行状态、`alps-pi` 管 UI 美化，避免同时用多个 `lazy`/强制激活插件即可。

## 安装与配置

> **警：逐条串行安装，勿并行。** 多进程 `pi install` 会竞写 `~/.pi/agent/settings.json` 丢注册（实测 17 项仅剩 5 项留存），且并发操作同一 `~/.pi/agent/npm` 目录会触发 `ENOENT: Cannot cd into .../node_modules/<pkg>`（实测 `typebox`）。
>
> `pi install` 一次只接受单个 source，故直接串行跑循环：

```bash
for p in pi-tool-search pi-tps alps-pi \
         pi-web-access @injaneity/pi-computer-use; do
  pi install "npm:$p" || echo "[失败] $p"
done
```

装完自查：`pi extensions list` 应见 **5 个 npm 扩展**；若少于 5（并行竞写伤痕），重跑上述循环补漏。

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
> `alwaysEnabled` 中的工具会在每次 `session_start` 时注入完整 schema。若多列一个，就会多注入该工具的全部描述、参数定义，导致首次请求 token 飙升。
>
> 实测对比（2026-09-17，`probe.ts` 复测后）：
>
> | 配置 | system prompt 文字 | 首次激活工具 | 说明 |
> |---|---|---|---|
> | 无扩展（`-e probe.ts` 前置开关之外的 `-ne`） | 2,502 chars（≈0.7-1k token） | 6 | 基线（6 核心工具） |
> | 5 扩展全量（`tool-search`+`tps`+`alps-pi`+`web-access`+`computer-use`） | 2,654 chars（≈0.8-1k token） | 7 | 增量仅 `tool_search` 描述 + 运行时状态 widget；`alps-pi` 纯 TUI 零工具注入 |
>
> `pi-tps` 与 `alps-pi` 是纯 UI/运行时监控扩展，不注册任何 agent 工具，因此**不增加首次请求 token**（相对基线仅 +~150 chars 的 `pi-tps` 策略文字，`alps-pi` 为 0）。其余扩展工具在需要用时 `tool_search` 解锁即可，不占首次请求 token。

## 安装后操作

1. **重启 Pi** 使扩展生效。
2. 新会话里用 `tool_search` 按需解锁新扩展的工具（如 `web_search`、`computer_use`）。
3. `pi-tps`：运行 `fix-tps-theme.ps1` 让颜色跟随系统主题。`alps-pi`：`/alps-pi` 打开设置、`/alps-pi preview` 预览（设好后 `settings.json` 的 `alps-pi` namespace 会持久化，`/reload` 后仍生效）。`@injaneity/pi-computer-use`：首次运行时授予平台权限。

## 维护记录
- **2026-09-17**（本轮精简锁定 5 个）：卸载 9 个 npm 扩展（`pi-mcp-adapter`、`@plannotator/pi-extension`、`@khanhicetea/pi-better-tool`、`@lucascardozo/pi-edit-guard`、`@ian-pascoe/pi-lsp`、`@cr1ms0n/pi-subagent`、`@juicesharp/rpiv-todo`、`pi-web-access` 未动 / 待查）——按「只保留 `pi-tool-search`/`pi-tps`/`pi-web-access`/`@injaneity/pi-computer-use`，其余全移除」执行（实际卸载：`pi-mcp-adapter`、`pi-code-review`、`@plannotator/pi-extension`、`@khanhicetea/pi-better-tool`、`@lucascardozo/pi-edit-guard`、`@ian-pascoe/pi-lsp`、`@cr1ms0n/pi-subagent`、`@juicesharp/rpiv-todo`、`pi-rewind`、`pi-simplify`），并移除 3 个本地 lint hook（`react-lint-hook.ts`/`python-lint-hook.ts`/`rust-lint-hook.ts`）；**新增 `alps-pi`**（TUI 美化）。串行 `pi remove` 执行（settings.json 保留 5 包：`pi-tool-search`、`pi-tps`、`alps-pi`、`pi-web-access`、`@injaneity/pi-computer-use`）。复测 `probe.ts`：5 扩展 2,654 chars / 7 工具（基线无扩展 2,502/6）。
- **2026-09-17**（Token 优化，上轮）：卸载 `pi-readseek`、`pi-background-tasks`、`@xzzpig/pi-goal-x`。三者均在 `before_agent_start`/`session_start` 无条件 `setActiveTools()` 塞全量工具且注入策略文字，绕过 `pi-tool-search` 懒加载。串行 `pi remove` 执行。留仓 `probe.ts` 复测。
- **2026-09-17**：`@cr1ms0n/pi-subagent` 的 `modelPolicy` 格式：`~/.pi/subagent.json` 填 `{ "modelPolicy": { "default": { "model": "<provider>/<model-id>" } } }`。**（本扩展已卸载，配置失效）**
- **2026-09-16**：修正 `pi-tool-search` 配置说明——`alwaysEnabled` 只留 6 核心工具避免首请求注入全部 schema。补充实测 token 对比表。
- **2025-09-16~17**：曾安装并随后精简 `pi-cachepoint` 系列、`pi-hermes-memory`、`pi-edit-guard`/`pi-better-tool` 等 edit 增强；相关说明已随本轮卸载清理。

- 本清单即最新推荐集：扩展被卸载或替换时，同步更新上方表格与安装命令，并在此追加一行说明。
