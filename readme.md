# Pi Extensions 安装清单

本手册汇总一套推荐的 Pi 扩展安装方案，按「缓存与节省优先，编程增强次之」的原则组织。扩展统一安装在 Pi 配置根 `~/.pi/agent`（Windows 下为 `%USERPROFILE%\.pi\agent`），以下路径均以此计。

> 按需工具加载由 `@wolido/pi-lazy-tools` 承担：低频工具列入 lazy 名单后从 LLM 可见 active 集剔除，需要时 `load_tools` 纯文本注入用法、`call_tool` 代理执行，与其它扩展不冲突。
>
> 本轮（2026-09-17）新增 4 个扩展，全部**零工具注入**（无 `registerTool`/`setActiveTools`），只挂事件钩子，不增加首请求 token、不与 `@wolido/pi-lazy-tools` 懒加载冲突。

## 推荐清单（9 个，始终最新）

### A. 核心层（先装）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `@wolido/pi-lazy-tools` | `npm:@wolido/pi-lazy-tools` | **核心**。低频工具懒加载：会话启动把 `lazy-tools.json` 名单工具从 LLM 可见 active 集剔除，需要时 `load_tools` 以纯文本注入描述/参数 schema（两步确认门：先挑战文本 `confirm:false` 零副作用、用户主动要求后 `confirm:true` 激活）、`call_tool` 代理执行目标扩展的 `execute`。**不触碰 `tools` 字段与系统提示词**，无缓存失效，任意模型通用。**关键：`--tools` 白名单必须保留 lazy 工具**（注册与隐藏是两件事） |
| `pi-cache-guardian` | `npm:pi-cache-guardian` | **缓存守护（防 autocompact 后命中率归零）**。首轮完整链处理后将 system prompt 捕获为 **golden 副本**，之后每轮无条件恢复——字节级一致保证前缀缓存不因 autocompact 重建 system prompt 而整体失效；叠加 prompt reorder（稳定内容前置）、skill 压缩（>4 个 skill 时 4 行 XML 压缩为单行索引）、`<session-overview>` 变化字段剥离（RECENT COMMITS/目录状态/行数），并自动设 `PI_CACHE_RETENTION=long`。自动兼容检测：OpenAI 400 时剥离 `prompt_cache_retention`、Anthropic 400 时降级 `cache_control` TTL、OpenAI 兼容端点注入 `prompt_cache_key`。**不注入任何工具**（无 `setActiveTools`），与 `@wolido/pi-lazy-tools` 懒加载不冲突。命令：`/cache-guardimizer`（npm README 里的 `/cache-guardian` 为旧名）查看每轮 `cacheRead`/`cacheWrite` 统计。可选：`PI_CACHE_GUARD=1` 时会话结束命中率 < `PI_CACHE_GUARD_THRESHOLD`（默认 90）报警 |
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget + **运行状态指示**（回合运行中 TUI 底部状态栏实时 spinner、实时 TPS、Waterfall 瀑布图，回合结束弹整回合统计摘要）。配置：`/pi-tps`（`showTraces`/`showStats`/`showTtft`/颜色）。**必须配主题**：装好后 `colorPreset` 默认 `mono`，运行 `fix-tps-theme.ps1`（幂等：同时把 `pi-tps.json` 设为 `theme`、`settings.json` 的 `theme` 设为 `light/dark` 跟随系统）或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |

### B. 功能增强（其次）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-web-access` | `npm:pi-web-access` | 网页搜索、URL 抓取、GitHub 克隆、PDF/YouTube 理解 |
| `alps-pi` | `npm:alps-pi` | TUI 美化扩展（要求 Pi 0.84.4+）：消息边框线框、输入框美化、内置 Animations 与 `alps` 主题（Synthwave '84 配色）。`/alps-pi` 打开设置界面、`/alps-pi preview` 预览样式；设置写入 settings.json 的 `alps-pi` namespace，`/reload` 或新会话后恢复。**只持久化到 Pi 原生 settings.json，不占工具注入、无 `before_agent_start`，对 token/首请求无影响** |
| `@injaneity/pi-computer-use` | `npm:@injaneity/pi-computer-use` | 观察并控制 macOS/Windows/Linux 桌面应用，**需运行时授予平台权限** |
| `@tian.zuo/pi-find` | `npm:@tian.zuo/pi-find` | **搜索增强**：用 ripgrep/fd 实现 `grep`/`find`，**复用内建工具名**（替换内建而非并列，模型只看到一套搜索面）。有界输出（grep ≤100 命中、find ≤200 文件、行长裁剪、硬字节上限、大文件/超长记录跳过），尊重 `.gitignore` 并跳过 `.git`，支持 `glob`/`!` 排除/`@`与`~` 路径展开。**只注册 `grep`/`find` 两个工具名，不在 lazy 名单即保持常驻 active，不新增工具、不增加注入量** |
| `pi-edit-guard` | `npm:pi-edit-guard` | **编辑强化**：覆盖内建 `edit`（**同名替换**），多层容错匹配（simple → line/whitespace/indentation/escape/unicode 归一化 → block-anchor → fuzzy 等 12+ passes）、匹配唯一性校验、缩进漂移修复、批量感知错误报告。另注册 `undo` 工具（可撤销编辑）。**同名接管内建 `edit` 即生效；`undo` 是否列入 lazy 名单由你定，列入了才被剔除、按需加载，不增首请求注入**。⚠ 声明 `engines.node >=24.18.0`（本机 24.16.0 仅 npm 告警，仍可安装运行） |
| `@trycedar/pi-mdiff` | `npm:@trycedar/pi-mdiff` | **Markdown 编辑**：面向 `.md` 的规范化 SEARCH 匹配 + 块级锚定编辑，注册 `md_inspect`/`md_diff`/`md_edit` 三个工具。**旧包名 `pi-mdiff` 已弃用并迁移到带 scope 的 `@trycedar/pi-mdiff`**。三个工具名可列入 lazy 名单按需加载，**不增首请求注入** |

## 安装与配置

> **警：逐条串行安装，勿并行。** 多进程 `pi install` 会竞写 `~/.pi/agent/settings.json` 丢注册（实测 17 项仅剩 5 项留存），且并发操作同一 `~/.pi/agent/npm` 目录会触发 `ENOENT: Cannot cd into .../node_modules/<pkg>`（实测 `typebox`）。
>
> `pi install` 一次只接受单个 source，故直接串行跑循环：

```bash
for p in @wolido/pi-lazy-tools pi-cache-guardian pi-tps alps-pi \
         pi-web-access @injaneity/pi-computer-use @tian.zuo/pi-find \
         pi-edit-guard @trycedar/pi-mdiff; do
  pi install "npm:$p" || echo "[失败] $p"
done
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

装完自查（`pi list`，不并行）：应见 **9 个 npm 扩展**——`pi-web-access`、`@wolido/pi-lazy-tools`、`pi-tps`、`@injaneity/pi-computer-use`、`alps-pi`、`pi-cache-guardian`、`@tian.zuo/pi-find`、`pi-edit-guard`、`@trycedar/pi-mdiff`。若少于 9（并行竞写伤痕），重跑上述循环补漏。

@wolido/pi-lazy-tools 配置（写入 `~/.pi/lazy-tools.json`，用户级；`<cwd>/.pi/lazy-tools.json` 项目级整体覆盖用户级）。**2026-09-21 起执行全量懒加载策略**：除 `load_tools`/`call_tool` 两个常驻承载工具外，其余全部工具列入 lazy 名单，见下方[全量懒加载策略](#全量懒加载策略)：


```json
{ "lazy": ["deploy_tool", "edit", "undo", "md_inspect", "md_diff", "md_edit", "grep", "find", "web_search", "source_check", "fetch_content", "get_search_content", "observe_ui", "search_ui", "expand_ui", "inspect_ui", "act_ui", "read_text", "wait_for", "find_roots", "launch_browser", "navigate_browser", "evaluate_browser"] }
```


> **全量懒加载策略（2026-09-21 拍板，长期执行）**：所有扩展工具一律列入 lazy 名单，低频不设门槛、默认全懒。理由：首请求上下文只保留 `load_tools`/`call_tool` 承载工具，主动集最小化，注入量与首请求 token 降到最低；各扩展 description/schema 不再常驻上下文，按需 `load_tools` 注入。代价：每次使用多一轮 `load_tools` 往返（含用户点名确认），写入/搜索/网页/UI 类操作均需先激活对应工具。**安装任何新扩展后，把其注册的工具名补进下方 lazy 名单，保证新扩展工具同样默认全懒。** 需查当前已注册工具：`pi list` 或新会话启动 `ctx.ui.notify` 打印的 lazy 名单。
>
> ⚠ 全懒后 `edit`/`grep`/`find` 不再常驻 active 集，写代码前必须先 `load_tools` 激活（两步确认门），确认门只在用户点名要求时通过。`--tools` 白名单必须保留 lazy 工具（注册与隐藏是两件事），当前无 `--tools` 字段、默认全注册，安全。


> 该表为首轮 `session_start` 实测基线（安装 `pi-cache-guardian` 前）。`pi-cache-guardian` 不注入工具，`activeTools` 数不变；system prompt 内容受其 reorder/压缩影响（长度基本持平，压缩仅在 skill>4 时生效），属 `before_agent_start` 阶段内部改写，不影响首请求注入量与基线对比结论。
>
> **2026-09-17 追加 4 个扩展后基线结论不变**：`pi-cache-guardian` 不注入工具；`alps-pi` 纯 TUI 零工具注入（`activeTools` 仍 7，首请求注入量不变）。
>
> `pi-tps` 与 `alps-pi` 是纯 UI/运行时监控扩展，不注册任何 agent 工具，因此**不增加首次请求 token**（相对基线仅 +~150 chars 的 `pi-tps` 策略文字，`alps-pi` 为 0）。其余扩展工具列入 lazy 名单的，需要时 `load_tools` 注入用法，不占首次请求 token。
>
> **2026-09-18 追加 `pi-edit-guard`/`@trycedar/pi-mdiff` 后基线亦不变**：`pi-edit-guard` **同名覆盖** `edit`（属核心 6，不新增激活项），额外 `undo` 为非核心（被隐藏）；`pi-mdiff` 的 `md_inspect`/`md_diff`/`md_edit` 均为非核心（被隐藏）。`activeTools` 仍 7，不增首请求注入量。

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
2. 新会话里对主智能体说「激活 X」：`load_tools` 先返回挑战文本（`confirm:false` 零副作用），用户点名确认后 `confirm:true` 激活、`call_tool` 调用。启动时 `ctx.ui.notify` 打印当前 lazy 名单与配置文件路径。
3. `pi-tps`：运行 `fix-tps-theme.ps1` 让颜色跟随系统主题。`alps-pi`：`/alps-pi` 打开设置、`/alps-pi preview` 预览（设好后 `settings.json` 的 `alps-pi` namespace 会持久化，`/reload` 后仍生效）。`@injaneity/pi-computer-use`：先完成上面的 postinstall 批准与 helper 重跑，首次运行时再授予平台权限。
4. `pi-cache-guardian`：装上即用（golden freeze + `PI_CACHE_RETENTION=long` 自动生效），`/cache-guardimizer` 查看每轮缓存统计；可选开启会话结束命中率报警：`PI_CACHE_GUARD=1`（阈值 `PI_CACHE_GUARD_THRESHOLD`，默认 90）。autocompact 后是新 session，会重新捕获 golden，无需干预。
5. **`pi-edit-guard`**：装上即用，**同名接管内建 `edit`**（无需改 lazy 名单）。需要 `undo` 时将其列入 `lazy-tools.json` 的 `lazy` 数组即可按需加载。⚠ 若启动报 node 版本相关错误，需将 Node 升到 `>=24.18.0`（本机 24.16.0 实测仅安装告警、运行正常）。
6. **`@trycedar/pi-mdiff`**：装上即用，编辑 `.md` 时把 `md_inspect`/`md_diff`/`md_edit` 列入 lazy 名单后按需加载。**旧包名 `pi-mdiff` 已弃用，务必用 `npm:@trycedar/pi-mdiff`**（bare 名会触发弃用告警甚至 ECONNRESET 失败）。

## 全量懒加载策略

**2026-09-21 起长期执行：所有扩展工具一律 lazy，低频不设门槛。** 首请求上下文仅保留 `load_tools`/`call_tool` 两个承载工具，其余全部从 LLM 可见 active 集剔除；需要时由 `load_tools` 纯文本注入用法、`call_tool` 代理执行（两步确认门：`confirm:false` 零副作用挑战文本 → 用户点名后 `confirm:true` 激活，会话级记忆、会话开始清空）。

### 工具归属

| 扩展 | 工具 | lazy 名单位 |
|---|---|---|
| pi-edit-guard | `edit`、`undo` | ✓ |
| @trycedar/pi-mdiff | `md_inspect`、`md_diff`、`md_edit` | ✓ |
| @tian.zuo/pi-find | `grep`、`find` | ✓ |
| pi-web-access | `web_search`、`source_check`、`fetch_content`、`get_search_content` | ✓ |
| @injaneity/pi-computer-use | `observe_ui`、`search_ui`、`expand_ui`、`inspect_ui`、`act_ui`、`read_text`、`wait_for`、`find_roots`、`launch_browser`、`navigate_browser`、`evaluate_browser` | ✓ |
| @wolido/pi-lazy-tools | `load_tools`、`call_tool` | ✗ 承载者，常驻 |
| 用户自定义 | `deploy_tool` | ✓ |

### 执行纪律

1. **安装任何新扩展 → 其注册工具名补进 `~/.pi/lazy-tools.json` 的 `lazy` 数组**（同扩展工具可部分 lazy，此处全量）。
2. **`--tools` 白名单必须保留 lazy 工具**：注册与隐藏是两件事，只加 lazy 名单不进 `--tools`，`load_tools` 会报「未找到工具元数据」。
3. 激活是会话级记忆，会话开始清空；`load_tools` 只在用户主动点名时才 `confirm:true`，不自行加载。
4. 开新会话生效（扩展在会话启动时加载）。

### 权衡

- 得：首请求主动集最小化、注入量与 token 最低，工具说明书不常驻上下文。
- 失：每次使用多一轮 `load_tools` 往返（含用户确认），写代码/搜索/网页/UI 操作都要先激活对应工具。
- 全懒后 `edit`/`grep`/`find` 默认不可见，但注册不变（同名替换内建行为保留），激活后即恢复原能力。

### 缓存纪律（web_search 等大输出工具）

**实测（2026-09-21 会话）**：web_search 默认把原始 HTML/CSS/热榜 JSON 全文（21KB+）写入会话历史，该轮前缀命中率从 96%+ 骤降至 **50.5%**；load_tools 注入大 schema 文本同理（55.7%）。前缀缓存从请求开头匹配，命中只到上一请求末尾——**一次性注入大文本的轮次命中率必然崩，看累计命中率（~90%）而非单轮**。

执行约定：

1. **web_search 一律用 `workflow:"auto-summary"`**（返回精简摘要 + sources，实测无原始 HTML 入历史）或 `includeContent:false`；确需全文时才显式开 `includeContent:true`。
2. 大工具输出轮命中率低是结构性必然，评估看 `/cache-guardimizer` 累计值，`PI_CACHE_GUARD_THRESHOLD` 报警阈值勿按单轮瞬间判定。
3. cacheWrite 全程为 0 时（OpenAI 兼容端点不报写侧缓存），长输出对前缀缓存是净负债，能不进历史就不进。
