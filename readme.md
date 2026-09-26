# Pi Extensions 安装清单

本手册汇总一套推荐的 Pi 扩展安装方案，按「缓存与节省优先，编程增强次之」的原则组织。扩展统一安装在 Pi 配置根 `~/.pi/agent`（Windows 下为 `%USERPROFILE%\.pi\agent`），以下路径均以此计。

> 按需工具加载由 **pi-lazy-tools** 承担（前身 `@wolido/pi-tool-search` 已下架；2026-09-22 由 npm `@wolido/pi-lazy-tools` 承接，**2026-09-23 起改装 fork `git:github.com/qq458249269/pi-lazy-tools`，3 行 jiti 加载器补丁已并入仓库 `b2a7d75`**）：低频工具列入 lazy 名单后从 LLM 可见 active 集剔除，需要时 `load_tools` 纯文本注入用法、`call_tool` 代理执行，与其它扩展不冲突。
>
> 本轮（2026-09-17）新增 4 个扩展，全部**零工具注入**（无 `registerTool`/`setActiveTools`），只挂事件钩子，不增加首请求 token、不与 `@wolido/pi-lazy-tools` 懒加载冲突。
>
> 本轮（2026-09-21）再增 5 个扩展：`pi-undo-redo`（会话/文件撤销重做）、`pi-hermes-memory`（持久记忆 + 会话检索 + 密钥扫描）、`pi-subagents`（子智能体委托）、`pi-mcp-adapter`（MCP 适配）、`pi-agent-browser-native`（原生浏览器工具）。注册的 10 个工具一律列入 lazy 名单（见[工具归属](#工具归属)），不增首请求注入量。
>
> 本轮（2026-09-22）换装：`@wolido/pi-tool-search` 已从 npm 下架 → 由**同作者的 `@wolido/pi-lazy-tools@0.3.1` 承接**（配置 `lazy-tools.json`、常驻 `load_tools`/`call_tool`、两步确认门全部同款，新增 call_tool 的 JSON Schema 预校验 + factory 重放真实 execute）；**移除 `alps-pi`**（TUI 美化）→ **加入 `pi-one-ui@0.7.1`**（统一 TUI 包，功能覆盖 alps-pi 并扩展，见下方清单 B）。**移除 `pi-hermes-memory`**（持久记忆，不再使用，其 6 个工具从 lazy 名单与工具归属中同步剔除）。清单现 13 个。
>
> 本轮（2026-09-22 二轮，策略回调）：自带五个工具（`read`/`write`/`edit`/`bash`/`powershell`）恢复**默认常驻 active 集**（项目 `.pi/settings.json` 显式 `defaultTools`，Windows 下同含 bash/powershell 双 shell）；`edit` 从 lazy 名单移除（归核心五工具，同名覆盖内建行为保留）；`grep`/`find`（@tian.zuo/pi-find）等其余扩展工具**仍全量懒加载**。active 集回到 7（五工具 + `load_tools`/`call_tool`），写代码主链路零 `load_tools` 往返。

> 本轮（2026-09-22 三轮）：新增 **SoL-Pi**（`git:github.com/NVlabs/SoL-Pi`，NVIDIA 开源上下文/token 效率扩展，arXiv 2609.20519），清单 **13 → 14**（13 npm + 1 git）。四机制全 opt-in 默认关（`sol-pi.json` 配置，见[清单 A](#a-核心层先装)）：**Action Fusion** 同名覆盖内建 `edit`/`write` 追加 `then_run` 参数（同一次工具调用完成编辑 + 校验命令，省一轮往返）；**ObservationPack** 大文本结果转稳定句柄 + 分页回放（注册 `obs_recall`）；**Evidence-Preserving Reducer** 长诊断日志转紧凑收据（无工具）；**Online Context Compact** 完成的计划步骤成原生压缩候选点（注册 `update_plan`）。`obs_recall`/`update_plan` 补入 lazy 名单；`edit`/`write` 同名覆盖归核心常驻（与 pi-edit-guard 之于 `edit`、pi-one-ui 之于 `write` 同类）。**维护机已启用保守两机制**（actionFusion + observationPack，`~/.pi/agent/sol-pi.json`，见[安装后操作 10](#安装后操作)）。
>
> 本轮（2026-09-23）skill 去注入：`before_agent_start` 剥离 Pi 默认注入的 `<skills>` 段（全部 skill 的 name + description 常驻），改写为单行说明；改为**动态发现**：常驻 `skill_search` 工具按关键词/名返回 skill 的 name、description 与 SKILL.md 路径，promptSnippet 限「仅用户明确要求使用 skill 时调用，never proactively」。实测系统提示词 0 个 skill 名/description（装前 4 个全注入），`skill_search("恋爱")` 正确返回 `goutoujunshi` 元数据与路径。`/skill:name` 显式命令不受影响。**该功能曾为独立扩展 `pi-lazy-skills`，现已并入 `pi-lazy-tools` fork（commit `358e236`），`pi-lazy-skills` 已卸载，清单现 14 个**。
>
> 本轮（2026-09-23）lazy-tools 换源：`npm:@wolido/pi-lazy-tools` 移除 → **`pi install git:github.com/qq458249269/pi-lazy-tools`**（fork 含 jiti 补丁 `b2a7d75` + `dependencies: jiti`；git 包独立 module root，不能蹭根 node_modules，故依赖必须声明）。实测 `load_tools`→`call_tool` 全链 OK（replay `grep` → 43 matches，`isError":false`）。配置 `~/.pi/lazy-tools.json` 不变。
>
> 本轮（2026-09-23 四轮）：**卸载 SoL-Pi**（`pi uninstall git:github.com/NVlabs/SoL-Pi`），三轮新增记录作废：`edit`/`write` 同名覆盖（`then_run`）撤除、恢复内建原始行为，`obs_recall`/`update_plan` 注入撤除并从 lazy 名单剔除，`~/.pi/agent/sol-pi.json` 配置已删除。清单 **14 → 13**（12 npm + 1 git，`pi list` 实测核对）。
>
> 本轮（2026-09-23 五轮）：新增 **`@agenticup/pi-loop@0.1.4`**（`npm:@agenticup/pi-loop`，loop engineering 递归深潜扩展），清单 **13 → 14**（13 npm + 1 git，`pi list` 实测核对）。只注册 1 个工具 `loop`（5 阶段流水线：Decompose → DRIP 前置回检 → Solve 并发子智能体 → Critique MAKER 投票 → Iterate ADaPT 深分解 → Synthesize DRAGON 冲突检测）。⚠ 现行 pi-lazy-tools fork 为 **resident 例外制**（`~/.pi/lazy-tools.json` 只列常驻例外，其余默认全 lazy），`loop` 不在 `resident` 即自动 lazy，**无需改配置**；`loop` 归属见[工具归属](#工具归属)。
>
> 本轮（2026-09-24 六轮）：**卸载 `pi-subagents`**（`pi uninstall npm:pi-subagents`，不再使用子智能体委托），清单 **14 → 13**（12 npm + 1 git，`pi list` 实测核对）。`subagent`/`contact_supervisor` 从 lazy 名单剔除（resident 例外制下无需改配置，工具直接不存在）；安装循环、自查清单、工具归属表、安装后操作条目同步剔除；better-sqlite3 三包并称段改两包（见[安装与配置](#安装与配置)）。
>
> 本轮（2026-09-27）：新增 **`@zhushanwen/pi-smart-context@0.3.4`**（`npm:@zhushanwen/pi-smart-context`，智能上下文压缩：agent 自决 `compact_context` 工具 + 双模式摘要生成 + 3 档阈值提醒），清单 **13 → 14**（13 npm + 1 git，`pi list` 实测核对）。**同时试装并卸载 `billion-context-pi@0.1.80`**——在本机与 `pi-lazy-tools` 冲突，五个 ACP 工具全部加载失败却又无条件取消 pi 原生压缩，净损失，详见[压缩与缓存](#压缩与缓存)。smart-context 实测数据、配置与已知缺陷同见该节。
>
> 本轮（2026-09-28）：再装 4 个扩展，清单 **14 → 18**（`pi list` 实测 18 项：`packages` 18 条无丢失），全部**零 agent 工具注入**（无 `registerTool`/`setActiveTools`），与 `pi-lazy-tools` resident 例外制零冲突：`pi-prefix-stabilizer@0.1.0`（系统提示词前缀稳定 + 漂移检测）、`pi-compaction-cache@0.1.1`（摘要调用复用已缓存前缀，实测把压缩调用自身命中从 **1.6% 拉到 98.8%**）、`pi-warm-cache@0.4.0`（空闲期保 TTL，**本机路由未注册故不生效**）、`pi-footer-template@0.5.0`（footer 模板，默认含 `CH{latestCacheHitRate}%`）。另修 `pi-agent-browser-native@0.7.1` 在 **pi 0.85.1** 下的加载期报错 `ctx.sessionManager.buildSessionProjection is not a function`（该 API 属 0.86+），打双路回退补丁 + 幂等脚本 `fix-browser-native-compat.mjs`，补丁后全量扩展 `extension_error` 实测 **1 → 0**。四包与压缩实测全表见[压缩与缓存](#压缩与缓存)，安装顺序有硬约束（compaction-cache 须在 smart-context **之后**、prefix-stabilizer 须在 compaction-cache **之前**）。

## 推荐清单（18 个，始终最新）

### A. 核心层（先装）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-lazy-tools`（`@wolido/pi-lazy-tools` 的 fork） | `git:github.com/qq458249269/pi-lazy-tools` | **核心**。**2026-09-23 起弃 npm 源改装本 fork**（jiti 加载器补丁随仓库版本化，`pi install` 更新不再丢修复，声明 `dependencies.jiti` 供独立 module root 解析）。低频工具懒加载（**2026-09-22 起替代已下架的 `@wolido/pi-tool-search`，配置/工具名/两步确认门完全同款**）：会话启动把 `lazy-tools.json` 名单工具从 LLM 可见 active 集剔除，需要时 `load_tools` 以纯文本注入描述/参数 schema（两步确认门：先挑战文本 `confirm:false` 零副作用、用户主动要求后 `confirm:true` 激活）、`call_tool` 代理执行——相对 tool-search 加强：JSON Schema 预校验（type/required/enum/pattern/properties 等子集，不合法不触碰目标 execute）+ factory 重放捕获真实 `execute`（按 `sourcePath#name` memoize，每会话只重放一次）。**不触碰 `tools` 字段**；系统提示词侧唯一动作是把 `<skills>` 段改写为单行说明（skill 去注入，原独立扩展 `pi-lazy-skills` 已于 commit `358e236` 并入并卸载），其余不动、轮间字节稳定。**关键：`--tools` 白名单必须保留 lazy 工具**（注册与隐藏是两件事）。三常驻工具：`load_tools`、`call_tool`、`skill_search`（skill 动态发现，promptSnippet 限仅用户明确要求使用 skill 时调用） |
| `pi-cache-guardian` | `npm:pi-cache-guardian` | **缓存守护（防 autocompact 后命中率归零）**。首轮完整链处理后将 system prompt 捕获为 **golden 副本**，之后每轮无条件恢复——字节级一致保证前缀缓存不因 autocompact 重建 system prompt 而整体失效；叠加 prompt reorder（稳定内容前置）、skill 压缩（>4 个 skill 时 4 行 XML 压缩为单行索引）、`<session-overview>` 变化字段剥离（RECENT COMMITS/目录状态/行数），并自动设 `PI_CACHE_RETENTION=long`。自动兼容检测：OpenAI 400 时剥离 `prompt_cache_retention`、Anthropic 400 时降级 `cache_control` TTL、OpenAI 兼容端点注入 `prompt_cache_key`。**不注入任何工具**（无 `setActiveTools`），与 `@wolido/pi-lazy-tools` 懒加载不冲突。命令：`/cache-guardimizer`（npm README 里的 `/cache-guardian` 为旧名）查看每轮 `cacheRead`/`cacheWrite` 统计。可选：`PI_CACHE_GUARD=1` 时会话结束命中率 < `PI_CACHE_GUARD_THRESHOLD`（默认 90）报警。**压缩（`/compact`/autocompact）后命中骤降的判定见[压缩与缓存](#压缩与缓存)** |
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget + **运行状态指示**（回合运行中 TUI 底部状态栏实时 spinner、实时 TPS、Waterfall 瀑布图，回合结束弹整回合统计摘要）。配置：`/pi-tps`（`showTraces`/`showStats`/`showTtft`/颜色）。**必须配主题**：装好后 `colorPreset` 默认 `mono`，运行 `fix-tps-theme.ps1`（幂等：同时把 `pi-tps.json` 设为 `theme`、`settings.json` 的 `theme` 设为 `light/dark` 跟随系统）或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |
| `@zhushanwen/pi-smart-context` | `npm:@zhushanwen/pi-smart-context` | **智能上下文压缩（2026-09-27 装，v0.3.4）**：注册 `compact_context` 工具交 agent 自决压缩时机（未达最低档阈值时拒绝并回用量建议）；`session_before_compact` 接管压缩生成走**双模式**——`compactModel` 留空/等于当前模型即 same-model（送全量上下文 + 会话原 system prompt + tools + 末尾压缩指令，前缀可复用、模型看全量，质量上限最高），配廉价模型即 cross-model（调用 pi 原生 `compact()` 仅换模型凭证）；另按 `reminderThresholds` 三档静默注入阈值提醒（不强制、每档一次、已提醒档位随 session 持久化）。排除模型走 `excludedModels` 精准 `provider/modelId` 匹配。配置 `~/.pi/agent/config/smart-context-ext-config.json`，**读时热加载**（改完下一次事件即生效，无需重启）。排障日志 `~/.pi/agent/logs/smart-context-*.log`，前缀 `[smart-context]`，需 `TAIJI_AGENT_DEBUG=1`。⚠ 实测结论与配置值见[压缩与缓存](#压缩与缓存) |
| `pi-prefix-stabilizer` | `npm:pi-prefix-stabilizer` | **前缀稳定器（2026-09-28 装，v0.1.0）**。`before_provider_request` 钩子：把系统提示词里随安装路径/工具顺序漂移的字节钉死——① 安装根路径归一（`packagePathSuffix` → `stablePath`，默认 `$HOME/.pi/pi-home`，可选建软链）；② `tools` 数组**按名排序**；③ `<tools>` 段内条目按名排序；④ system 文本取 sha1 指纹，会话中途变了就**报漂移**（换包/MCP 增删、改 rules/AGENTS.md、换 cwd 都会触发），因为漂移点之后的 KV 前缀全作废。**零工具注入**。⚠ 本机实测**路径改写是 no-op**（Windows 装法在 `D:\agent\pi-windows-x64`、且包内判定只认 `/` 开头且存在的 POSIX 路径），实际只做了 tools 排序 + 漂移检测，8 轮长会话无 `drift` 记录；**不要**把 `packagePathSuffix` 改成 Windows 路径，原理上不生效。详见[压缩与缓存](#压缩与缓存) |
| `pi-compaction-cache` | `npm:pi-compaction-cache` | **压缩调用缓存化（2026-09-28 装，v0.1.1）**。`session_before_compact` 接管摘要生成：把摘要请求重写成**复用已缓存前缀**的形态（默认 `scope:"boundary"` 只发到摘要边界止，保留区不发），并附一次/会话的提示词漂移自检（`prompt_drift_check`，仅结果 `DRIFTED` 才告警，**它不是接管开关**）。这是**唯一能修的失效点**：压缩本身要重发整段历史，原本是压缩会话里最贵的一击。**必须配 `models` matcher**（本机模型无 cost 元数据时走 zero-cost heuristic 会直接 decline），配置文件 `~/.pi/agent/compaction-cache.json`；命令 `/compaction-cache-status` 看逐次判定。**零工具注入**。⚠ 安装顺序**必须在 `pi-smart-context` 之后**（同抢 `session_before_compact`，靠后接管者胜），实测把压缩调用自身命中率从 1.6% 拉到 98.8%，全表见[压缩与缓存](#压缩与缓存) |
### B. 功能增强（其次）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-web-access` | `npm:pi-web-access` | 网页搜索、URL 抓取、GitHub 克隆、PDF/YouTube 理解 |
| `pi-one-ui` | `npm:pi-one-ui` | **统一 TUI 包（2026-09-22 起替代 `alps-pi` 承担美化，要求 Node >=22.19、Pi >=0.84）**：Header/Context/WorkingLine/Editor/Footer 分层布局；`/oneui` 设置面板、`/context` Context Inspector、`@` 补全（会话引用 + Subagent 委派）、Tool/Diff 美化渲染、Mermaid 增强、内置 `cc-dark`/`cc-light` 主题（`/theme`）。配置 `~/.pi/agent/pi-one-ui.json`（canonical v1）。**唯一直改面是同名覆盖内建 `write`**（包内在 edit/write 时记元数据供 Diff 渲染，同名替换不新增 active 工具数，对 token/首请求无影响）；其余皆布局/渲染层。`/oneui` 设置、Preset 一跳保存 |
| `@injaneity/pi-computer-use` | `npm:@injaneity/pi-computer-use` | 观察并控制 macOS/Windows/Linux 桌面应用，**需运行时授予平台权限** |
| `@tian.zuo/pi-find` | `npm:@tian.zuo/pi-find` | **搜索增强**：用 ripgrep/fd 实现 `grep`/`find`，**复用内建工具名**（替换内建而非并列，模型只看到一套搜索面）。有界输出（grep ≤100 命中、find ≤200 文件、行长裁剪、硬字节上限、大文件/超长记录跳过），尊重 `.gitignore` 并跳过 `.git`，支持 `glob`/`!` 排除/`@`与`~` 路径展开。**只注册 `grep`/`find` 两个工具名，不在 lazy 名单即保持常驻 active，不新增工具、不增加注入量** |
| `pi-edit-guard` | `npm:pi-edit-guard` | **编辑强化**：覆盖内建 `edit`（**同名替换**），多层容错匹配（simple → line/whitespace/indentation/escape/unicode 归一化 → block-anchor → fuzzy 等 12+ passes）、匹配唯一性校验、缩进漂移修复、批量感知错误报告。另注册 `undo` 工具（可撤销编辑）。**同名接管内建 `edit` 即生效；`undo` 是否列入 lazy 名单由你定，列入了才被剔除、按需加载，不增首请求注入**。⚠ 声明 `engines.node >=24.18.0`（本机 24.16.0 仅 npm 告警，仍可安装运行） |
| `@trycedar/pi-mdiff` | `npm:@trycedar/pi-mdiff` | **Markdown 编辑**：面向 `.md` 的规范化 SEARCH 匹配 + 块级锚定编辑，注册 `md_inspect`/`md_diff`/`md_edit` 三个工具。**旧包名 `pi-mdiff` 已弃用并迁移到带 scope 的 `@trycedar/pi-mdiff`**。三个工具名可列入 lazy 名单按需加载，**不增首请求注入** |
| `pi-undo-redo` | `npm:pi-undo-redo` | **会话/文件撤销重做**：git 仓库用影子 git 快照、非 git 目录只快照 Pi 文件工具显式触碰的路径（`write`/`edit`），按消息记录补丁元数据。命令 `/undo` 回到上一用户消息并还原其改动的文件、`/redo` 恢复、`/undo-cleanup` 保守清理旧快照；`/tree` 也可还原工作区快照。脏保护：有未快照工作区改动时拦截 `/undo`/`/redo`/`/tree`。**不注册任何 agent 工具**，纯命令扩展，零注入。配置写入 settings.json 的 `undoRedo` namespace（`storageDir`/大文件上限 `largeFileLimitBytes` 默认 2MiB/`gitTimeoutMs`） |
| `pi-mcp-adapter` | `npm:pi-mcp-adapter` | **MCP 适配（免上下文爆炸）**：一个 `mcp` 代理工具（~200 token）替代数百个 MCP 工具定义，按需发现、服务器首次使用时才启动。自动读 `.mcp.json`/`~/.config/mcp/mcp.json`（及 `~/.agents/mcp.json` 等兼容路径）；`/mcp setup` 从 Cursor/Claude Code/Codex 等宿主配置导入、`/mcp disable|enable` 开关服务器。Pi 专用覆盖写 `~/.pi/agent/mcp.json`/.pi 项目层，不改写源文件、不复制凭证。~~依赖 `better-sqlite3`~~（2026-09-23 起 v2.37.0 已移除该依赖，无需批准） |
| `pi-agent-browser-native` | `npm:pi-agent-browser-native` | **原生浏览器自动化**：agent-browser CLI 封装为原生 `agent_browser` 工具（替代脆弱的 shell 命令拼装）：打开页面、交互式快照（`@eN` 引用可继续点击/填表）、截图与下载文件以 Pi artifact 呈现、持久 profile 支持登录态、溢出大输出写 spill 文件防爆上下文、结构化 details（标题/URL/已存文件/会话/错误）。~~依赖 `better-sqlite3`~~（2026-09-23 起 v0.7.1 已移除该依赖，无需批准） |
| `@agenticup/pi-loop` | `npm:@agenticup/pi-loop` | **递归深潜（loop engineering，2026-09-23 装，v0.1.4）**：注册 `loop` 工具，5 阶段流水线——Decompose（MAKER 式拆 8–15 个微子问题）→ DRIP 后置回检补前置条件 → Solve（信号量并发子智能体，`concurrency` 1–8，默认 4）→ Critique（自适应 MAKER 投票，1 个 critic、分歧升级 3 个）→ Iterate（ADaPT 式深分解被标记子问题，≤2 次）→ Synthesize（DRAGON 式子解冲突检测）。参数：`prompt`（必填）、`maxDepth`（1–3，默认 2，每层约 2x 成本）、`concurrency`、`model`（默认跟随会话）；子智能体 20 分钟超时优雅降级、循环继续；进度实时可见（超 40 行截断）+ 逐子问题执行摘要。代价：4 子问题约 5–8x 单答 token、2–5 分钟，简单任务过重。**只注册 `loop` 一个工具，resident 例外制下默认 lazy，不增首请求注入**。用法：「Use loop: <任务>」显式触发 |
| `pi-warm-cache` | `npm:pi-warm-cache` | **空闲期保活（2026-09-28 装，v0.4.0）**。对**已注册路由**（Anthropic / OpenAI / Azure / Codex / xAI 4.5+ / OpenCode Go / OpenRouter）按厂商 TTL 在会话空闲时发极小请求续前缀缓存（默认 1 token 输出、锚定同一 cache routing key），`/warm status`（含 `automaticWarm` 判定）、`/warm 5m`、`/warm 1h`、`/warm auto`、`/warm probe`、`/warm log` 手动档。**零工具注入**。⚠ **本机不生效**：模型是本地代理 `http://localhost:20128/v1`（`openai-completions`、未注册路由），`resolveStrategy` 判 `capability.state !== "verified"` → `intervalMs: null, automaticWarm: false`，永不装定时器（源码注释：unverified route never arms a timer）。换到上述任一已注册 provider 才自动启用；不注册也**不会报错**，纯静默待命 |
| `pi-footer-template` | `npm:pi-footer-template` | **footer 模板（2026-09-28 装，v0.5.0）**。用 `ctx.ui.setFooter` 接管底栏，支持 `{model}`/`{cwd}`/`{tokens}`/`{balance}`/`{branch}`/`{CH}` 等占位（可自注册 token），默认模板已含 **`CH{latestCacheHitRate}%`**——**最后一条 assistant** 的 `cacheRead/(input+cacheRead+cacheWrite)`，即本文各表「命中」那一列的同一口径。配置 `footerTemplate` 写项目 `.pi/settings.json` 或用户 settings。**零工具注入**。⚠ 与 `pi-one-ui` 的 Footer 层**抢同一个 footer 槽**（`ctx.ui.setFooter` 单槽，后写者胜），本机已让 one-ui 主动让位（`pi-one-ui.json` 设 `components.footer.style: "native"`），详见[压缩与缓存](#压缩与缓存)末节 |

## Skills（可选，非扩展，Agent Skills 标准）

> **与扩展不同：skill 不经 `pi install`，是目录粒放到 `~/.pi/agent/skills/`**（pi 按 Agent Skills 标准递归发现含 SKILL.md 的目录）。skill **不注册任何工具**；**系统提示词注入由 `pi-lazy-tools` fork 内置剥离（原独立包 `pi-lazy-skills` 已并入并卸载）**——Pi 默认把全部 skill 的 name + description 常驻注入 `<skills>` 段，pi-lazy-tools 在 `before_agent_start` 改写为单行说明，skill 元数据**零常驻**，改为按需 `skill_search` 动态发现（常驻承载工具，唯一不入 lazy 名单的例外，见[工具归属](#工具归属)）。全文与 references 按需 `read` 加载。存入即生效（新会话 / `/reload`）。

| Skill | 来源 | 作用 | 上下文开销 |
|---|---|---|---|
| `cangjie-skill`（仓颉） | `git clone github.com/kangarooking/cangjie-skill`（2026-09-23 安装，HEAD `3adf9e6`，v2.5.0） | 拆书元 skill：把书/长视频/播客/课程的方法论蒸馏成原子化可调用的 skill packs（RIA-TV++ 流水线，Adler 阶段 0 → 并行抽取 → 三重校验 → 编译 → 压测 → 交付；description 511 字符 < 1024 上限）。仅装 `SKILL.md + methodology/ + extractors/ + templates/ + scripts/ + schemas/`（349K），跳过 website/books/benchmarks/dist/tests/docs/registry（~2.5M，非运行必需；`docs/migrations` 一处引用为版本迁移说明，需要时回仓库看） | 常驻 0（pi-lazy-tools 剥离注入，description 仅在 `skill_search` 命中时按需出现在工具结果里）；启用时 SKILL.md 13KB ≈ 4k token + 按需 `methodology/`（64K）、`extractors/`（24K）等 |
| `goutoujunshi`（狗头军师） | `git clone github.com/shengjidaguai-china/goutoujunshi`（2026-10-21 安装，HEAD `6db7354`） | 恋爱军师与情绪支持：心动/暧昧/追求/聊天记录或截图分析/多人选择/冲突/分手复合（Codex 社区标准 SKILL.md，pi 兼容，description 692 字符 < 1024 上限）。本地 sqlite 长期记忆（`scripts/memory_store.py`，仅标准库，按需召回压缩摘要，不存整份聊天） | 常驻 0（pi-lazy-tools 剥离注入）；启用时 SKILL.md 9.4KB ≈ 5k token + 按需 1–3 份 references（每份 2–8k） |

```bash
# 安装（示例源在 /tmp，实际自 git clone）：
mkdir -p ~/.pi/agent/skills/goutoujunshi
mkdir -p ~/.pi/agent/skills/goutoujunshi
cp -r <repo>/SKILL.md <repo>/references <repo>/scripts ~/.pi/agent/skills/goutoujunshi/

# cangjie-skill：
mkdir -p ~/.pi/agent/skills/cangjie-skill
cp -r <repo>/SKILL.md <repo>/methodology <repo>/extractors <repo>/templates <repo>/scripts <repo>/schemas ~/.pi/agent/skills/cangjie-skill/
```

自查：目录含 `SKILL.md`（frontmatter `name` + 非空 `description`）即被发现；`pi list` 不显示 skill。使用：`/skill:goutoujunshi`、`/skill:cangjie-skill` 显式加载；或明确要求「使用 XX skill」→ 模型经 `skill_search` 按关键词检索 name/description/路径后 `read` SKILL.md。⚠ 注入剥离后**模糊描述自动路由已移除**（模型看不到 description），skill 发现依赖用户点名或给出可匹配关键词。

## 安装与配置

> **本轮（2026-09-22）实测环境**：Pi 0.87.0、npm 12.0.2（注意 README 中 `npm install-scripts approve` 属 npm 12 子命令；旧 `allowScripts` 字段引用了已卸载包的旧版本号，`npm install-scripts approve` 报 `Nothing to approve` 不重跑已批脚本 → 改用 `npm rebuild better-sqlite3` 重建原生依赖成功，`prebuilds/win32-x64.node` 平台 prebuilt 亦可用；computer-use 的 `setup-helper.mjs --postinstall` 手动重跑输出 `[pi-computer-use] Windows helper already up to date` 即就位）。

> **警：逐条串行安装，勿并行。** 多进程 `pi install` 会竞写 `~/.pi/agent/settings.json` 丢注册（实测 17 项仅剩 5 项留存），且并发操作同一 `~/.pi/agent/npm` 目录会触发 `ENOENT: Cannot cd into .../node_modules/<pkg>`（实测 `typebox`）。
>
> `pi install` 一次只接受单个 source，故直接串行跑循环：

```bash
for p in pi-cache-guardian pi-tps pi-one-ui \
         pi-web-access @injaneity/pi-computer-use @tian.zuo/pi-find \
         pi-edit-guard @trycedar/pi-mdiff pi-undo-redo \
         pi-mcp-adapter pi-agent-browser-native \
         @agenticup/pi-loop \
         @zhushanwen/pi-smart-context \
         pi-prefix-stabilizer pi-compaction-cache \
         pi-warm-cache pi-footer-template; do
  pi install "npm:$p" || echo "[失败] $p"
done
```

> **末 4 个包的顺序有硬约束（2026-09-28）**：`pi-compaction-cache` 必须排在 `@zhushanwen/pi-smart-context` **之后**（两者都接 `session_before_compact`，靠后拿到的接管权；反过来 smart-context 的 same-model 先给摘要，压缩调用命中就退回 1.6%），`pi-prefix-stabilizer` 排在 `pi-compaction-cache` **之前**（先稳前缀再谈复用）。`pi-warm-cache`/`pi-footer-template` 顺序不限。`pi install` 一次只写一条注册，照序跑即可。

> git 源无法并入 npm 循环，单独装（`pi-lazy-tools` fork）：

```bash
pi install git:github.com/qq458249269/pi-lazy-tools
```

> **更新（2026-09-24 起）**：扩展升级**勿用 `pi install`**——实测对已装包命中 npm 缓存不升版本，须带 `@latest` 才到位；直接走专门升级命令，一条即可：
>
> ```bash
> pi update --extension <source>   # 单包，如 pi update --extension pi-web-access
> pi update --all                  # pi + 全部扩展
> ```
>
> ⚠ `@injaneity/pi-computer-use` 的 postinstall（`node scripts/setup-helper.mjs --postinstall`，生成平台桥接 helper）会被 npm `allowScripts` 默认拦截。装完后再批：
>
> ```bash
> cd "%USERPROFILE%\.pi\agent\npm" && npm install-scripts approve @injaneity/pi-computer-use
> ```
>
> 批准后 helper 需重跑一次（`npm install-scripts` 无 run 子命令，直接手动执行）：
>
> ```bash
> cd "%USERPROFILE%\.pi\agent\npm\node_modules\@injaneity\pi-computer-use" \
>   && node scripts/setup-helper.mjs --postinstall   # 输出 [pi-computer-use] ...helper already up to date 即就位
> ```

> ~~⚠ `pi-mcp-adapter`/`pi-agent-browser-native` 共享原生依赖 `better-sqlite3`……`npm install-scripts approve better-sqlite3`~~ **此步骤 2026-09-23 起作废（2026-09-24 随 pi-subagents 卸载改称两包）**：两包新版（pi-mcp-adapter 2.37.0 / pi-agent-browser-native 0.7.1）均已移除 `better-sqlite3` 依赖，approve 会报 `ENOMATCH: No installed packages match`，依赖树中亦无该包（实测 `find` 无目录）。`allowScripts` 里的旧条目 `better-sqlite3@13.0.3: true` 为历史残留，无害可留。详见[全量重装实录](#全量重装实录与问题修复2026-09-23)问题 2。

装完自查（`pi list`，不并行）：应见 **18 个扩展**——17 个 npm（`pi-web-access`、`pi-tps`、`@injaneity/pi-computer-use`、`pi-one-ui`、`pi-cache-guardian`、`@tian.zuo/pi-find`、`pi-edit-guard`、`@trycedar/pi-mdiff`、`pi-undo-redo`、`pi-mcp-adapter`、`pi-agent-browser-native`、`@agenticup/pi-loop`、`@zhushanwen/pi-smart-context`、`pi-prefix-stabilizer`、`pi-compaction-cache`、`pi-warm-cache`、`pi-footer-template`）+ 1 个 git（`git:github.com/qq458249269/pi-lazy-tools`）。若少于 17（并行竞写伤痕），重跑上述循环补漏；git 源安装命令见上方 npm 循环后附注。

pi-lazy-tools 配置（fork `git:github.com/qq458249269/pi-lazy-tools`；写入 `~/.pi/lazy-tools.json`，用户级；`<cwd>/.pi/lazy-tools.json` 项目级整体覆盖用户级）。**2026-09-22 起执行默认五工具常驻策略**：自带五个工具（`read`/`write`/`edit`/`bash`/`powershell`，由项目 `.pi/settings.json` 的 `defaultTools` 显式声明）与 `load_tools`/`call_tool` 常驻 active 集，其余扩展工具全部列入 lazy 名单，见下方[全量懒加载策略](#全量懒加载策略)：


```json
{ "resident": ["read", "write", "edit", "bash", "powershell", "load_tools", "call_tool", "skill_search"] }
```

> **2026-09-28 订正**：本节早期版本写的是 `"lazy": [...]` 名单数组，那是上游 `@wolido/pi-lazy-tools` 的格式；**当前 fork（`git:github.com/qq458249269/pi-lazy-tools`）用的是 resident 例外制**——`resident` 列常驻例外，**其余一切默认全 lazy**，所以本机 `~/.pi/lazy-tools.json` 里只剩上表这 8 个名字（`~/.pi/lazy-tools.json` 不在 `~/.pi/agent` 下）。
>
> **2026-09-28 新增四包对懒加载策略的影响：零**。`pi-prefix-stabilizer`/`pi-compaction-cache`/`pi-warm-cache`/`pi-footer-template` 均无 `registerTool`/`setActiveTools`，不新增任何工具名，`activeTools` 仍 8，不需改 `lazy-tools.json`。


> **默认五工具常驻 + 扩展全懒策略（2026-09-22 拍板，长期执行）**：自带五个工具（`read`/`write`/`edit`/`bash`/`powershell`）与 `load_tools`/`call_tool` 承载工具常驻 active 集，其余扩展工具一律 lazy，低频不设门槛、默认全懒。理由：写代码主链路（读/写/编辑/shell）零 `load_tools` 往返；各扩展 description/schema 不常驻上下文，按需 `load_tools` 注入，注入量与首请求 token 最低。代价：搜索/网页/UI/子代理每次使用多一轮 `load_tools` 往返（含用户点名确认），`grep`/`find` 亦需先激活。**安装任何新扩展后，把其注册的工具名补进下方 lazy 名单，保证新扩展工具同样默认全懒。** 需查当前已注册工具：`pi list` 或新会话启动 `ctx.ui.notify` 打印的 lazy 名单。
>
> ⚠ 五工具（`read`/`write`/`edit`/`bash`/`powershell`）常驻即随叫随用，写代码前无需激活；`grep`/`find`（@tian.zuo/pi-find）等扩展工具仍需 `load_tools` 激活（两步确认门），确认门只在用户点名要求时通过。`--tools` 白名单必须保留 lazy 工具（注册与隐藏是两件事），当前无 `--tools` 字段、默认全注册，安全。


> 该表为首轮 `session_start` 实测基线（安装 `pi-cache-guardian` 前）。`pi-cache-guardian` 不注入工具，`activeTools` 数不变；system prompt 内容受其 reorder/压缩影响（长度基本持平，压缩仅在 skill>4 时生效），属 `before_agent_start` 阶段内部改写，不影响首请求注入量与基线对比结论。
>
> **2026-09-17 追加 4 个扩展后基线结论不变**：`pi-cache-guardian` 不注入工具；`alps-pi` 纯 TUI 零工具注入（`activeTools` 仍 7，首请求注入量不变）。
>
> **2026-09-22 换装后基线结论仍不变**：`@wolido/pi-tool-search` 下架 → `@wolido/pi-lazy-tools` 承接（常驻 `load_tools`/`call_tool` 两工具不变）；`alps-pi` 移除 → `pi-one-ui` 加入。`pi-one-ui` 唯一直改面为**同名覆盖内建 `write`**（Diff 元数据，`activeTools` 仍 7），其余零工具注入、零 `before_agent_start` 干预，首请求注入量不变。本机 Node 24.16.0 满足其 `>=22.19` 要求。
>
> `pi-tps` 与 `pi-one-ui`（继任者，前身 `alps-pi`）是纯 UI/运行时监控扩展，不注册新的 agent 工具名（`pi-one-ui` 仅同名覆盖内建 `write`），因此**不增加首次请求 token**（相对基线仅 +~150 chars 的 `pi-tps` 策略文字，`pi-one-ui` 为 0）。其余扩展工具列入 lazy 名单的，需要时 `load_tools` 注入用法，不占首次请求 token。
>
> **2026-09-18 追加 `pi-edit-guard`/`@trycedar/pi-mdiff` 后基线亦不变**：`pi-edit-guard` **同名覆盖** `edit`（属核心 6，不新增激活项），额外 `undo` 为非核心（被隐藏）；`pi-mdiff` 的 `md_inspect`/`md_diff`/`md_edit` 均为非核心（被隐藏）。`activeTools` 仍 7，不增首请求注入量。
>
> **2026-09-21 追加 5 个扩展后基线仍不变**：`pi-undo-redo` 零工具注入；`pi-hermes-memory`（6 工具，**2026-09-22 已卸载**）/`pi-subagents`（`subagent`、`contact_supervisor`，**2026-09-24 已卸载**）/`pi-mcp-adapter`（`mcp`）/`pi-agent-browser-native`（`agent_browser`）共 10 个工具**全部列入 lazy 名单**，从 active 集剔除，`activeTools` 仍 7，不增首请求注入量。
>
> **2026-09-22（二轮）策略回调后基线不变**：自带五工具（`read`/`write`/`edit`/`bash`/`powershell`）经 `.pi/settings.json` 的 `defaultTools` 显式常驻，`edit` 移出 lazy 名单；`grep`/`find` 等扩展工具仍懒加载。`activeTools` 仍 7，首请求注入量不变。

## 安装后操作

### 一键配置脚本（幂等，可重复执行）

| 脚本 | 用途 |
|---|---|
| `fix-tps-theme.ps1` | `pi-tps` 颜色跟随系统主题（`theme` -> `light/dark`，`colorPreset` -> `theme`） |
| `fix-browser-native-compat.mjs` | `pi-agent-browser-native` 在 **pi 0.85.x** 下的加载期兼容补丁（`sessionManager.buildSessionProjection` 是 0.86+ API），修掉启动即报的 `buildSessionProjection is not a function` |

```bash
powershell -ExecutionPolicy Bypass -File fix-tps-theme.ps1
node fix-browser-native-compat.mjs
```

`fix-tps-theme.ps1` 为 UTF-8 BOM 保存，PowerShell 5.1 / 7 均可正确解析中文；`fix-browser-native-compat.mjs` 用 node 跑（**别改回 .ps1**：无 BOM 的中文 .ps1 在 Windows PowerShell 5.1 下按 ANSI 读会 ParserError）。两者都幂等：已打过输出 `[skip]`，不会覆盖你改过的值；`pi update`/重装丢了后者，重跑一次即可。

1. **重启 Pi** 使扩展生效。
2. 新会话里对主智能体说「激活 X」：`load_tools` 先返回挑战文本（`confirm:false` 零副作用），用户点名确认后 `confirm:true` 激活、`call_tool` 调用。**自带五工具（`read`/`write`/`edit`/`bash`/`powershell`）默认常驻，无需激活**；扩展工具（`grep`/`find`/网页/UI/子代理）才需激活。启动时 `ctx.ui.notify` 打印当前 lazy 名单与配置文件路径。
3. `pi-tps`：运行 `fix-tps-theme.ps1` 让颜色跟随系统主题。`pi-one-ui`：`/oneui` 打开设置面板、`/context` 查看上下文、`/theme` 切换内置主题（`cc-dark`/`cc-light`）；配置存 `~/.pi/agent/pi-one-ui.json`，`/reload` 后 Features 生效（组件开关即时生效）。`@injaneity/pi-computer-use`：先完成上面的 postinstall 批准与 helper 重跑，首次运行时再授予平台权限。
4. `pi-cache-guardian`：装上即用（golden freeze + `PI_CACHE_RETENTION=long` 自动生效），`/cache-guardimizer` 查看每轮缓存统计；可选开启会话结束命中率报警：`PI_CACHE_GUARD=1`（阈值 `PI_CACHE_GUARD_THRESHOLD`，默认 90）。autocompact 后是新 session，会重新捕获 golden，无需干预；`/compact` 后首轮命中低属结构性，判定与处置见[压缩与缓存](#压缩与缓存)。
5. **`pi-edit-guard`**：装上即用，**同名接管内建 `edit`**。`undo` 在 resident 例外制下**默认已全懒**（不在 `resident` 即 lazy），要让它常驻才需把它加进 `~/.pi/lazy-tools.json` 的 `resident`。⚠ 若启动报 node 版本相关错误，需将 Node 升到 `>=24.18.0`（本机 24.16.0 实测仅安装告警、运行正常）。
6. **`@trycedar/pi-mdiff`**：装上即用，编辑 `.md` 时按需 `load_tools` 激活 `md_inspect`/`md_diff`/`md_edit`（三个工具默认已全懒，无需改配置）。**旧包名 `pi-mdiff` 已弃用，务必用 `npm:@trycedar/pi-mdiff`**（bare 名会触发弃用告警甚至 ECONNRESET 失败）。
7. **`pi-undo-redo`**：装上即用，纯命令扩展（`/undo`、`/redo`、`/undo-cleanup`），默认存储 `~/.pi/agent/state/pi-undo-redo`，无需配置。可选调整 settings.json 的 `undoRedo`（`storageDir`/`largeFileLimitBytes`）。git 仓库自动走影子 git 快照，非 git 目录只覆盖 `write`/`edit` 显式路径。
8. **`pi-mcp-adapter`**：装上重启后自动读 `.mcp.json`/`~/.config/mcp/mcp.json`；无配置时 `/mcp setup` 导入宿主配置或脚手架。`mcp` 工具默认已全懒，`load_tools` 激活后按需代理调用 MCP 服务器，服务器首次使用时才启动。
9. **`pi-agent-browser-native`**：装上即用，`agent_browser` 默认已全懒，`load_tools` 激活后可直接驱动真实浏览器（需本机有 `agent-browser` CLI，首次运行时自动按需启动）。⚠ **pi 0.85.x 需先跑 `node fix-browser-native-compat.mjs`**，否则启动即报 `buildSessionProjection is not a function`（见[pi-agent-browser-native 兼容补丁](#pi-agent-browser-native-兼容补丁2026-09-28)）。
10. **`@agenticup/pi-loop`**：装上即用，无需配置（resident 例外制下 `loop` 默认 lazy，不改 `~/.pi/lazy-tools.json`）。显式点名触发：「Use loop: <复杂任务>」→ 5 阶段流水线实时输出，结束给执行摘要；子智能体并发与深度按 `concurrency`/`maxDepth` 控制，简单任务勿用（token/延迟 5–8x）。
11. **`@zhushanwen/pi-smart-context`**：装上即用，先写 `~/.pi/agent/config/smart-context-ext-config.json`（本机取值见[压缩与缓存](#压缩与缓存)的「smart-context 配置」小节——**默认 400K/500K/600K 三档对本机 100K 窗模型永不触发，须下调**）。`compact_context` 默认全懒、无需改配置；阈值提醒静默注入（只进 LLM 上下文、不触发新 turn、不进对话流）。排障加 `TAIJI_AGENT_DEBUG=1` 看 `~/.pi/agent/logs/smart-context-*.log`。
12. **`pi-prefix-stabilizer`**：装上即用，无需配置。默认只做 tools 数组排序 + system 文本 sha1 漂移检测（**本机路径改写是 no-op，别去改 `packagePathSuffix`**，Windows 路径原理上不生效）。排障日志：设 `PI_PREFIX_STABILIZER_LOG=<文件路径>`，`{"first_rewrite":true,"replacements":1,"roots":[]}` = 只排序了 tools；`{"drift":true,"from":…,"to":…}` = 前缀漂移（此时本轮命中会掉，等下轮回升）。
13. **`pi-compaction-cache`**：**必须先写** `~/.pi/agent/compaction-cache.json`（本机取值见[压缩与缓存](#压缩与缓存)「四包实测」小节：`{"models":["1","1/1"],"scope":"boundary","logPath":"…","debug":false}`）——**`models` matcher 漏了会直接 decline**（本机模型无 cost 元数据，走 zero-cost heuristic 拒绝接管）。装上即用；`/compaction-cache-status` 看逐次判定，日志落 `logPath`。⚠ 须在 smart-context 之后加载，否则拿不到接管权。
14. **`pi-warm-cache`**：装上即用、无需配置，**但本机不生效**（本地代理属未注册路由，`automaticWarm:false`、永不装定时器）。换到已注册 provider（Anthropic/OpenAI/Azure/Codex/xAI 4.5+/OpenCode Go/OpenRouter）即自动启用；想确认 `/warm status` 里 `automaticWarm` 是 true 还是 false。
15. **`pi-footer-template`**：装上即用，**默认模板已含 `CH{latestCacheHitRate}%`**（最后一条 assistant 的命中率），无需配置即在底栏显示。要改模板写 `footerTemplate`（项目 `.pi/settings.json` 或用户 settings）。⚠ 必须先让 `pi-one-ui` 让出 footer 槽：`~/.pi/agent/pi-one-ui.json` 设 `{"components":{"footer":{"style":"native"}}}`，否则两者抢同一个 `ctx.ui.setFooter` 槽、谁后加载谁赢。

## 全量懒加载策略

**2026-09-22 起长期执行：自带五个工具（`read`/`write`/`edit`/`bash`/`powershell`）默认常驻 active 集，扩展工具一律 lazy，低频不设门槛。** 首请求上下文保留五个内置工具 + `load_tools`/`call_tool` 两个承载工具，其余全部从 LLM 可见 active 集剔除；需要时由 `load_tools` 纯文本注入用法、`call_tool` 代理执行（两步确认门：`confirm:false` 零副作用挑战文本 → 用户点名后 `confirm:true` 激活，会话级记忆、会话开始清空）。

### 工具归属

| 扩展 | 工具 | lazy 名单位 |
|---|---|---|
| 自带五工具 | `read`、`write`、`edit`、`bash`、`powershell` | ✗ 内建常驻（`.pi/settings.json` 的 `defaultTools` 显式声明） |
| pi-edit-guard | `edit`、`undo` | `undo` ✓；`edit` ✗ 同名覆盖内建，归核心常驻 |
| @trycedar/pi-mdiff | `md_inspect`、`md_diff`、`md_edit` | ✓ |
| @tian.zuo/pi-find | `grep`、`find` | ✓ |
| pi-web-access | `web_search`、`source_check`、`fetch_content`、`get_search_content` | ✓ |
| @injaneity/pi-computer-use | `observe_ui`、`search_ui`、`expand_ui`、`inspect_ui`、`act_ui`、`read_text`、`wait_for`、`find_roots`、`launch_browser`、`navigate_browser`、`evaluate_browser` | ✓ |
| pi-mcp-adapter | `mcp` | ✓ |
| pi-agent-browser-native | `agent_browser` | ✓ |
| @agenticup/pi-loop | `loop` | ✓（resident 例外制下不在 `resident` 即默认 lazy，无需改配置） |
| @zhushanwen/pi-smart-context | `compact_context` | ✓（resident 例外制下不在 `resident` 即默认 lazy，无需改配置） |
| pi-undo-redo | （无工具，仅 `/undo` `/redo` `/undo-cleanup` 命令） | — |
| pi-prefix-stabilizer | （无工具，纯 `before_provider_request` 改写） | — |
| pi-compaction-cache | （无工具，仅 `/compaction-cache-status` 命令） | — |
| pi-warm-cache | （无工具，仅 `/warm …` 命令系列） | — |
| pi-footer-template | （无工具，走 `ctx.ui.setFooter`） | — |
| pi-lazy-tools（`git:github.com/qq458249269/pi-lazy-tools`） | `load_tools`、`call_tool`、`skill_search` | ✗ 承载者（工具懒加载 + skill 动态发现），常驻；`skill_search` promptSnippet 限仅用户明确要求使用 skill 时调用 |
| pi-one-ui | （无新工具名；**同名覆盖内建 `write`**，如 edit-guard 之于 `edit`） | ✗ 同名替换，归核心 |
| 用户自定义 | `deploy_tool` | ✓ |

### 执行纪律

1. **安装任何新扩展 → 其注册工具名补进 `~/.pi/lazy-tools.json` 的 `lazy` 数组**（同扩展工具可部分 lazy，此处全量）。唯一例外：`skill_search`（pi-lazy-tools）作承载者常驻——其 promptSnippet 本身就是按需门控，且系统提示词单行说明直接引用该工具名，剔除会导致说明指向不存在的 active 工具。
2. **`--tools` 白名单必须保留 lazy 工具**：注册与隐藏是两件事，只加 lazy 名单不进 `--tools`，`load_tools` 会报「未找到工具元数据」。
3. 激活是会话级记忆，会话开始清空；`load_tools` 只在用户主动点名时才 `confirm:true`，不自行加载。
4. 开新会话生效（扩展在会话启动时加载）。
5. **勿把 `defaultTools` 置空或移除五工具**：`.pi/settings.json` 的 `defaultTools` 显式声明五个内置工具，改 `[]` 会退回零内置工具（只留扩展工具）。

### 权衡

- 得：五个核心工具（`read`/`write`/`edit`/`bash`/`powershell`）零成本常驻、写代码主链路随叫随用；扩展工具说明书不常驻上下文、注入量与 token 低。
- 失：搜索/网页/UI/子代理等扩展工具每次使用多一轮 `load_tools` 往返（含用户确认），`grep`/`find`（@tian.zuo/pi-find）亦需先激活。
- `edit` 常驻即原始能力（同名覆盖内建行为保留）；`grep`/`find` 仍 lazy，激活后即恢复。

### 缓存纪律（web_search 等大输出工具）

**实测（2026-09-21 会话）**：web_search 默认把原始 HTML/CSS/热榜 JSON 全文（21KB+）写入会话历史，该轮前缀命中率从 96%+ 骤降至 **50.5%**；load_tools 注入大 schema 文本同理（55.7%）。前缀缓存从请求开头匹配，命中只到上一请求末尾——**一次性注入大文本的轮次命中率必然崩，看累计命中率（~90%）而非单轮**。

执行约定：

1. **web_search 一律用 `workflow:"auto-summary"`**（返回精简摘要 + sources，实测无原始 HTML 入历史）或 `includeContent:false`；确需全文时才显式开 `includeContent:true`。
2. 大工具输出轮命中率低是结构性必然，评估看 `/cache-guardimizer` 累计值，`PI_CACHE_GUARD_THRESHOLD` 报警阈值勿按单轮瞬间判定。
3. cacheWrite 全程为 0 时（OpenAI 兼容端点不报写侧缓存），长输出对前缀缓存是净负债，能不进历史就不进。

## 压缩与缓存

**结论先行：压缩后首轮命中不可能 100%，「命中 0」才是故障。** 分清两种「低」，处置完全不同。**（2026-09-28 补：唯一能被修的「低」是压缩调用自身，本机已由 `pi-compaction-cache` 从 1.6% 拉到 98.8%，见本节末「四个新包实测」。）**

**根因（结构性，非 bug）**：Pi 压缩后重建的上下文是 `system | summary | firstKeptEntryId 之后的消息`（`docs/compaction.md`）——被摘要替换掉的那段历史对 provider 是全新前缀，**任何扩展都救不回来**，这是前缀缓存的定义。且压缩请求本身走 fresh routing session id、provider 支持时禁写缓存。若命中低但非 0（例：首轮 input 71k、hit 49%），属正常，看下一轮是否回到 90%+。

**唯一可修的失效点是 system prompt 那一段**：压缩时 Pi 重建 system prompt（日期、CWD、`<session-overview>` 的 RECENT COMMITS / 目录状态 / 行数等字段逐轮变字节）→ 前缀首字节即不匹配 → 整段作废，统计上就表现为 0。`pi-cache-guardian` 的 golden freeze 正是为此：首轮走完整优化链后捕获 golden 副本，此后每轮 `before_agent_start` 无条件恢复（`goldenSystemPrompt !== null` 分支直接 return golden），字节级一致；配 prompt reorder（稳定内容前置）与 `<session-overview>` 变化字段剥离，从源头断掉漂移源。

**实测（2026-09-26，扫本机 `~/.pi/agent/sessions/**.jsonl` 的 `cache-guard-turn` 记录）**：4 个发生过压缩的会话，压缩后首轮 hit 依次 **49% / 98% / 95% / 99%**（cacheRead 6.7 万 ~ 495 万 token），紧随其后的下一轮 **50% / 100% / 97% / 99%**——无一为 0。扩展确实在跑（每轮都落 `cache-guard-turn` 自定义条目），不是空转。

**执行约定**：
1. 命中 0 → 查 `/cache-guardimizer stats` 的 `Golden system prompt` 是否为 `not yet captured`（`session_start` 清空、首轮才捕获）；为 0 说明本会话尚未捕获，看下一轮。
2. 已捕获却仍 0 → golden 未生效，核对扩展版本与 pi 版本后 `/reload`。
3. 命中低但非 0 且下轮不回升 → 查该轮是否有大工具输出（见上文「缓存纪律」一节），不是压缩问题。
4. 想进一步保命中可开 `PI_CACHE_GUARD=1`，会话结束累计命中率低于阈值时告警。

**可用性核对（2026-09-26）**：本机 `~/.pi/agent/npm/node_modules/pi-cache-guardian` 为 **v1.0.7**，与 npm `dist-tags.latest` 一致（2026-08-18 发布）；`pi list` 正常加载；`before_agent_start` golden 冻结、`agent_end` 统计、`session_start` 重置、`/cache-guardimizer` 命令四项 hook 均在源码中；**零工具注入**，与 `pi-lazy-tools` 懒加载不冲突。

**同类候选（均不装）**：`pi-observational-memory` 治的是压缩后记忆断层（摘要套摘要丢决策理由），不是命中率；`pi-deepseek-cache` / `@rohaquinlop/pi-deepseek-cache` 的 cache-friendly compaction 绑定 DeepSeek；`pi-cache-optimizer` 与 guardian 在 prompt 稳定化上重叠；`@mrclrchtr/supi-cache` 只做历史取证；`@diousk/pi-warm-cache` 保空闲期 TTL，对压缩后失效无关。**均不解决 system prompt 字节漂移这个根因，装了只是多一份常驻负担**——故维持单一 `pi-cache-guardian`。

### smart-context 与 billion-context 实测（2026-09-27）

**测法**：必须 RPC 多轮驱动（`.sc-test/drive.mjs`、`drive-bcp.mjs`）。`pi -p` 单 turn 压缩**必被拒**：单 turn 下 pi 不填 `preparation.messagesToSummarize` → `shadowedTokens=0` → 收缩校验 `isSummaryInflated(summaryTokens, shadowedTokens) => summaryTokens >= shadowedTokens` 恒真。filler 为三份各约 13K token 的假文档，逐轮 `read` 撑大上下文，provider/model/代理变量全程锁定。

**结论先行：前缀缓存自头顺序匹配，压缩＝改写历史开头＝其后全部失效。故「压缩后高命中」在结构上不可得，可比的只有压缩那一次调用自身的命中。**

| 方案 | 压缩生效 | 压缩调用自身 cacheRead | 压缩后首个请求 cacheRead |
|---|---|---|---|
| smart-context same-model 接管 | 是（模型看全量） | **14,778 / 14,794（tokenBefore 59,703 / 19,025 时命中率 20.6% / 47.6%）** | 回落 3,074–3,110（仅 system 前缀） |
| billion-context 就地块压缩 | 是（`▣ ACP 50.3K → 13.1K`） | 44,632 / 34,176 | **10,578**（−76%，恒定在 10–12K 的 system+tools 固定前缀；第一个被压缩块之后全部重算） |
| pi 原生回落路径 | 是 | 2,730–5,385（cacheRead 141–2,428） | 3,074–3,110 |

三者中 smart-context 的 same-model 接管最优且质量最高，故为唯一保留项。billion-context 的块/handle 机制对 KV 缓存无益。

> **2026-09-28 对账**：上表 smart-context 那行（压缩调用 20.6% / 47.6%）是 same-model 接管**碰巧前缀对齐**时的读数；同日用确定性驱动复测，同样的 same-model 接管只拿到 **1.6%**（68,350 全量重发）——即**这次调用本身并不保证命中，看那一刻整段历史有多少已在缓存里**。要稳定拿到高命中，请用 `pi-compaction-cache` 接管（98.8%，见[四个新包实测](#四个新包实测2026-09-28prefix-stabilizer--compaction-cache--warm-cache--footer-template)）。

**billion-context-pi 卸载原因（不只是无效，是有害）**：其 `compress`/`decompress`/`search_context`/`acp_status`/`acp_cache` 五个工具在**扩展加载期**注册（`dist/index.js` 约 23096 行；`acp_delegate*` 因在 `session_start` 内注册而幸存），而 `pi-lazy-tools` 用裸 jiti 上下文加载他扩展的 load 期工具，bcp 顶层 `import * as piModule from "@earendil-works/pi-coding-agent"` 解析失败 →
```
[lazy-tools] failed to load tool definition for "compress" from .../billion-context-pi/dist/index.js:
  error: Cannot find module '@earendil-works/pi-coding-agent'
```
→ 模型三次正确构造 `compress` 调用全部返回 `isError: "Tool compress not found"`。而 bcp 又无条件 `session_before_compact → { cancel: true }`（非 refused 状态），**工具全废 + pi 原生压缩被取消 = 会话永不再压缩**，纯风险。规避手段（曾用）：`PI_CODING_AGENT_DIR` 指向仅装 bcp 的临时 agent 目录即可正常压缩，上表数据即在该环境取得。已 `pi remove npm:billion-context-pi`。

**smart-context 配置（本机）** `~/.pi/agent/config/smart-context-ext-config.json`（热加载，无需重启）：
```json
{ "enabled": true, "compactModel": { "type": "ref", "ref": "" }, "reminderThresholds": [60000, 75000, 90000], "excludedModels": [] }
```
- `compactModel.ref` 留空 = same-model（空串亦可绕过一个判定差；等价写法 `"ref": "1"`）。改指廉价模型即 cross-model，调用 pi 原生 `compact()`，只换凭证，省的是输入/输出总量而非命中。
- 三档阈值**必调**：默认 400K/500K/600K 对本机 contextWindow 100K 的模型永不触发。取 60K/75K/90K 配合 `.pi/settings.json` 的 `compaction.reserveTokens`（本机测试用 60000）会与 agent 自选时机重叠，压缩接管率下降，排查时先临时抬高 `reserveTokens`。

**已知缺陷（可报上游）**：pi 0.85.1 下 `preparation.messagesToSummarize` 常为空 → `shadowedTokens=0` → 5 次接管被拒 3 次：
```
[smart-context] summary inflated, rejecting takeover {"summaryTokens":1820,"shadowedTokens":0}
```
判据在 `src/pure.ts:162`，计估在 `src/compact-handler.ts:307-312`。实际影响：被拒则回落原生压缩，摘要质量降为压缩前，且压缩调用无缓存命中（见上表第三行）。`pi-cache-guardian` 的 system prompt 冻结**救不了此项**（根因是历史消息改写，不是 system prompt 字节漂移）。

### 四个新包实测（2026-09-28：prefix-stabilizer / compaction-cache / warm-cache / footer-template）

**测法（确定性驱动，不依赖模型是否真调工具）**：`pi --mode rpc` 多轮直灌，驱动脚本 `.sc-test/drive-cache2.mjs`——8 段 ×48KB 假文档当**用户消息**直接灌进去（上下文线性增长、必过阈值、必触发真压缩；早期版本靠模型 `read` 文件撑大上下文，结果代理模型不调工具，压缩根本没触发，数据作废）。测试项目 `.sc-test/.pi/settings.json` 设 `compaction.reserveTokens: 45000`（100K 窗模型 → 阈值 55K），命中口径统一为 `cacheRead/(input+cacheRead+cacheWrite)`。环境：pi 0.85.1、node 24.16.0、npm 12.0.2、本地代理 `http://localhost:20128/v1`（provider id `1`/model id `1`）、`PI_CACHE_RETENTION=long`。

**结论先行：稳态命中与压缩后首轮命中都符合前缀缓存定义（18.0%→80.9% 单调爬升，压缩后首轮 6.7% 恒定），唯一能修的是压缩调用自身——`pi-compaction-cache` 把它从 1.6% 拉到 98.8%。**

同一台机器、同一驱动、只改一个变量的四组对照：

| 组 | 压缩由谁接管 | 压缩调用 `input` | 压缩调用 `cacheRead` | **压缩调用自身命中** | 压缩后首轮 | 再下一轮 |
|---|---|---|---|---|---|---|
| C0 基线（`PI_COMPACTION_CACHE=0`） | smart-context same-model | **68,350** | 1,140 | **1.6%** | 33,793 / 2,425 = 6.7% | 76.7% |
| C1 `scope:"full"` | **pi-compaction-cache** | **309** | 46,462 | **99.3%** | 33,869 / 2,441 = 6.7% | 76.7% |
| C2 `scope:"boundary"`（默认） | **pi-compaction-cache** | **309** | 24,496 | **98.8%** | 33,756 / 2,425 = 6.7% | 76.7% |
| C3 定稿（boundary + debug 关） | **pi-compaction-cache** | **309** | 24,498 | **98.8%** | 33,663 / 2,425 = 6.7% | 76.6% |

压缩前的稳态曲线（四组一致）：**18.0% → 55.0% → 68.9% → 76.4% → 80.9%**（每轮新增 48KB 用户消息，前缀命中率随缓存前缀增长而爬升）。压缩后首轮恒为 **6.7%**、`cacheRead` 恒为 **2,425**——那 2.4K 就是 system+tools 固定前缀，后面全是新写的 summary 与保留区消息，**与压缩方式无关，四个扩展都救不回来，也不是故障**；下一轮立刻回到 76.6%–76.7%。

**C1 vs C2 为什么选 boundary（默认）**：命中 99.3% vs 98.8% 差距微弱，但 boundary 只发到摘要边界为止（`sent_messages:6` vs `10`，日志可见），符合 Pi 自己的 `keepRecentTokens` 保留区语义，多发那 4 条是纯浪费。定稿 `~/.pi/agent/compaction-cache.json`：
```json
{ "models": ["1", "1/1"], "scope": "boundary", "logPath": "C:/Users/yxh/.pi/agent/logs/compaction-cache.log", "debug": false }
```

**`models` matcher 是必填项（本机踩过）**：包内 `inputTokensAreFree(model)` 要求 `model.cost.input === 0 && model.cost.cacheRead === 0`，而本机模型**没有 cost 元数据** → 不配 matcher 就走 zero-cost heuristic 直接 decline（日志 `has no cost metadata and no models matcher is configured`），接管永远轮不到它。配 `["1","1/1"]` 后走 `models matcher (1)` 分支，**实测命中率从 1.6% 变 98.8%**。日志 `logPath` 里 `{"compacted":true,…,"summary_chars":2580}` 即接管成功。

**与 smart-context 的竞合（安装顺序即胜负）**：两个包都接 `session_before_compact`，**靠后加载者先给摘要**。C0 里 smart-context 的 same-model 接管先给摘要 → 压缩调用退化成 68,350 全量重发（1.6%），这正是 smart-context 已知的"压缩调用无缓存命中"问题；C1–C3 里 compaction-cache 排在 smart-context 之后拿到接管权（`fromExtension:true`），命中 98.8%——**换句话说，装上 compaction-cache 并排对顺序，顺手解掉了 smart-context 那条已知缺陷**。反例：让 compaction-cache 排在 smart-context 之前，命中会退回 1.6%。

**对上表 2026-09-27 那两个读数的说明**：C0 这次 same-model 压缩调用只拿到 1.6%，而旧表记的是 20.6% / 47.6%——**同一种接管方式，两次差 10 倍以上**，因为它发的是「全量上下文 + 原 system prompt + 末尾压缩指令」，能不能命中全看那一刻整段历史有多少已经在缓存里，**它不保证命中**。compaction-cache 的做法是把请求**切到摘要边界**再拼指令，边界之前那一段必然与上一轮请求逐字节相同，才有 98.8% 这种可复现的数字。

**它也会主动让路（不是每次都接管）**，日志可判读 `skip:` 开头的原因：`skip:"nothing-to-summarize"`（`messagesToSummarize` 为空，pi 0.85.1 的已知 bug，smart-context 同样中招）、`skip:"cannot-preserve-prefix", boundary:N`（边界之后找不到无 tool_calls 的完整 assistant，切不出安全切点）、`skip:"applicability:…"`（模型不匹配，多半又是 `models` 漏配）、`skip:"no-live-request"`（没捕到活的 provider 请求）。让路时回落到 smart-context / 原生压缩，行为退化但不报错。

**别把 `prompt_drift_check` 当失败信号**：它每次会话只跑一次，纯粹是诊断——比对包内复制的 pi 摘要提示词与 `process.argv[1]` 指向的 pi bundle 是否还一致，只有结果为 `"DRIFTED"` 才 `ui.notify` 告警（含义是「该升级 compaction-cache 了，摘要格式可能变了」）。`"unverifiable"` = 比不了而已（`findBundleDir(process.argv[1])` 拿不到 bundle，`pi --mode rpc` 下 `argv[1]` 根本不是 pi 入口），**C1–C3 三次成功接管前它都记的是 `unverifiable`，与成败无关**。

**`pi-prefix-stabilizer` 在本机只剩半条命（诚实标注）**：日志 `{"first_rewrite":true,"replacements":1,"roots":[]}`——`replacements:1` 来自 **tools 数组按名排序**，`roots:[]` 说明**路径改写一次都没发生**。原因有两条，任一条都足以让它在 Windows 上失效：① 本机 pi 是 `D:\agent\pi-windows-x64` 下的独立二进制，提示词里根本没有默认后缀 `node_modules/@earendil-works/pi-coding-agent`（探针实测 system prompt 4061 字符、`suffixHit=false`，只含 `D:\agent\pi-windows-x64\{README.md,docs,examples}` 与 cwd）；② 包内 `normalisePaths` 要求 `candidate.startsWith("/")` 且该路径真实存在，`D:\…` 永不符合。**结论：不要试图把 `packagePathSuffix` 改成 Windows 路径，原理上不生效。** 实际收益 = tools 顺序确定化 + 会话中途 system 文本 sha1 漂移告警（8 轮长会话实测无 `drift` 记录，即前缀字节稳定）。它与 `pi-cache-guardian` 互补不冲突：guardian 管 system 文本字节级冻结（`before_agent_start`），stabilizer 管发往 provider 那一份 payload 的顺序与漂移告警。

**`pi-warm-cache` 本机不生效（不是故障）**：`resolveStrategy` 判 `capability.state !== "verified"` → `intervalMs: null, automaticWarm: false`，源码注释写明 *an unverified route never arms a timer*。本机模型是本地代理（`openai-completions` + localhost baseUrl），不在已注册路由表（Anthropic/OpenAI/Azure/Codex/xAI 4.5+/OpenCode Go/OpenRouter）内，**永不装定时器、一次请求都不额外发**。换 provider 即自动启用，`/warm status` 可查。不注册也**不报错**，属纯静默待命。

**footer 槽位：`pi-one-ui` 主动让位（唯一干净解）**：`ctx.ui.setFooter` 是**单槽、后写者胜**，`pi-one-ui`（第 3 位加载）与 `pi-footer-template`（第 18 位）抢同一个槽。解法不是抢，而是让 one-ui 自己退出：其 `reconcile()` 里 `case "native": this.uninstall(ctx)`，注释明写 *leaving third-party ownership untouched*（不抢也不擦别人的），而 `installedKind === "starship" && ownsStatusLine(ctx)` 的早退又保证它不会在会话中途回头抢。本机 `~/.pi/agent/pi-one-ui.json`：
```json
{ "components": { "footer": { "style": "native" } } }
```
Header / Context / WorkingLine / Editor 各层照旧，footer 归 `pi-footer-template`。回滚：删掉该文件即恢复 Starship footer（config 走 `components.footer.style` → `normalizeFooter`，只认 `native`/`hidden`/其它默认 `starship`）。默认模板已含 `CH{latestCacheHitRate}%`，口径 = **最后一条 assistant** 的 `cacheRead/(input+cacheRead+cacheWrite)`，与本节各表「命中」列完全同源（`computeSessionUsage` 遍历 `getEntries()` 顺带累加 compaction 条目用量）。⚠ footer 只能目视验收：RPC 模式无 TUI，本条**尚未经界面目视确认**，下次开 TUI 请看一眼底栏 CH% 是否随命中率变动。

## lazy-tools 执行层修复（2026-09-22）

**现象**：`load_tools` 激活成功（注入 description/schema），但 `call_tool` 报「无法从 ...\@tian.zuo\pi-find\index.ts 加载工具 grep 的执行定义」。实测非 pi-find 特有——所有 npm 安装的 `.ts` 扩展全中招。

**根因**：lazy-tools 的 `requireFn` 用 Node 原生 `createRequire` 二次加载目标扩展。Node ≥23.6 的 type stripping **明确拒绝 node_modules 下 .ts**（实测报错 `Stripping types is currently unsupported for files under node_modules`），且原生 require 转 CJS 后 `import.meta` 不可用。lazy-tools 绕开了 pi 的官方 TS 加载管线。

**修复**：换 pi 同款加载器 **jiti**（`docs/extensions.md`：Extensions are loaded via jiti；`jiti@2.7.0` 已在依赖树，未声明但可从 node_modules 根解析）。三处改动（`npm/node_modules/@wolido/pi-lazy-tools/lazy-tools.ts`，备份 `lazy-tools.ts.bak`）：

```diff
- import { createRequire } from "node:module";
+ import { createJiti } from "jiti";
- const requireFn = typeof require !== "undefined" ? require : createRequire(import.meta.url);
+ const requireFn = createJiti(import.meta.url);
- const mod = requireFn(sourcePath);                      // 同步原生 require
- const factory = mod?.default ?? mod;
+ const factory = await requireFn.import(sourcePath.replaceAll("\\", "/"), { default: true });
```

要点：`jiti.import()` 按 ESM 语义转译（`import.meta` 可用），`default: true` 直接取 default 导出；`sourceInfo.path` 为 Windows 反斜杠绝对路径，转正斜杠后 jiti 才能正确 resolve。

**验证**：独立 probe 用真实 `C:\Users\...\@tian.zuo\pi-find\index.ts` 反斜杠路径重放 factory → `REPLAY OK: grep,find`，execute 就位。

**执行约定**：
1. **生效需 `/reload` 或重启 pi**：扩展工厂闭包在会话启动时冻结，本会话内 `call_tool` 仍走旧加载器。
2. **补丁已版本化（2026-09-23 起）**：jiti 修复并入 fork `git:github.com/qq458249269/pi-lazy-tools`（commit `b2a7d75`）随 `pi install` 更新保留；npm 源与 `lazy-tools.ts.bak` 手工补丁流程作废。
3. 修复后缓存实验对齐基线：激活注入（grep schema ~180 token）对前缀命中约零影响（对照 T1 消息 14 注入 7,084 token → 单轮 44%、下轮即恢复 96%+），看累计值而非单轮。

## pi-agent-browser-native 兼容补丁（2026-09-28）

**现象**：会话启动与 `/reload` 必报 `ctx.sessionManager.buildSessionProjection is not a function`（扩展 `session_start` 里抛出），其余扩展随后被跳过级联影响观感。

**根因**：`pi-agent-browser-native@0.7.1` 的 `dist/extensions/agent-browser/lib/tool-surface.js` 调 `ctx.sessionManager.buildSessionProjection().messages` 取当前 system 消息里的 `toolsAdded`，而该 API 属 **pi 0.86+**；本机 **pi 0.85.1** 只有 `buildSessionContext()`（`docs/session-format.md`「Instance Methods - Context & Info」，返回 `{messages, thinkingLevel, model}`）。探针 `.sc-test/probe-sessionmanager.js` 实测：`hasBuildSessionProjection: false / hasBuildSessionContext: true`，不猜版本、直接验 API 面。

**处置**：`fix-browser-native-compat.mjs`（本目录）打**双路回退 + try/catch** 补丁——有 `buildSessionProjection` 用新的、没有就退 `buildSessionContext()`、两者皆无或抛错则静默 return（该扩展在浏览器工具未激活时本就不该有副作用）：
```js
let restored = new Set();
try {
  const { getCurrentSystemMessage } = await import("@earendil-works/pi-ai");
  const sm = ctx.sessionManager;
  const messages = typeof sm?.buildSessionProjection === "function"
    ? sm.buildSessionProjection().messages
    : (sm?.buildSessionContext?.().messages ?? []);
  const current = getCurrentSystemMessage(messages);
  restored = new Set(current?.toolsAdded?.map(({ name }) => name));
} catch (error) { return; }
```
脚本**幂等**（已打过则输出 `[skip]`，特征不符则提示人工核对），可直接重跑；`node --check` 通过。

**验证（同一探针对照）**：补丁前 `extension_error` **1** → 补丁后 **0**；全量扩展扫描 `.sc-test/check-ext-errors.mjs --reload` 得 `extension_error 总数: 0`、stderr 命中 0。

> ⚠ **`pi update` / 重装会丢这个补丁**，需重跑 `node fix-browser-native-compat.mjs`。长期解法是等上游适配 0.85.x 或升 pi 到 0.86+。

> 排障教训：`extension_error` 走 **RPC 事件流**、**不出现在子进程 stderr**，只看 stderr 会得到「无错误」的假阴性。扫描扩展错误必须订阅事件流（见 `.sc-test/check-ext-errors.mjs`）。

## 全量重装实录与问题修复（2026-09-23）

**操作**：备份（`settings.json`、`lazy-tools.json`、`skills/` 全量拷入 `.backup-20250915/`）→ 串行 `pi uninstall` 卸全部 14 项（`pi list` 归零、settings `packages: []`）→ 删 2 个 skill → 按本文清单串行重装 13 npm + 1 git → skills 按原 HEAD 重放（`cangjie-skill` `3adf9e6`、`goutoujunshi` `6db7354`，与上轮记录一致）→ `fix-tps-theme.ps1` 幂等 `[skip]` → computer-use helper 重跑 `already up to date`。

**验证通过**：`pi list` 14 项齐（13 npm + 1 git）；`~/.pi/lazy-tools.json` resident 五工具原样（`pi uninstall` 不触碰该文件）；lazy-tools fork HEAD `096ffc9`（含 jiti 修复 `b2a7d75` + `dependencies.jiti` 就位）；项目 `.pi/settings.json` `defaultTools` 五工具原样；npm `allowScripts` 批准记录跨卸载保留；13 npm 首轮全部零失败（无 ENOENT 竞写——串行纪律再次有效）。

**问题 1：`[pi-web-access] Dynamic tool activation requires Pi 0.86.1 or newer` 启动告警（误报，定为不修）**

- 根因：pi-web-access `tool-activation.ts` 的 `supportsDynamicTools()` 用 `import.meta.resolve("@earendil-works/pi-coding-agent")` 就近读 package.json 判版本。解析链从 `~/.pi/agent/npm/node_modules/pi-web-access` 向上，跳过空的 `~/.pi/agent/npm/node_modules/@earendil-works/`（卸载残留空目录），命中**家目录遗留** `~/node_modules/@earendil-works/pi-coding-agent@0.85.1`（`~/package.json` 里旧 `@wolido/pi-lazy-tools@0.3.0` 的 peer 依赖，与 pi 安装无关）→ 判 0.85.1 < 0.86.1 → 告警并回退 web 工具 eager。pi 实为 0.87.1，纯版本探测误报。
- 不修的三个理由：(a) eager 回退下 web 工具仍不在 `resident` 名单，照常被 pi-lazy-tools 剔除、走 `load_tools` 激活，**最终行为与本机全懒策略一致**；(b) 反而注册 `web_enable` 第二 loader，其 `selectFromSession` 会主动把 web 工具塞回 active 集，与 lazy-tools 的剔除正面打架（双激活管理器冲突）；(c) 删家目录残留无效——`import.meta.resolve` 抛错走 `catch → false`，同样告警，且 `~/package.json` 是用户自己的 npm 项目不宜动。
- 实际损失：仅 `web_enable` loader 不注册（本机不用它，统一走 `load_tools`），告警行每次启动打印一次，无功能影响。

**问题 2：`npm install-scripts approve better-sqlite3` 报 `ENOMATCH`（步骤过时，已从流程剔除）**

- 根因：pi-subagents@0.71.0 / pi-mcp-adapter@2.37.0 / pi-agent-browser-native@0.7.1 新版**已移除 `better-sqlite3` 依赖**（三包 `package.json` grep 无此依赖，`node_modules` 无此目录，`npm ls better-sqlite3` 空），依赖树里没有可批准的包。上轮记录的「共享原生依赖批准」流程基于旧版本。
- 处置：安装后操作中的 better-sqlite3 批准段已标作废（见上），清单 B 三行的 ⚠ 依赖声明同步划掉；`allowScripts` 残留条目无害不清理。`approve @injaneity/pi-computer-use` 报 `Nothing to approve` 属正常（批准记录已存在且跨卸载保留，`pi install` 不清除），此后仅需手动重跑 `node scripts/setup-helper.mjs --postinstall` 确认 helper 就位。
