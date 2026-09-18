# Pi Extensions 安装清单

本手册汇总一套推荐的 Pi 扩展安装方案，按「缓存与节省优先，编程增强次之」的原则组织。扩展统一安装在 Pi 配置根 `~/.pi/agent`（Windows 下为 `%USERPROFILE%\.pi\agent`），以下路径均以此计。

> 不装 `lazy` 类扩展：`pi-tool-search` 已承担按需工具加载，与 `lazy` 同时使用会在工具生命周期管理上冲突。
>
> 本轮（2026-09-17）新增 4 个扩展，全部**零工具注入**（无 `registerTool`/`setActiveTools`），只挂事件钩子，不增加首请求 token、不与 `pi-tool-search` 懒加载冲突。

## 推荐清单（当前 10 个）

### A. 核心层（先装）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-tool-search` | `npm:pi-tool-search` | **核心**。把非核心工具全部隐藏到 `tool_search` 后面，按需解锁，避免注入上百个工具 schema，直接改善前缀缓存命中与 token 消耗。核心工具 `read/write/edit/bash/grep/find` 默认启用。**关键：`alwaysEnabled` 必须只列核心工具，否则首次请求会注入所有工具 schema，token 飙升到 2w+** |
| `pi-cache-guardian` | `npm:pi-cache-guardian` | **缓存守护（防 autocompact 后命中率归零）**。首轮完整链处理后将 system prompt 捕获为 **golden 副本**，之后每轮无条件恢复——字节级一致保证前缀缓存不因 autocompact 重建 system prompt 而整体失效；叠加 prompt reorder（稳定内容前置）、skill 压缩（>4 个 skill 时 4 行 XML 压缩为单行索引）、`<session-overview>` 变化字段剥离（RECENT COMMITS/目录状态/行数），并自动设 `PI_CACHE_RETENTION=long`。自动兼容检测：OpenAI 400 时剥离 `prompt_cache_retention`、Anthropic 400 时降级 `cache_control` TTL、OpenAI 兼容端点注入 `prompt_cache_key`。**不注入任何工具**（无 `setActiveTools`），与 `pi-tool-search` 懒加载不冲突。命令：`/cache-guardimizer`（v1.0.7 实际命令名；npm README 里的 `/cache-guardian` 为旧名）查看每轮 `cacheRead`/`cacheWrite` 统计。可选：`PI_CACHE_GUARD=1` 时会话结束命中率 < `PI_CACHE_GUARD_THRESHOLD`（默认 90）报警 |
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget + **运行状态指示**（回合运行中 TUI 底部状态栏实时 spinner、实时 TPS、Waterfall 瀑布图，回合结束弹整回合统计摘要）。配置：`/pi-tps`（`showTraces`/`showStats`/`showTtft`/颜色）。**必须配主题**：装好后 `colorPreset` 默认 `mono`，运行 `fix-tps-theme.ps1`（幂等：同时把 `pi-tps.json` 设为 `theme`、`settings.json` 的 `theme` 设为 `light/dark` 跟随系统）或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |
| `pi-compaction-control` | `npm:pi-compaction-control` | **压缩控制（v0.4.5）**。粒度到模型：`contextCap` 给每个模型设 `contextWindow` 硬上限，让 autocompact 在 `cap − reserveTokens` 处提前触发（需早于模型原生窗口才有效，本机模型 100k）；`compactionModel` 可选更便宜/更快的模型跑压缩摘要。全从 settings.json 读，**零 token 开销**（纯内存改 `model.contextWindow`，不额外发请求）。与 `pi-cache-guardian` 协同：autocompact 后是新 session，guardian 自动重新捕获 golden，无冲突。**无隐式默认值**：不配置 `contextCap` 就不生效。不含工具开关，与 `pi-tool-search` 不冲突 |

### B. 功能增强（其次）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `alps-pi` | `npm:alps-pi` | TUI 美化扩展（要求 Pi 0.84.4+）：消息边框线框、输入框美化、内置 Animations 与 `alps` 主题（Synthwave '84 配色）。`/alps-pi` 打开设置界面、`/alps-pi preview` 预览样式；设置写入 settings.json 的 `alps-pi` namespace，`/reload` 或新会话后恢复。**只持久化到 Pi 原生 settings.json，不占工具注入、无 `before_agent_start`，对 token/首请求无影响** |
| `pi-web-access` | `npm:pi-web-access` | 网页搜索、URL 抓取、GitHub 克隆、PDF/YouTube 理解 |
| `@injaneity/pi-computer-use` | `npm:@injaneity/pi-computer-use` | 观察并控制 macOS/Windows/Linux 桌面应用，**需运行时授予平台权限** |

### C. 对话健壮性（防断/防丢/防跑飞，新加）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-auto-resume` | `npm:pi-auto-resume` | **自动续跑**（v1.0.0）：token 上限截断（`stopReason: length`）、不完整工具调用（截断在 JSON 中间）、HTTP 429 限流、套餐/额度耗尽（Claude Pro/OpenCode quota 等）自动恢复——限流与额度按指数退避等待重试，截断发 continuePrompt 续写。配置：settings.json 的 `autoResume`（`maxResumes` 默认 5、`delayMs` 1000、`continuePrompt`、`rateLimit.maxRetries` 3 / `baseDelayMs` 60000 / `maxDelayMs` 3600000）。**装上即用** |
| `pi-response-guard` | `npm:pi-response-guard` | **响应守卫**（v0.1.0）：空响应、报错响应、静默中断（thinking-only、工具后无声）自动重发 `retryMessage`（默认 `"continue"`）续接，连续自动重试上限 10 次；错误模式表覆盖 429/5xx/网络层（ECONNRESET、socket hang up、premature close、timeout 等）。**配置不在 settings.json**：默认配置在包内 `config.json`，运行 `/response-guard:install-config` 拷贝到 `~/.pi/agent/extensions/pi-response-guard/config.json` 后按需修改。与 `pi-auto-resume` 互补（guard 管响应本身，resume 管 provider 层） |
| `@vanillagreen/pi-output-policy` | `npm:@vanillagreen/pi-output-policy` | **输出策略**（v2.0.1）：防大输出跑飞——模型长输出拦截打断 + 工具结果最小化（有界截断 + 完整输出落盘到文件供按需读取，长自治运行不撑爆 provider 请求缓冲）。`policyMode`：`balanced`（默认）/`compact`/`compat`；截断：`truncateReadOutputs`/`truncateMutationOutputs`/`spillThresholdKb`/`inlineTailKb`/`inlineTailLines`/`preserveFullOutput`；TUI 显示：`maxTextBlockKb`/`maxLineCount`/`maxLineWidth`/`sanitizeDetails`。配置：`/extensions:settings` 的 **Output Policy** 标签，或 settings.json 的 `kendex.extensionManager.config["@vanillagreen/pi-output-policy"]`。**注意 npm bare 名 `pi-output-policy` 不存在，真实包名带 scope** |

> 未另行注明配置项的扩展装上即用（`tool_search` 按需解锁），注意与 `pi-tool-search` 的工具加载不冲突。主题由 `pi-tps` 与 `alps-pi` 共同接管：`pi-tps` 看运行状态、`alps-pi` 管 UI 美化，避免同时用多个 `lazy`/强制激活插件即可。
>
> **C 类 3 个扩展的关系**：`pi-auto-resume`（provider 层：截断/限流/额度）、`pi-response-guard`（响应层：空/错/中断响应）、`pi-output-policy`（输出层：大输出/工具结果体积）三者互补不重叠，均只监听事件、零工具注入。

## 安装与配置

> **警：逐条串行安装，勿并行。** 多进程 `pi install` 会竞写 `~/.pi/agent/settings.json` 丢注册（实测 17 项仅剩 5 项留存），且并发操作同一 `~/.pi/agent/npm` 目录会触发 `ENOENT: Cannot cd into .../node_modules/<pkg>`（实测 `typebox`）。
>
> `pi install` 一次只接受单个 source，故直接串行跑循环：

```bash
for p in pi-tool-search pi-cache-guardian pi-tps alps-pi \
         pi-web-access @injaneity/pi-computer-use \
         pi-auto-resume pi-response-guard pi-compaction-control \
         @vanillagreen/pi-output-policy; do
  pi install "npm:$p" || echo "[失败] $p"
done
```

装完自查（`pi extensions list`，不并行）：应见 **10 个 npm 扩展**——`pi-web-access`、`pi-tool-search`、`pi-tps`、`@injaneity/pi-computer-use`、`alps-pi`、`pi-cache-guardian`、`pi-auto-resume`、`pi-response-guard`、`pi-compaction-control`、`@vanillagreen/pi-output-policy`。若少于 10（并行竞写伤痕），重跑上述循环补漏。

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

> **为什么必须只列 6 个核心工具？（`alwaysEnabled`/`defaultTools` 只留核心 6 个，与总扩展数无关）**
>
> `alwaysEnabled` 中的工具会在每次 `session_start` 时注入完整 schema。若多列一个，就会多注入该工具的全部描述、参数定义，导致首次请求 token 飙升。
>
> 实测对比（2026-09-17，`probe.ts` 复测后）：
>
> | 配置 | system prompt 文字 | 首次激活工具 | 说明 |
> |---|---|---|---|
> | 无扩展（`-e probe.ts` 前置开关之外的 `-ne`） | 2,502 chars（≈0.7-1k token） | 6 | 基线（6 核心工具） |
> | 5 扩展全量（`tool-search`+`tps`+`alps-pi`+`web-access`+`computer-use`） | 2,654 chars（≈0.8-1k token） | 7 | 增量仅 `tool_search` 描述 + 运行时状态 widget；`alps-pi` 纯 TUI 零工具注入 |

> 该表为首轮 `session_start` 实测基线（安装 `pi-cache-guardian` 前）。`pi-cache-guardian` 不注入工具，`activeTools` 数不变；system prompt 内容受其 reorder/压缩影响（长度基本持平，压缩仅在 skill>4 时生效），属 `before_agent_start` 阶段内部改写，不影响首请求注入量与基线对比结论。
>
> **2026-09-17 追加 4 个扩展后基线结论不变**：`pi-auto-resume`/`pi-response-guard`/`pi-compaction-control`/`@vanillagreen/pi-output-policy` 均经源码核查**无任何 `registerTool`/`setActiveTools` 调用**，纯事件钩子（`tool_result`/`message_end`/`session_before_compact` 等），不改变 `activeTools` 数（仍 7），不增加首请求注入量。
>
> `pi-tps` 与 `alps-pi` 是纯 UI/运行时监控扩展，不注册任何 agent 工具，因此**不增加首次请求 token**（相对基线仅 +~150 chars 的 `pi-tps` 策略文字，`alps-pi` 为 0）。其余扩展工具在需要用时 `tool_search` 解锁即可，不占首次请求 token。

## 安装后操作

### 一键配置脚本（幂等，可重复执行）

| 脚本 | 用途 |
|---|---|
| `fix-tps-theme.ps1` | `pi-tps` 颜色跟随系统主题（`theme` -> `light/dark`，`colorPreset` -> `theme`） |
| `setup-robustness.ps1` | **对话健壮性一键配置**：① `pi-response-guard` 免交互生成 `~/.pi/agent/extensions/pi-response-guard/config.json`（等价于 `/response-guard:install-config`）；② `pi-compaction-control` 自动写入 `contextCap`（cap 100000，对应本机模型原生窗口，autocompact 在 100k − reserveTokens 处触发） |

```bash
powershell -ExecutionPolicy Bypass -File setup-robustness.ps1
```

脚本为 UTF-8 BOM 保存，PowerShell 5.1 / 7 均可正确解析中文；已存在配置时自动 `[skip]`，不会覆盖你改过的值。

1. **重启 Pi** 使扩展生效。
2. 新会话里用 `tool_search` 按需解锁新扩展的工具（如 `web_search`、`computer_use`）。
3. `pi-tps`：运行 `fix-tps-theme.ps1` 让颜色跟随系统主题。`alps-pi`：`/alps-pi` 打开设置、`/alps-pi preview` 预览（设好后 `settings.json` 的 `alps-pi` namespace 会持久化，`/reload` 后仍生效）。`@injaneity/pi-computer-use`：首次运行时授予平台权限。
4. `pi-cache-guardian`：装上即用（golden freeze + `PI_CACHE_RETENTION=long` 自动生效），`/cache-guardimizer` 查看每轮缓存统计；可选开启会话结束命中率报警：`PI_CACHE_GUARD=1`（阈值 `PI_CACHE_GUARD_THRESHOLD`，默认 90）。autocompact 后是新 session，会重新捕获 golden，无需干预。
5. **`pi-auto-resume`**：装上即用（截断自动续写、429/额度指数退避重试）。需要收紧时配 settings.json `autoResume`（见 C 表）。
6. **`pi-response-guard`**：**跑一次 `setup-robustness.ps1` 即完成**（自动把包内默认 `config.json` 复制到 `~/.pi/agent/extensions/pi-response-guard/config.json`，等价 `/response-guard:install-config`）。之后按需改 `retryMessage`/`maxConsecutiveAutoRetries`/`errorPatterns`；不改则用默认值（同样生效）。
7. **`pi-compaction-control`**：**必须显式配置才生效**（无隐式默认）——`setup-robustness.ps1` 已自动写入 `contextCap`（cap 100000 = 本机模型原生窗口，即 `{ "cap": 100000, "matchPatterns": ["*"] }`），无启动告警；想改：settings.json 的 `contextCap` 调 `cap`/`matchPatterns` 或 `models`（按 model id 单独设）。**注意：`cap` 超过模型原生窗口时插件会告警并自动钳制到原生值**（如 `configured cap 256,000 > native 100,000 — effective cap clamped down to 100,000`），属配置问题而非插件问题。可选 `compactionModel`（如 `{ "model": "google/gemini-2.5-flash", "thinkingLevel": "low" }`）让更便宜的模型跑压缩摘要；`reserveTokens`/`keepRecentTokens` 仍由 Pi 原生 `compaction` 配置控制，扩展改不了。
8. **`@vanillagreen/pi-output-policy`**：默认 `balanced` 模式装上即生效（读工具输出截断、写工具输出截断、溢出落盘）。想更激进/保守：`/extensions:settings` 的 Output Policy 页改 `policyMode`（compact 更省 / compat 尽量保真）与截断阈值，写回 settings.json 的 `kendex.extensionManager.config` namespace，`/reload` 后生效。

## 维护记录
- **2026-09-18**（修正）：**修复 compaction-control 启动告警**（`configured cap 256,000 > native 100,000`）。根因：`setup-robustness.ps1` 按 1M 原生窗口假设写入 cap 256000，但本机模型（`models.json` 的 `contextWindow: 100000`）原生仅 100k，插件自动钳制并告警——插件**能正常自动读取本机配置**，问题在配置值。处理：settings.json 清除被误注入到 15 个嵌套位置的 `contextCap`（markdown/images/compaction/terminal/whimsical/toolSearch/alps-pi 内），只保留顶层 `contextCap` 并改为 `cap: 100000`；`setup-robustness.ps1` 同步改为 100000，重跑不再引入 256k。
- **2026-09-17**（追加）：**新增一键配置脚本 `setup-robustness.ps1`**（UTF-8 BOM，幂等）：① response-guard 自动复制包内 `config.json` 到 `~/.pi/agent/extensions/pi-response-guard/config.json`（免 `/response-guard:install-config` 交互）；② compaction-control 自动写入 settings.json `contextCap`（cap 256000 / matchPatterns `["*"]` / notify true）。本机已执行完成：response-guard config 已生成、settings.json 已含 `contextCap`（`packages` 仍 10 项，JSON 校验通过），重跑显示 `[skip]` 幂等。
- **2026-09-17**（追加）：**安装 4 个对话健壮性/上下文控制扩展**，清单 6→10 个。串行 `pi install`：`pi-auto-resume`（npm 1.0.0，token 截断/429/额度耗尽自动续跑）、`pi-response-guard`（npm 0.1.0，空/错/中断响应自动恢复，配置走包内 `config.json`）、`pi-compaction-control`（npm 0.4.5，分模型 contextWindow 硬上限 + 可选压缩模型，settings.json 的 `contextCap`/`compactionModel`）、`@vanillagreen/pi-output-policy`（npm 2.0.1，大输出拦截 + 工具结果有界截断/完整落盘，`policyMode` balanced/compact/compat）。**坑：`pi-output-policy` bare 名 404，真实包名 `@vanillagreen/pi-output-policy`。**源码核查 4 个均零工具注入（无 `registerTool`/`setActiveTools`），不增加首请求 token 基线、不与 `pi-tool-search` 懒加载冲突；`pi-compaction-control` 与 `pi-cache-guardian` 协同（提前压缩→新会话→golden 重捕获）。settings.json `packages` 现为 10 项。
- **2026-09-17**（追加）：**安装 `pi-cache-guardian`（npm v1.0.7）**，清单 5→6 个。串行 `pi install npm:pi-cache-guardian`，settings.json `packages` 增 `npm:pi-cache-guardian`。防护目标：autocompact 重建 system prompt 后前缀缓存命中率归零——该扩展首轮捕获 golden 副本、每轮强制恢复，保证字节一致；并剥离 `<session-overview>` 每轮变化字段、压缩 >4 skills 的 XML 块。纯 `before_agent_start`/`before_provider_request`/`after_provider_response` 改写，**无 `setActiveTools`**，与 `pi-tool-search` 懒加载无冲突；自动设 `PI_CACHE_RETENTION=long`。注意命令名：实际注册 `/cache-guardimizer`（README 的 `/cache-guardian` 为旧名）。未复测 `probe.ts`（该扩展不注入工具，只改 system prompt 内容，基线对比结论不变）。
- **2026-09-17**（本轮精简锁定 5 个）：卸载 9 个 npm 扩展（`pi-mcp-adapter`、`@plannotator/pi-extension`、`@khanhicetea/pi-better-tool`、`@lucascardozo/pi-edit-guard`、`@ian-pascoe/pi-lsp`、`@cr1ms0n/pi-subagent`、`@juicesharp/rpiv-todo`、`pi-web-access` 未动 / 待查）——按「只保留 `pi-tool-search`/`pi-tps`/`pi-web-access`/`@injaneity/pi-computer-use`，其余全移除」执行（实际卸载：`pi-mcp-adapter`、`pi-code-review`、`@plannotator/pi-extension`、`@khanhicetea/pi-better-tool`、`@lucascardozo/pi-edit-guard`、`@ian-pascoe/pi-lsp`、`@cr1ms0n/pi-subagent`、`@juicesharp/rpiv-todo`、`pi-rewind`、`pi-simplify`），并移除 3 个本地 lint hook（`react-lint-hook.ts`/`python-lint-hook.ts`/`rust-lint-hook.ts`）；**新增 `alps-pi`**（TUI 美化）。串行 `pi remove` 执行（settings.json 保留 5 包：`pi-tool-search`、`pi-tps`、`alps-pi`、`pi-web-access`、`@injaneity/pi-computer-use`）。复测 `probe.ts`：5 扩展 2,654 chars / 7 工具（基线无扩展 2,502/6）。
- **2026-09-17**（Token 优化，上轮）：卸载 `pi-readseek`、`pi-background-tasks`、`@xzzpig/pi-goal-x`。三者均在 `before_agent_start`/`session_start` 无条件 `setActiveTools()` 塞全量工具且注入策略文字，绕过 `pi-tool-search` 懒加载。串行 `pi remove` 执行。留仓 `probe.ts` 复测。
- **2026-09-17**：`@cr1ms0n/pi-subagent` 的 `modelPolicy` 格式：`~/.pi/subagent.json` 填 `{ "modelPolicy": { "default": { "model": "<provider>/<model-id>" } } }`。**（本扩展已卸载，配置失效）**
- **2026-09-16**：修正 `pi-tool-search` 配置说明——`alwaysEnabled` 只留 6 核心工具避免首请求注入全部 schema。补充实测 token 对比表。
- **2025-09-16~17**：曾安装并随后精简 `pi-cachepoint` 系列、`pi-hermes-memory`、`pi-edit-guard`/`pi-better-tool` 等 edit 增强；相关说明已随本轮卸载清理。

- 本清单即最新推荐集（当前 10 个）：扩展被卸载或替换时，同步更新上方表格与安装命令，并在此追加一行说明。
