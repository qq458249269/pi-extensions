# Pi Extensions 安装清单

本手册汇总一套推荐的 Pi 扩展安装方案，按「缓存与节省优先，编程增强次之」的原则组织。扩展统一安装在 Pi 配置根 `~/.pi/agent`（Windows 下为 `%USERPROFILE%\.pi\agent`），以下路径均以此计。

> 按需工具加载由 `@wolido/pi-lazy-tools` 承担（前身 `@wolido/pi-tool-search` 已下架，2026-09-22 回归 lazy-tools 命名）：低频工具列入 lazy 名单后从 LLM 可见 active 集剔除，需要时 `load_tools` 纯文本注入用法、`call_tool` 代理执行，与其它扩展不冲突。
>
> 本轮（2026-09-17）新增 4 个扩展，全部**零工具注入**（无 `registerTool`/`setActiveTools`），只挂事件钩子，不增加首请求 token、不与 `@wolido/pi-lazy-tools` 懒加载冲突。
>
> 本轮（2026-09-21）再增 5 个扩展：`pi-undo-redo`（会话/文件撤销重做）、`pi-hermes-memory`（持久记忆 + 会话检索 + 密钥扫描）、`pi-subagents`（子智能体委托）、`pi-mcp-adapter`（MCP 适配）、`pi-agent-browser-native`（原生浏览器工具）。注册的 10 个工具一律列入 lazy 名单（见[工具归属](#工具归属)），不增首请求注入量。
>
> 本轮（2026-09-22）换装：`@wolido/pi-tool-search` 已从 npm 下架 → 由**同作者的 `@wolido/pi-lazy-tools@0.3.1` 承接**（配置 `lazy-tools.json`、常驻 `load_tools`/`call_tool`、两步确认门全部同款，新增 call_tool 的 JSON Schema 预校验 + factory 重放真实 execute）；**移除 `alps-pi`**（TUI 美化）→ **加入 `pi-one-ui@0.7.1`**（统一 TUI 包，功能覆盖 alps-pi 并扩展，见下方清单 B）。**移除 `pi-hermes-memory`**（持久记忆，不再使用，其 6 个工具从 lazy 名单与工具归属中同步剔除）。清单现 13 个。
>
> 本轮（2026-09-22 二轮，策略回调）：自带五个工具（`read`/`write`/`edit`/`bash`/`powershell`）恢复**默认常驻 active 集**（项目 `.pi/settings.json` 显式 `defaultTools`，Windows 下同含 bash/powershell 双 shell）；`edit` 从 lazy 名单移除（归核心五工具，同名覆盖内建行为保留）；`grep`/`find`（@tian.zuo/pi-find）等其余扩展工具**仍全量懒加载**。active 集回到 7（五工具 + `load_tools`/`call_tool`），写代码主链路零 `load_tools` 往返。

> 本轮（2026-09-22 三轮）：新增 **SoL-Pi**（`git:github.com/NVlabs/SoL-Pi`，NVIDIA 开源上下文/token 效率扩展，arXiv 2609.20519），清单 **13 → 14**（13 npm + 1 git）。四机制全 opt-in 默认关（`sol-pi.json` 配置，见[清单 A](#a-核心层先装)）：**Action Fusion** 同名覆盖内建 `edit`/`write` 追加 `then_run` 参数（同一次工具调用完成编辑 + 校验命令，省一轮往返）；**ObservationPack** 大文本结果转稳定句柄 + 分页回放（注册 `obs_recall`）；**Evidence-Preserving Reducer** 长诊断日志转紧凑收据（无工具）；**Online Context Compact** 完成的计划步骤成原生压缩候选点（注册 `update_plan`）。`obs_recall`/`update_plan` 补入 lazy 名单；`edit`/`write` 同名覆盖归核心常驻（与 pi-edit-guard 之于 `edit`、pi-one-ui 之于 `write` 同类）。**维护机已启用保守两机制**（actionFusion + observationPack，`~/.pi/agent/sol-pi.json`，见[安装后操作 10](#安装后操作)）。

## 推荐清单（14 个，始终最新）

### A. 核心层（先装）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `@wolido/pi-lazy-tools` | `npm:@wolido/pi-lazy-tools` | **核心**。低频工具懒加载（**2026-09-22 起替代已下架的 `@wolido/pi-tool-search`，配置/工具名/两步确认门完全同款**）：会话启动把 `lazy-tools.json` 名单工具从 LLM 可见 active 集剔除，需要时 `load_tools` 以纯文本注入描述/参数 schema（两步确认门：先挑战文本 `confirm:false` 零副作用、用户主动要求后 `confirm:true` 激活）、`call_tool` 代理执行——相对 tool-search 加强：JSON Schema 预校验（type/required/enum/pattern/properties 等子集，不合法不触碰目标 execute）+ factory 重放捕获真实 `execute`（按 `sourcePath#name` memoize，每会话只重放一次）。**不触碰 `tools` 字段与系统提示词**，无缓存失效，任意模型通用。**关键：`--tools` 白名单必须保留 lazy 工具**（注册与隐藏是两件事） |
| `pi-cache-guardian` | `npm:pi-cache-guardian` | **缓存守护（防 autocompact 后命中率归零）**。首轮完整链处理后将 system prompt 捕获为 **golden 副本**，之后每轮无条件恢复——字节级一致保证前缀缓存不因 autocompact 重建 system prompt 而整体失效；叠加 prompt reorder（稳定内容前置）、skill 压缩（>4 个 skill 时 4 行 XML 压缩为单行索引）、`<session-overview>` 变化字段剥离（RECENT COMMITS/目录状态/行数），并自动设 `PI_CACHE_RETENTION=long`。自动兼容检测：OpenAI 400 时剥离 `prompt_cache_retention`、Anthropic 400 时降级 `cache_control` TTL、OpenAI 兼容端点注入 `prompt_cache_key`。**不注入任何工具**（无 `setActiveTools`），与 `@wolido/pi-lazy-tools` 懒加载不冲突。命令：`/cache-guardimizer`（npm README 里的 `/cache-guardian` 为旧名）查看每轮 `cacheRead`/`cacheWrite` 统计。可选：`PI_CACHE_GUARD=1` 时会话结束命中率 < `PI_CACHE_GUARD_THRESHOLD`（默认 90）报警 |
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget + **运行状态指示**（回合运行中 TUI 底部状态栏实时 spinner、实时 TPS、Waterfall 瀑布图，回合结束弹整回合统计摘要）。配置：`/pi-tps`（`showTraces`/`showStats`/`showTtft`/颜色）。**必须配主题**：装好后 `colorPreset` 默认 `mono`，运行 `fix-tps-theme.ps1`（幂等：同时把 `pi-tps.json` 设为 `theme`、`settings.json` 的 `theme` 设为 `light/dark` 跟随系统）或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |
| `SoL-Pi` | `git:github.com/NVlabs/SoL-Pi` | **NVIDIA 开源的上下文/token 效率四机制**（arXiv 2609.20519，`pi-package` 关键字，import 公共 Pi API 不 patch Pi）。**全部 opt-in 默认关闭**，无配置即全禁：**Action Fusion**——同名覆盖内建 `edit`/`write` 追加 `then_run` 参数（收尾校验命令在同一工具调用里跑完，命中时省 1 轮模型往返）；**ObservationPack**——重复大文本结果转稳定句柄 + 精确分页回放（注册 `obs_recall`）；**Evidence-Preserving Reducer**——长诊断日志转紧凑收据，逐条校验引用与存档源一致、失败保留原文（无工具；可经 Pi 托管认证外发 reducer 模型，⚠ 见 SECURITY.md）；**Online Context Compact**——完成的计划步骤成候选点，经济性/窗口压力检查后触发 Pi 原生压缩并继续任务（注册 `update_plan`）。配置：`sol-pi.json`（项目 `.pi/sol-pi.json` 优先 → `~/.pi/agent/sol-pi.json`，不合并），保守示例只开两个零额外模型调用的本地机制：`{"version":1,"actionFusion":true,"observationPack":true,"evidencePreservingReducer":false,"onlineContextCompact":false,"cacheWriteReadRatio":12.5}`；模板见 `sol-pi.example.json`。存档存 `<session-directory>/sol-pi/<session-id>/`。⚠ 同名覆盖 `edit`/`write` 与 pi-edit-guard（`edit`）、pi-one-ui（`write`）叠加；要求 Node >=22.19（本机 24.16.0 ✓）、测试基线 @earendil-works/pi-coding-agent 0.85.1 |

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
| `pi-subagents` | `npm:pi-subagents` | **子智能体委托**：Pi 作为父会话派发聚焦子会话（前台子会话在父进程内流式返回，后台子会话跑在分离 Node runner 里可稍后取结果），内置 agent：`scout`（代码侦察）、`reviewer`（评审）、`oracle`（第二意见）、`researcher`（需子会话有 `pi-web-access`）等，可并行评审、保存工作流、后台作业。注册 `subagent`（主委托工具，`bg_wait` 为参数非独立工具）与 `contact_supervisor`（子会话联络父会话）。⚠ 依赖 `better-sqlite3`（同上，装一次批准即可） |
| `pi-mcp-adapter` | `npm:pi-mcp-adapter` | **MCP 适配（免上下文爆炸）**：一个 `mcp` 代理工具（~200 token）替代数百个 MCP 工具定义，按需发现、服务器首次使用时才启动。自动读 `.mcp.json`/`~/.config/mcp/mcp.json`（及 `~/.agents/mcp.json` 等兼容路径）；`/mcp setup` 从 Cursor/Claude Code/Codex 等宿主配置导入、`/mcp disable|enable` 开关服务器。Pi 专用覆盖写 `~/.pi/agent/mcp.json`/.pi 项目层，不改写源文件、不复制凭证。⚠ 依赖 `better-sqlite3`（同上） |
| `pi-agent-browser-native` | `npm:pi-agent-browser-native` | **原生浏览器自动化**：agent-browser CLI 封装为原生 `agent_browser` 工具（替代脆弱的 shell 命令拼装）：打开页面、交互式快照（`@eN` 引用可继续点击/填表）、截图与下载文件以 Pi artifact 呈现、持久 profile 支持登录态、溢出大输出写 spill 文件防爆上下文、结构化 details（标题/URL/已存文件/会话/错误）。⚠ 依赖 `better-sqlite3`（同上） |

## Skills（可选，非扩展，Agent Skills 标准）

> **与扩展不同：skill 不经 `pi install`，是目录粒放到 `~/.pi/agent/skills/`**（pi 按 Agent Skills 标准递归发现含 SKILL.md 的目录）。skill **不注册任何工具**，不进 lazy 名单、不增 active 工具数；系统提示词仅常驻 name + description（渐进式披露），全文与 references 按需 `read` 加载。存入即生效（新会话 / `/reload`）。

| Skill | 来源 | 作用 | 上下文开销 |
|---|---|---|---|
| `goutoujunshi`（狗头军师） | `git clone github.com/shengjidaguai-china/goutoujunshi`（2026-10-21 安装，HEAD `6db7354`） | 恋爱军师与情绪支持：心动/暧昧/追求/聊天记录或截图分析/多人选择/冲突/分手复合（Codex 社区标准 SKILL.md，pi 兼容，description 692 字符 < 1024 上限）。本地 sqlite 长期记忆（`scripts/memory_store.py`，仅标准库，按需召回压缩摘要，不存整份聊天） | 常驻仅 description ≈ 0.7k token；启用时 SKILL.md 9.4KB ≈ 5k token + 按需 1–3 份 references（每份 2–8k） |

```bash
# 安装（示例源在 /tmp，实际自 git clone）：
mkdir -p ~/.pi/agent/skills/goutoujunshi
cp -r <repo>/SKILL.md <repo>/references <repo>/scripts ~/.pi/agent/skills/goutoujunshi/
```

自查：目录含 `SKILL.md`（frontmatter `name` + 非空 `description`）即被发现；`pi list` 不显示 skill。使用：`/skill:goutoujunshi` 或直接描述任务让模型按 description 自动加载。

## 安装与配置

> **本轮（2026-09-22）实测环境**：Pi 0.87.0、npm 12.0.2（注意 README 中 `npm install-scripts approve` 属 npm 12 子命令；旧 `allowScripts` 字段引用了已卸载包的旧版本号，`npm install-scripts approve` 报 `Nothing to approve` 不重跑已批脚本 → 改用 `npm rebuild better-sqlite3` 重建原生依赖成功，`prebuilds/win32-x64.node` 平台 prebuilt 亦可用；computer-use 的 `setup-helper.mjs --postinstall` 手动重跑输出 `[pi-computer-use] Windows helper already up to date` 即就位）。

> **警：逐条串行安装，勿并行。** 多进程 `pi install` 会竞写 `~/.pi/agent/settings.json` 丢注册（实测 17 项仅剩 5 项留存），且并发操作同一 `~/.pi/agent/npm` 目录会触发 `ENOENT: Cannot cd into .../node_modules/<pkg>`（实测 `typebox`）。
>
> `pi install` 一次只接受单个 source，故直接串行跑循环：

```bash
for p in @wolido/pi-lazy-tools pi-cache-guardian pi-tps pi-one-ui \
         pi-web-access @injaneity/pi-computer-use @tian.zuo/pi-find \
         pi-edit-guard @trycedar/pi-mdiff pi-undo-redo \
         pi-subagents pi-mcp-adapter pi-agent-browser-native; do
  pi install "npm:$p" || echo "[失败] $p"
done
```

> SoL-Pi 为 git 源，无法并入 npm 循环，单独装（清单第 14 个）：

```bash
pi install git:github.com/NVlabs/SoL-Pi
```

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

> ⚠ `pi-subagents`/`pi-mcp-adapter`/`pi-agent-browser-native` 共享原生依赖 `better-sqlite3`（`install: node-gyp rebuild`），会被 allowScripts 默认拦截。装完一次性批准（多扩展共用同一包，批一次即可；有 prebuilt 二进制时无需 rebuild 也能用）：
>
> ```bash
> cd "%USERPROFILE%\.pi\agent\npm" && npm install-scripts approve better-sqlite3
> ```

装完自查（`pi list`，不并行）：应见 **14 个扩展**——13 个 npm（`pi-web-access`、`@wolido/pi-lazy-tools`、`pi-tps`、`@injaneity/pi-computer-use`、`pi-one-ui`、`pi-cache-guardian`、`@tian.zuo/pi-find`、`pi-edit-guard`、`@trycedar/pi-mdiff`、`pi-undo-redo`、`pi-subagents`、`pi-mcp-adapter`、`pi-agent-browser-native`）+ 1 个 git（`git:github.com/NVlabs/SoL-Pi`）。若少于 14（并行竞写伤痕），重跑上述循环补漏。

@wolido/pi-lazy-tools 配置（写入 `~/.pi/lazy-tools.json`，用户级；`<cwd>/.pi/lazy-tools.json` 项目级整体覆盖用户级）。**2026-09-22 起执行默认五工具常驻策略**：自带五个工具（`read`/`write`/`edit`/`bash`/`powershell`，由项目 `.pi/settings.json` 的 `defaultTools` 显式声明）与 `load_tools`/`call_tool` 常驻 active 集，其余扩展工具全部列入 lazy 名单，见下方[全量懒加载策略](#全量懒加载策略)：


```json
{ "lazy": ["deploy_tool", "undo", "md_inspect", "md_diff", "md_edit", "grep", "find", "web_search", "source_check", "fetch_content", "get_search_content", "observe_ui", "search_ui", "expand_ui", "inspect_ui", "act_ui", "read_text", "wait_for", "find_roots", "launch_browser", "navigate_browser", "evaluate_browser", "subagent", "contact_supervisor", "mcp", "agent_browser", "obs_recall", "update_plan"] }
```


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
> **2026-09-21 追加 5 个扩展后基线仍不变**：`pi-undo-redo` 零工具注入；`pi-hermes-memory`（6 工具，**2026-09-22 已卸载**）/`pi-subagents`（`subagent`、`contact_supervisor`）/`pi-mcp-adapter`（`mcp`）/`pi-agent-browser-native`（`agent_browser`）共 10 个工具**全部列入 lazy 名单**，从 active 集剔除，`activeTools` 仍 7，不增首请求注入量。
>
> **2026-09-22（二轮）策略回调后基线不变**：自带五工具（`read`/`write`/`edit`/`bash`/`powershell`）经 `.pi/settings.json` 的 `defaultTools` 显式常驻，`edit` 移出 lazy 名单；`grep`/`find` 等扩展工具仍懒加载。`activeTools` 仍 7，首请求注入量不变。

## 安装后操作

### 一键配置脚本（幂等，可重复执行）

| 脚本 | 用途 |
|---|---|
| `fix-tps-theme.ps1` | `pi-tps` 颜色跟随系统主题（`theme` -> `light/dark`，`colorPreset` -> `theme`） |

```bash
powershell -ExecutionPolicy Bypass -File fix-tps-theme.ps1
```

脚本为 UTF-8 BOM 保存，PowerShell 5.1 / 7 均可正确解析中文；已存在配置时自动 `[skip]`，不会覆盖你改过的值。

1. **重启 Pi** 使扩展生效。
2. 新会话里对主智能体说「激活 X」：`load_tools` 先返回挑战文本（`confirm:false` 零副作用），用户点名确认后 `confirm:true` 激活、`call_tool` 调用。**自带五工具（`read`/`write`/`edit`/`bash`/`powershell`）默认常驻，无需激活**；扩展工具（`grep`/`find`/网页/UI/子代理）才需激活。启动时 `ctx.ui.notify` 打印当前 lazy 名单与配置文件路径。
3. `pi-tps`：运行 `fix-tps-theme.ps1` 让颜色跟随系统主题。`pi-one-ui`：`/oneui` 打开设置面板、`/context` 查看上下文、`/theme` 切换内置主题（`cc-dark`/`cc-light`）；配置存 `~/.pi/agent/pi-one-ui.json`，`/reload` 后 Features 生效（组件开关即时生效）。`@injaneity/pi-computer-use`：先完成上面的 postinstall 批准与 helper 重跑，首次运行时再授予平台权限。
4. `pi-cache-guardian`：装上即用（golden freeze + `PI_CACHE_RETENTION=long` 自动生效），`/cache-guardimizer` 查看每轮缓存统计；可选开启会话结束命中率报警：`PI_CACHE_GUARD=1`（阈值 `PI_CACHE_GUARD_THRESHOLD`，默认 90）。autocompact 后是新 session，会重新捕获 golden，无需干预。
5. **`pi-edit-guard`**：装上即用，**同名接管内建 `edit`**（无需改 lazy 名单）。需要 `undo` 时将其列入 `lazy-tools.json` 的 `lazy` 数组即可按需加载。⚠ 若启动报 node 版本相关错误，需将 Node 升到 `>=24.18.0`（本机 24.16.0 实测仅安装告警、运行正常）。
6. **`@trycedar/pi-mdiff`**：装上即用，编辑 `.md` 时把 `md_inspect`/`md_diff`/`md_edit` 列入 lazy 名单后按需加载。**旧包名 `pi-mdiff` 已弃用，务必用 `npm:@trycedar/pi-mdiff`**（bare 名会触发弃用告警甚至 ECONNRESET 失败）。
7. **`pi-undo-redo`**：装上即用，纯命令扩展（`/undo`、`/redo`、`/undo-cleanup`），默认存储 `~/.pi/agent/state/pi-undo-redo`，无需配置。可选调整 settings.json 的 `undoRedo`（`storageDir`/`largeFileLimitBytes`）。git 仓库自动走影子 git 快照，非 git 目录只覆盖 `write`/`edit` 显式路径。
7. **`pi-subagents`**：装上即用。主智能体直接说「用 reviewer 评审这段 diff」「问 oracle 第二意见」即可触发 `subagent` 工具；无需预建 agent 配置。后台子会话跑在分离 runner，可用 `contact_supervisor` 联络。
8. **`pi-mcp-adapter`**：装上重启后自动读 `.mcp.json`/`~/.config/mcp/mcp.json`；无配置时 `/mcp setup` 导入宿主配置或脚手架。`mcp` 工具已入 lazy 名单，激活后按需代理调用 MCP 服务器，服务器首次使用时才启动。
9. **`pi-agent-browser-native`**：装上即用，`agent_browser` 工具已入 lazy 名单，激活后可直接驱动真实浏览器（需本机有 `agent-browser` CLI，首次运行时自动按需启动）。
10. **`SoL-Pi`**：**维护机已启用保守配置**——`~/.pi/agent/sol-pi.json`（全局有效，项目无 `.pi/sol-pi.json` 时生效；项目级优先且不合并），内容如下（仅开两个零额外模型调用的本地机制）：

    ```json
    {
      "version": 1,
      "actionFusion": true,
      "observationPack": true,
      "evidencePreservingReducer": false,
      "onlineContextCompact": false,
      "cacheWriteReadRatio": 12.5
    }
    ```

    ⚠ 全开配置按 `agents-install.md` 协议 + `scripts/check-sol-pi-config.mjs --require-all-enabled` 校验；模板见 `sol-pi.example.json`。`obs_recall` 已随 observationPack 注册（在 lazy 名单，`load_tools` 激活即用）；`update_plan` 属 onlineContextCompact，未开启不注册。**改配置后新会话生效**。

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
| pi-subagents | `subagent`、`contact_supervisor` | ✓ |
| pi-mcp-adapter | `mcp` | ✓ |
| pi-agent-browser-native | `agent_browser` | ✓ |
| SoL-Pi | `edit`、`write`（同名覆盖加 `then_run`） | ✗ 同名替换，归核心常驻 |
| SoL-Pi | `obs_recall`、`update_plan` | ✓ |
| pi-undo-redo | （无工具，仅 `/undo` `/redo` `/undo-cleanup` 命令） | — |
| @wolido/pi-lazy-tools | `load_tools`、`call_tool` | ✗ 承载者，常驻 |
| pi-one-ui | （无新工具名；**同名覆盖内建 `write`**，如 edit-guard 之于 `edit`） | ✗ 同名替换，归核心 |
| 用户自定义 | `deploy_tool` | ✓ |

### 执行纪律

1. **安装任何新扩展 → 其注册工具名补进 `~/.pi/lazy-tools.json` 的 `lazy` 数组**（同扩展工具可部分 lazy，此处全量）。
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
2. **补丁位于 node_modules，`pi install`/更新包会覆盖**：`lazy-tools.ts.bak` 可回滚；建议上报上游 `@wolido/pi-lazy-tools` 或 fork 到 `~/.pi/agent/extensions/` 自定义路径防覆盖。
3. 修复后缓存实验对齐基线：激活注入（grep schema ~180 token）对前缀命中约零影响（对照 T1 消息 14 注入 7,084 token → 单轮 44%、下轮即恢复 96%+），看累计值而非单轮。
