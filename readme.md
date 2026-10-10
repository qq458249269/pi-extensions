# Pi 扩展安装配置清单

本手册是一份**可直接照做的安装 + 配置清单**：装哪些、按什么顺序装、每个必做配置写什么、以及每条结论的实测依据。
扩展统一装在 `~/.pi/agent`（Windows：`%USERPROFILE%\.pi\agent`），下文路径均以此计。

**本机基线（所有实测都在这上面做的）**：Pi **1.1.0**（装在 `D:\Agent\pi`）、node **24.16.0**、npm 12、模型走本地代理 `http://localhost:20128/v1`（`openai-completions`，模型 id `1`，窗口 **128K** —— `models.json` 里 `contextWindow: 128000`）。
> **升级沿革**：0.87.1 →（2026-10-02）**1.0.0** 宿主自带 `buildSessionProjection()` →（2026-10-09）**1.1.0**，安装目录从 `D:\agent\pi-windows-x64` 换成 `D:\Agent\pi`（`where pi.exe`）。§6 的字节数、§7 的旧版本结论都是 0.87.1 快照，未复测；§8 排障表与 §1 清单按 1.1.0 对齐。
> ⚠️ node 仍是 **24.16.0**，低于 `pi-agent-browser-native@0.9.3` 声明的 `>=24.21.0`。npm 每次装/卸都会打 `EBADENGINE Unsupported engine`，**只是警告**，8 个 `agent_browser*` 工具实测正常，不必为它升 node。
> **2026-10-09 体检改动**（根因与验证见 §7.15）：① 上游 `pi-dsh-pet` 扩展改用 `packages` 的 **object form** 屏蔽（此前是纯字符串，上游扩展一直在加载，与本地薄客户端**重复注册 `/pet` `/pet-stop` `/pet-say` `/pet-status`**，还多一条 `session_start` 拉宿主的路）；② `cache-compact.json` 转生产配置（`debug` 关，1.1MB 调试落盘已删）；③ 补记 `bash-prelude.sh`（`shellCommandPrefix`，原文档漏记，照 readme 重建必丢）；④ `allowScripts` 里 better-sqlite3 的版本纠正为树内实际版本（§3.1）。
换版本 / 换 provider 后，下面的数字要重新对账（§6 是 0.87.1 时期的 wire 实测，pi 1.1.0 下未复测，本机也不再复测——按结论用，别按字节抠）。

---

## 1. 清单（在用 28 个扩展 = 26 npm + 2 git）

**实际在用 28 个**。
> 2026-10-06 增补 3 个：联网（`pi-web-access`）、会话级撤销（`@bacnh85/pi-checkpoint`）、完成通知（`pi-notify`）。PR 插件（`@henryqw/pi-pr`）装后即卸，见 §7.7。
> 2026-10-08 精简：卸 `pi-budget-guard`（与 `pi-meter` 功能三层全重叠，见 §7.12）与 `pi-warm-cache`（本机不生效的死安装，见 §7.12）；补装 `@arhen/pi-core-subagent`、`pi-ocr`（此前清单漂移：列了但实际未装）；新增 `pi-deepseek-cache`（DeepSeek 后端专用，与 §5.5 原判相悳 —— **2026-10-09 已验实并卸载，见 §7.13**）。
> 2026-10-09 压缩侧换血（见 §7.13）：装 `pi-cache-compact`（provider 无关的压缩调用缓存，本机实测命中 68.6%）；卸 `pi-deepseek-cache`（绑定 DeepSeek）与 `pi-compaction-cache`（被 cache-compact 取代，且同抢 `session_before_compact`）。29 → 28。

**不锁版本**：安装命令一律不带 `@版本号`（取 npm 最新），本清单不维护版本矩阵。要查本机实际装的版本：

```bash
node -e 'const{execSync}=require("child_process"),fs=require("fs");
execSync("pi list",{encoding:"utf8"}).split("\n").filter(l=>/^\s+(npm|git):/.test(l)).map(l=>l.trim())
 .forEach(s=>{const n=s.split(":").slice(1).join(":").replace(/@latest$/,"");
  try{console.log(n,"→",JSON.parse(fs.readFileSync(process.env.USERPROFILE+"/.pi/agent/npm/node_modules/"+n+"/package.json","utf8")).version)}catch{console.log(n,"→ (git)")}})'
```

### 1.1 核心层（先装，装完先跑一次冒烟）

| 包 | 作用 | 备注 |
|---|---|---|
| `npm:pi-tps` | 底部 token/speed 状态栏 | 装后跑 `fix-tps-theme.ps1` 让配色跟随系统主题 |
| `npm:@injaneity/pi-computer-use` | 桌面截图 / 点击 / 输入 | **唯一需批准 install 脚本的包**，见 §3.1 |
| `npm:pi-one-ui` | TUI 统一美化（Header/Context/WorkingLine/Editor/Footer） | 取代旧 `alps-pi`；要求 Node ≥22.19、Pi ≥0.84 |
| `npm:pi-cache-guardian` | 缓存命中巡检 + 前缀漂移告警 | 与 §6 的 prefix-stabilizer 是同一根因的两端，一并用 |
| `npm:@tian.zuo/pi-find` | `grep` / `find` 工具 | **覆盖内建同名工具**（替换，不是并列）。本机只用它的 `grep`；`find` 已降为懒加载兜底（见 §4.1） |
| ~~`npm:pi-edit-guard`~~ | 覆盖内建 `edit` + 注册 `undo` | **已卸载**（见 §7.1），要装的话注意与 smart-edit 争 `edit` 槽。它空出来的「撤销」位：本机有 git + `edit` 精确替换（撤销走 git / 编辑历史），会话级撤销由 `@bacnh85/pi-checkpoint`（`/undo`）补上 |
| `npm:@trycedar/pi-mdiff` | `md_inspect` / `md_diff` / `md_edit` | Markdown 结构化编辑，`.md` 改动优先用它 |
| `npm:pi-mcp-adapter` | 一个 `mcp` 代理工具替代成百上千个 MCP 工具定义 | 装完重启自动读 `.mcp.json` |
| `npm:pi-agent-browser-native` | 原生 `agent_browser*` 工具（8 个） | 0.9.3 起直接遍历宿主的 `sessionManager.buildSessionProjection()`，不再走 `getCurrentSystemMessage` 旧路径。Pi 1.0.0+ 宿主自带该 API，**不需要**兼容补丁。**但它声明 `node >=24.21.0`，本机 24.16.0 → 装卸时必有 `EBADENGINE` 警告（无害，见开头基线注）** |
| `npm:@agenticup/pi-loop` | `loop` 递归深潜工具 | 入口是 `extensions/loop.ts`，不是 `dist/index.js` |
| `npm:@arhen/pi-core-subagent` | 子代理（后台默认） | 2026-10-06 装；2026-10-08 发现清单漂移（列了但实际未装）后补装。`subagent`/`subagent_status`/`await_subagent`/`steer_subagent` 等；模型继承 leader（`1/1`），不读旧 `~/.pi/subagent.json` |
| `git:github.com/qq458249269/pi-lazy-tools` | 按需工具加载（`omnify` 一站式：搜索 / 补参 / 代理执行） | **fork，含 jiti 加载器补丁**；npm 版 `@wolido/pi-lazy-tools` 已下架。**0.4.0 是 breaking**：常驻名单从自建 `~/.pi/lazy-tools.json` 改读 pi 的 `defaultTools`（见 §3.4）。本地 clone 在 `D:\AI\pi-lazy-tools`，改完直接 commit + push，`pi update --extensions` 就能带上 |
| ~~`npm:@zhushanwen/pi-smart-context`~~ | 智能压缩：注册 `compact_context` 交 agent 自决 | **已卸载**（`pi uninstall npm:@zhushanwen/pi-smart-context`）：阈值提醒实测触发过（`sessions/*-pi-dsh-pet-*/12-29-47` 落在 89.5K/128K 与 91.9K/128K 两档），但 `compact_context` 作为 toolCall 出现 **0 次**，压缩收益 0。理由与数据见 §3.2 |
| `npm:pi-prefix-stabilizer` | 系统提示词前缀稳定 + 漂移检测 | 与 cache-compact 有先后要求，见 §2.2 |
| ~~`npm:pi-compaction-cache`~~ | 摘要调用复用已缓存前缀 | **已卸载**（2026-10-09，见 §7.13）：被 `pi-cache-compact` 取代，两者抢同一个 `session_before_compact`，只能留一个。旧必做配置在 §3.3 留档 |
| ~~`npm:pi-warm-cache`~~ | 空闲期按厂商 TTL 续前缀缓存 | **已卸载**（2026-10-08，死安装，见 §7.12）；本机代理属未注册路由，当时纯静默待命 |
| `npm:@henryqw/pi-ask-question` | `ask_question` 交互式提问（单题，1–3 选项 + 自定义答案，首项为推荐） | 歧义时问用户，比猜省事 |
| `npm:@ssk_dev/rpiv-todo-lean` | `todo` 任务清单工具 + TUI overlay | `ctrl+shift+t` 折叠；`/todos` 看全量 |
| `npm:@aboutlo/pi-smart-edit` | 覆盖内建 `edit`，容忍引号/空白不匹配 | **已生效**；`edit` 归它，匹配走「精确 → NFKC 归一化行」 |
| `git:github.com/qq458249269/pi-dsh-pet` | 桌面宠物：Electron 透明浮窗 + 91 个 WebM 动画，随 agent 状态（思考/写代码/空闲）切换 | **纯命令扩展**（`/pet` `/pet-stop`），零工具、零 wire 开销。**必须 `pi install`**，光 `npm i -g` pi 不加载（见 §3.6）。**2026-09-30 从 `npm:pi-dsh-pet` 换成 git 源**（自己 fork 的仓库，改完 `git pull` 就生效；`pi update --extensions` 也认它）。常驻与「整机只留一只」由本仓库的 `pi-pet-autostart.ts` 接管 |

| `npm:pi-web-access` | `web_search` / `source_check` / `fetch_content` / `get_search_content` + `/websearch` `/search` `/curator` | 2026-10-06 **复装**（曾于 2026-09-30 卸载，§7.4）。**必做配置** `~/.pi/agent/web-search.json` 写 `toolActivation: "eager"`，见 §3.7 —— 不写就用 `web_enable` 加载器中途改 active 集，会把前缀缓存掀掉（正是当年卸掉它的原因）。26 个搜索源，duckduckgo 无需 key。**实测对 wire 与缓存零影响**（§3.7），要时 `omnify` 捞 |
| `npm:pi-notify` | `agent_end` → Windows toast | 2026-10-06 装，零配置零依赖。Windows Terminal 走 PowerShell toast（`WT_SESSION` 判定），其他终端 OSC 777/9/99。subagent / `loop` 后台跑完靠它收通知。实测：headless 也发（OSC 777 直接打在 stdout） |

| `npm:pi-test-runner` | 项目感知的测试运行工具 | 2026-10-07 装。结构化跑测试，替代手写 `bash npm test`；懒加载 |
| ~~`npm:pi-budget-guard`~~ | 会话花费追踪 + 预算上限 | **已卸载**（2026-10-08，见 §7.12）。与 `pi-meter` 在追踪/告警/拦截三层全重叠，meter 是超集；原 2026-10-07 装 |
| ~~`npm:pi-zvec`~~ | 本地语义代码搜索（BM25 + embedding，每项目索引） | **已卸载**（2026-10-08，见 §7.11）。原 2026-10-07 装（**自动模式**索引，卸载时连项目索引目录一并删除） |
| `npm:pi-ocr` | 多后端 OCR（MinerU 免费云 / Ollama 本地 / Pix2Text），零配置 | 2026-10-07 列装但实际漂移未装，2026-10-08 补装。截图/PDF 出文本；懒加载 |
| `npm:@chendpoc/pi-memory` | 跨会话记忆（MEMORY.md ground truth + JSONL sidecar 检索） | 2026-10-07 装。备选 `pi-session-memory` 因 `node:sqlite` 在 Pi 内嵌运行时缺失（`ResolveMessage: No such built-in module: node:sqlite`）加载即败，已卸，见 §7.6 |
| `npm:pi-secret-guard` | 拦截提交 API key / 凭据到 git | 2026-10-07 装。误提交 key 不可逆，故必装；懒加载 |
| `npm:pi-mono-context-guard` | 上下文体积硬闸：自动截断 read/rg 超长输出 | 2026-10-07 装。cache-guardian 只告警，这是截断侧；懒加载 |
| `npm:pi-meter` | 花费追踪 + 预算告警 + auto-downshift + 硬截断 | 2026-10-07 装。**唯一预算侧**（budget-guard 2026-10-08 已卸，追踪/告警/拦截/降级全并于此）；本机走本地代理，auto-downshift 与内置价格表可能对不上，费用数字仅供参考；懒加载 |
| `npm:@narumitw/pi-plan-mode` | `/plan` 只读规划模式（Codex 风格） | 2026-10-07 装；懒加载 |
| `npm:@narumitw/pi-lsp` | LSP 工具（语言无关，共享 runner，可配置） | 2026-10-07 装（此前只在增补注里提过，本行 2026-10-08 补录）；懒加载 |
| ~~`npm:pi-deepseek-cache`~~ | DeepSeek 前缀缓存：命中率遥测 + 前缀守卫 + 缓存友好压缩 | **已卸载**（2026-10-09，见 §7.13）：全部功能绑定 DeepSeek 后端（DeepSeek 价格表换算 + `deepseek-flash` 压缩调用 + 注册表查 deepseek provider），本机代理（localhost:20128 的「GPT-6 Astra」）三条全失效。2026-10-08 装 |
| `npm:pi-cache-compact` | 压缩调用复用前缀缓存：把摘要请求拼成活会话的**严格续写**（同 system + tools + messages + 追加一问） | **2026-10-09 装，provider 无关**（源码 0 处 "deepseek"）。实测压缩调用 `cacheRead: 81920`（本机代理命中 68.6%），Pi 默认压缩同一前缀必为 0。**零配置可用**，取证配置见 §3.3；必须装在 `pi-prefix-stabilizer` 之后，见 §2.2 |
| `npm:@bacnh85/pi-checkpoint` | 会话级撤销：`/undo` `/redo` `/checkpoint` | 2026-10-06 装。**必须在 git 仓库内**，否则三个命令静默 no-op；写 `refs/pi-checkpoints/*`，不碰分支/tag/stash；坑：只还原已跟踪文件，本轮新增的未跟踪文件留在原地（见 §3.8）。只在无交互 `pi -p` 下验证过不报错，`/undo` 本身未实测 |
| ~~`npm:pi-cwd-guard`~~ | cwd/路径闸：曾保护 .env/密钥、拦破坏性路径 | **已卸载**（2026-10-08，见 §7.10） |

### 1.2 本地扩展（不走 `pi install`，放 `~/.pi/agent/extensions/`）

仓库 `extensions/` 是 canonical 源，`node install-local-extensions.mjs` 幂等同步到用户目录（`--check` 只体检、有漂移 exit 1）。

| 文件 | 作用 |
|---|---|
| `pi-lean-prompt.ts` | 裁 `payload.tools` 里 `edit`/`read` 的 description 与 schema 样板文字（**只改文字、不动字段结构**，故与 smart-edit / one-ui / undo-redo 兼容） |
| `pi-lean-sections.ts` | 压 wire 上 system 的 `<docs>` / `<skills>` 两块（见 §6.2） |
| `pi-fd.ts` | 注册 `fd` 工具（fd 原生接口），**取代 pi-find 那个只认 glob 的 `find`**（见 §4.1） |
| `pi-bash-guard.ts` | **不注册工具**，只挂 `tool_call`：**所有** bash 命令没传 `timeout` 就按档注入（搜索 30s / 构建 1800s / 其余 300s，硬的 1 小时上限）、永不返回的命令（编辑器/分页器/前台 dev server/常驻容器）与后台化的搜索直接 block、给 `fd` 工具补 `timeoutMs`（见 §5 铁律二） |
| ~~`no-find.ts`~~ | 曾挂 `tool_call` 钩子把命令行里的 `find` block 掉并提示改用 `fd`；**已卸载**（2026-10-08，§7.9）：本机恢复 `find`，4 层封锁全撤 |
| `pi-pet-autostart.ts` | 让 `pi-dsh-pet` **默认常驻且整机只留一只**：TUI 会话一开就派发 `/pet`，已有宠物窗就复用不新开，跨会话/多开 pi 也只一只。不注册工具，只挂 `session_start` + `/pet-auto` 开关。配置见 §3.6 |

> 曾经的 `pi-shell.ts`（把 `bash`+`powershell` 合成 `shell`）**已删除**：它不是 pi 内置也不是 npm 包，纯本仓库自写；它带的 `-156B` 收益抵不上维护成本，改用内建 `bash`（见 §6.1）。注意它在 `session_start` 里会无条件隐藏 `bash`/`powershell`，所以 `shell` 与 `bash` 只能二选一。

### 1.3 Skills（可选，非扩展）

| 技能 | 安装 | 用途 |
|---|---|---|
| `cangjie-skill`（仓颉） | `git clone github.com/kangarooking/cangjie-skill` | 把书 / 长视频 / 播客 / 课程蒸馏成可执行 skills |
| `goutoujunshi`（狗头军师） | `git clone github.com/shengjidaguai-china/goutoujunshi` | 恋爱军师与情绪支持 |
| `pimeter` | **不用装**：`npm:pi-meter` 自带（`~/.pi/agent/npm/node_modules/pi-meter/skills/pimeter/`） | 花费账单怎么看：本机走本地代理，内置价格表对不上，**数字仅供参考**（见 §1.1 pi-meter 行） |

> skill 不再常驻注入系统提示词（见 §6.2），需要时用 `omnify` 检索。实测本机技能清单 = 上述 3 条（`pi list`/agent 技能面板可见）。

---

## 2. 安装

### 2.1 顺序循环

**`pi install` 一次只写一条注册，绝不能并行**（并行会竞写 `settings.json` 丢包）。照序跑：

```bash
for p in pi-tps @injaneity/pi-computer-use pi-one-ui pi-cache-guardian \
         @tian.zuo/pi-find @trycedar/pi-mdiff \
         pi-mcp-adapter pi-agent-browser-native @agenticup/pi-loop; do
  pi install "npm:$p" || echo "[失败] $p"
done

# 有硬顺序的后续（cache-compact 必须在 prefix-stabilizer 之后，见 §2.2）
for p in pi-prefix-stabilizer pi-cache-compact \
         @henryqw/pi-ask-question @ssk_dev/rpiv-todo-lean \
         @aboutlo/pi-smart-edit; do
  pi install "npm:$p" || echo "[失败] $p"
done

# git 源单独装（两个都要串行；宠物从 npm 换 git 时先 remove，见 §3.6）
pi install git:github.com/qq458249269/pi-lazy-tools
pi install git:github.com/qq458249269/pi-dsh-pet
pi install "npm:pi-web-access"
pi install "npm:@bacnh85/pi-checkpoint"
pi install "npm:pi-notify"

# 2026-10-07 增补（OCR/跨会话记忆等；PR 插件已卸，见 §7.7；pi-ask-permission 已卸，见 §7.8；no-find 已卸，见 §7.9；pi-cwd-guard 已卸，见 §7.10；pi-zvec 已卸，见 §7.11；budget-guard/warm-cache 已卸，见 §7.12；deepseek-cache/compaction-cache 已卸，见 §7.13 —— 均勿再装）
# ⚠ pi-lsp / test-runner / ocr / memory / core-subagent 与上一段（§3.1 起）里的 secret-guard / mono-context-guard / meter / plan-mode
#   曾一度「表里列了但安装循环漏了 → 清单漂移」（§7.12 的教训：pi list 与 §1 逐行对）。26 个 npm 一个都不能漏。
for p in @narumitw/pi-lsp pi-test-runner pi-ocr @chendpoc/pi-memory @arhen/pi-core-subagent; do
  pi install "npm:$p" || echo "[失败] $p"
done

# 钩子层（不注册常驻工具：凭据拦截 / 截超长 read+rg 输出 / 预算与花费 / 只读规划模式）
for p in pi-secret-guard pi-mono-context-guard pi-meter @narumitw/pi-plan-mode; do
  pi install "npm:$p" || echo "[失败] $p"
done

# 本地扩展（含 pi-pet-autostart.ts，宠物默认启用就靠它）
node install-local-extensions.mjs
# 项目级/用户级配置：把仓库 config/ 拷进 pi 真正读取的位置（`.pi/` 是运行时目录，仓库里整体忽略）
node install-project-config.mjs
```

> **GitHub 直连不通（国内出口 443 超时）时走加速源**：先把 git 的 https 改写到可达镜像，再照上面装。实测 `gh-proxy.com` 可用，`ghproxy.com`/`gitclone.com`/`ghproxy.cc` 本机 2026-10-02 均不可达或证书过期。全局设置一次即生效（含 `pi install` 内部的 git clone）：
>
> ```bash
> git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"
> pi install git:github.com/qq458249269/pi-lazy-tools
> pi install git:github.com/qq458249269/pi-dsh-pet
> # 不想留全局改写就改完装完撤掉：
> git config --global --unset url."https://gh-proxy.com/https://github.com/".insteadOf
> ```
>
> 若 `pi update --extensions` 也超时，同一改写继续生效（git 源的 update 就是 git pull）；装完即可 `/reload`。

装完自查：`pi list` 应见 **28 个扩展**（26 npm + 2 git）

### 2.2 硬顺序约束

- `pi-cache-compact` 必须在 `pi-prefix-stabilizer` **之后**：两者都抢 `session_before_compact` 的接管权，靠后装的赢；反过来压缩调用命中会退化。~~原第一条写的是「compaction-cache 必须在 smart-context 之后」~~ —— smart-context 已卸载（§3.2），2026-10-09 compaction-cache 也被 cache-compact 取代（§7.13），约束收敛成这一条。
- `pi-prefix-stabilizer` 必须在 `pi-cache-compact` **之前**：先稳前缀再谈复用。
- **历史教训**：`pi-deepseek-cache` / `pi-compaction-cache` / `pi-warm-cache` 都抢过（或试图抢）同一个压缩钩子，三者同场时接管权按装卸顺序互相覆盖 —— 压缩侧**只留 `pi-cache-compact` 一个**（§7.13）。
- 其余顺序不限（`pi-ask` / `rpiv-todo-lean` 都不抢 `session_before_compact`；`pi-warm-cache` 已卸，§7.12）。
它的 `tool_call` 钩子只 `broadcast` 不 block（实测 `extension_error` 0）

### 2.3 升级

```bash
pi update --extensions        # 只升扩展，不动 pi 本体（--all 会连 pi 一起升）

# 升完先看谁动了（fork 与 major 变更最容易出兼容问题）
pi list                                # 升完核一遍实际版本
```

**升级禁用 `pi install`**：对已装包会命中 npm 缓存、不升版本。升级一律走 `pi update --extensions`（不带版本号 = 取各包 npm 最新）。升级后跑 §8 体检。

> 首次安装（§2.1）同样不带版本号，npm 自动解析 latest；**本仓库任何位置都不写死扩展版本号**。
> **两个 git 源走同一条命令**：`pi update --extensions` 对它们是 `git pull`（`pi-lazy-tools` 会 `reset --hard` + `clean -fdx`，**`fix-lazy-tools-notes.mjs` 的 `DOCS_NOTE` 路径补丁会被冲掉，重跑即恢复**——脚本靠 `where pi.exe` 定位 pi 根目录，pi 不在 PATH 时它直接跳过并报「未能定位」）。

> **升 `pi` 本体（`pi update --all`）或重装依赖会覆盖 `~/.pi/agent/node_modules` 里的补丁**：`fix-proper-lockfile-proxy.mjs`（§7.14，防 jiti Proxy 崩 pi）会被冲掉，升完重跑一次即可（`node fix-proper-lockfile-proxy.mjs --check` 只体检）。

> `pi-dsh-pet` 换成 git 源后**不再有「反复重下 48MB 动画」的问题**——clone 就带 `assets/thumb`（91 个 WebM，整仓 202M），`pi update` 只拉增量；只有第一次 `/pet` 要下 Electron ≈100MB。

**处理办法见 §3.4；升完必跑一次 bench 确认 wire 工具集没变**（本次实测未变：升完是 8 个工具 / 8317B，`extension_error` 0；随后按「只保留默认工具」收敛为 6 个 / 6010B，2026-09-30 卸 `pi-web-access` 后为 **5 个 / 5664B**）。

### 2.4 卸载

```bash
pi remove npm:<包名>
```

卸载后同步删掉只为它存在的配置（例：`pi-footer-template` 卸载时连带删 `~/.pi/agent/pi-one-ui.json`），否则留下死配置。

---

## 3. 必做配置

### 3.1 批准 install 脚本（本机只有 2 条，且**版本必须随树走**）

```bash
cd ~/.pi/agent/npm          # 必须在含 package.json 的目录里跑
npm install-scripts approve @injaneity/pi-computer-use better-sqlite3
npm rebuild better-sqlite3  # 批完必须重编，批准本身不建原生 binding
```

当下 `~/.pi/agent/npm/package.json` 的 `allowScripts`：

```json
{
  "@injaneity/pi-computer-use@0.5.1": true,
  "better-sqlite3@12.11.1": true
}
```

- **`better-sqlite3` 是 `@chendpoc/pi-memory` 带来的**（`dependencies: {"better-sqlite3": "^12.10.0"}` → 树内 **12.11.1**；`@injaneity/pi-computer-use` 现在**不**依赖它，它的 postinstall 只是 `scripts/setup-helper.mjs` 装原生辅助程序）。用途是 pi-memory 的向量索引：`dist/sidecar/server/vec/store.js:11` 的 `require("better-sqlite3")`。
- ⚠️ **版本号会随依赖重解析漂移**（本机就踩过：`allowScripts` 里写的是 `better-sqlite3@13.0.3`，树里实际是 12.11.1 → npm 视为「未覆盖」→ binding 不建 → 加载 pi-memory 报 `Could not locate the bindings file. Tried:`）。所以：
  1. 批准时**写不带版本号的包名**，让 npm 自己把树内版本写进 `allowScripts`（输出会打 `removed-stale ...@13.0.3` / `added ...@12.11.1`）；
  2. 安装/卸载**任何一个**扩展后（npm 会重解析整棵树）都复验一次：`node -e "console.log(require('better-sqlite3')(':memory:').prepare('select 1 as x').get())"` 应打印 `{ x: 1 }`；报 `Could not locate the bindings file` 就重跑上面两条。
  3. 重编需要 MSVC：本机 `cl.exe` 不在 PATH，但 `C:\Program Files (x86)\Microsoft Visual Studio\2022` 在位，node-gyp 经 vswhere 能找到 → `rebuilt dependencies successfully`。
- `~/.pi/agent/npm/package-lock.json` 会被 npm 重写（本机 68KB → 222KB，npm 12 的 v3 格式更啰嗦），**属正常，不必回滚**。
- **`@chendpoc/pi-memory@0.3.2` 的 postinstall 是有意不批的**（`npm install-scripts ls` 会一直报它 `blocked`）：该脚本只跑 `pi-memory init` + `scheduler sync`，**best-effort、不是加载必需**（实测不批照样加载，`~/.pi/pi-memory-data/` 下有 `MEMORY.md` + `logs`），符合「只批必需」的纪律。要批就 `npm install-scripts approve @chendpoc/pi-memory`（会写 `~/.pi/pi-memory-data` 与调度任务，自行取舍）。
- 其余包实测均无 install 脚本。

### 3.2 ~~smart-context~~（已卸载 2026-10-02，配置一并作废）

原配置位置 `~/.pi/agent/config/smart-context-ext-config.json` 已删（包没了，文件是死配置；重装同版本会自动重建）。当时值留档：

```json
{ "enabled": true, "compactModel": { "type": "ref", "ref": "" }, "reminderThresholds": [60000, 75000, 90000], "excludedModels": [] }
```

**卸载理由**（实测，不是猜）：

| 事实 | 证据 |
|---|---|
| 阈值提醒确实触发过 | `~/.pi/agent/sessions/--D--AI-pi-dsh-pet--/2026-10-02T12-29-47-157Z_*.jsonl` 两条 `smart-context:fired`：`{"tiers":[60000,75000],"tokens":89456}`、`{"tiers":[90000],"tokens":91855}`，各跟一条 `custom_message` 提醒（89.5K/128K 69.9%、91.9K/128K 71.8%） |
| `compact_context` 一次没被调 | 全 `sessions/` grep `toolName/name = compact_context`，0 命中（唯一匹配是 system prompt 的工具清单） |
| 所以净收益 = 0 | 多两个包（5 个依赖）+ 一份配置 + 一次提醒往返，换来 0 次压缩 |

**根因**（三条，叠加后基本不可能触发）：

1. 提醒**是数据不是指令**。文案原文：「达阶段边界……时才调用 `compact_context`；**否则忽略本提示继续工作**」。「阶段边界」这个条件模型几乎永不判定成立，于是永远忽略。
2. `compactModel.ref` 是空串 → `pickMode` 只能走 same-model，拿不到 cross-model 的廉价模型收益。
3. 阈值 60K/75K/90K 对 128K 窗 = 47%/59%/70%，**比内建 auto 压缩的触发点还晚**，插件还没等到动手，内建 `/compact` 已经压完了。

**留个教训**：阈值类扩展的价值全在「agent 真的执行」上。提醒送到 ≠ 模型动手。要这类功能，先 grep session 确认 toolCall 真发生过，再决定留不留。

> §2.2 原本那条「compaction-cache 必须在 smart-context 之后」的硬顺序随之作废；2026-10-09 后压缩侧只剩 prefix-stabilizer → cache-compact 一条（§7.13）。

### 3.3 pi-cache-compact：`~/.pi/agent/cache-compact.json`（**零配置可用，但本机写了模型白名单**）

**本机生产配置（2026-10-09 定稿）**：`~/.pi/agent/cache-compact.json` = `{"models": ["1/1"]}`

```json
{ "models": ["1/1"] }
```

- 写白名单而不是不写文件，是为了让**「只对当前 provider/model 生效」这件事显式可见**（本机只有一个 provider「1」、模型 `1`，`1/1` 即命中），避免以后换 provider 后默默全量生效。
- ⚠️ **千万别开 `debug`/`debugPayloads`**：`cache-compact-debug.jsonl` 会 dump 全量 payload（**含完整对话内容**），本机已开过又删（1.1MB）。取证写法见下方「临时取证」，**测完即删**：

```json
{ "debug": true, "debugFile": "C:/Users/yinxuehao/.pi/agent/cache-compact-debug.jsonl" }
```

- **机制**：拦截 `session_before_compact`，把摘要请求拼成活会话的**严格续写**（同 system prompt + tools + 全部 messages + 追加一问 "The messages above are a conversation to summarize. Create a structured context checkpoint summary…"），因此任意支持前缀缓存的服务端都能命中。**手动 `/compact` 与自动压缩同钩子，都走这条路径。**
- **fail-safe 是它最大的优点**：摘要为空 / 被 `length` 截断 / 夹带工具调用 → 返回 nothing，回落 Pi 默认压缩，绝不给出坏摘要。
- 常用选项：`models`（限定 provider/model，默认全放行）、`continuation: true`（前向续写；append-only 缓存会把短前缀当全量重预填，故别关）、`deferAfterCacheMiss: true`（冷 miss 后 15 分钟内把压缩让回 Pi，不烧第二次冷 prefill）、`summaryMaxTokens`（默认取 Pi 自身上限）、`debugPayloads`（dump 全量 payload，**含完整对话，测完即关**）。
- **取证读法**：debug JSONL 里 `"summary": true` 的 `provider_request` / `provider_response` 是扩展的续写请求；命中数看 `summary_result` / `wrote cache-friendly summary` 记录的 `cacheRead`；摘要不可用时终端直接打 `[cache-compact] summary rejected … usage:{…}`。
- ⚠️ **热前缀才可能命中**：上游（mimo 免费端点）缓存几分钟就过期，隔夜压缩必 `cacheRead: 0`（此时 `deferAfterCacheMiss` 自动让位，属正常）。
- ~~原 `pi-compaction-cache` 的必做配置（已随卸载删除，留档）~~：`~/.pi/agent/compaction-cache.json` = `{"models": ["1", "1/1"], "scope": "boundary", "logPath": "C:/Users/yinxuehao/.pi/agent/logs/compaction-cache.log", "debug": false}`，配 `/compaction-cache-status` 与该日志。**勿再写回**（§7.13）。

### 3.4 懒加载常驻集 = `settings.json` 的 `defaultTools`

一个字段两用：pi 用 `defaultTools` 决定「哪些内建工具注册」，`pi-lazy-tools` 用它决定「谁不被懒加载」（项目级整体覆盖用户级）。本机两处写同一份名单：

```jsonc
// ~/.pi/agent/settings.json 与 <项目>/.pi/settings.json
// 本仓库的项目级 canonical 源 = config/pi-project/settings.json（`.pi/` 整体 gitignore）
// 拷进去：node install-project-config.mjs ｜ 体检：node install-project-config.mjs --check
{ "defaultTools": ["read", "edit", "write", "bash"] }
```

> **本机就选 pi 的内置默认 4 个**（`dist/core/sdk.js:140` 的 `defaultActiveToolNames`），一个扩展工具都不加：搜文件名/目录、搜内容全部交给 `omnify` 按需代理执行。换来 `8317B → 5664B`（**−2653B ≈ −689 tok/请求**，见 §6.3），代价是每次搜索多 1–2 个往返轮次。
> **`omnify` 不写进 `defaultTools`**：它由 lazy-tools 在 `session_start` 无条件写进 active 集（`setActiveTools`），写不写都一样。
> **`grep` / `fd` 不写也会注册**（扩展注册不过内建闸），只是被 lazy 隐藏；`omnify` 能把它们搜出来并执行（已实测）。**内建的 `ls` / `powershell` 搜得出、却执行不了**（pi 用内部工厂造它们，`sourceInfo` 是合成标记 `<sdk:ls>`，没有可 import 的源码）→ 这类需求一律 `bash ls`。fork 已把这个原因写进 omnify 的失败文案（见 §7.3）。
> **`~/.pi/lazy-tools.json` 已删除**（2026-09-29，`pi-lazy-tools` 0.4.0 起只告警不读取；旧副本 `lazy-tools.json.bak` / `.bak2` 同日一并删掉，内容已进 `defaultTools`）。新装扩展**不要**往 `defaultTools` 里加（硬规则，见 §5 第 0 条）。
> 改完 `/reload` 生效（不必重启会话）。

### 3.5 工具注册闸：`defaultTools`（项目 + 用户两处都要写）

项目 `.pi/settings.json` 与 `~/.pi/agent/settings.json` 都要写上一节那份名单，否则进了某项目就被整体覆盖成内建默认（`read bash edit write`）。本机两处写的正是这份默认名单，所以项目间切换不会有差异。

> ⚠️ 0.4.0 之前这里确实是「两道闸」（`defaultTools` 管注册 + `lazy-tools.json` 的 `resident` 管常驻），**现在合并成一道**，只查 `defaultTools`。

### 3.6 桌面宠物：独立服务端 + 整机一只（2026-09-30 按上游 0.0.2 重写）

上游 0.0.2 把桌宠改成了**独立应用**（`pi-pet start`，也发单文件 exe）：自带 HTTP + WS 服务、自己选端口、自己管窗与单例锁。于是本机扩展 `extensions/pi-pet-autostart.ts` 从「内嵌宿主 + 托管窗」缩成**薄客户端**：

| 角色 | 谁 | 关键点 |
|---|---|---|
| 生产者（每个 pi 会话一个） | 本扩展 | 只读 `<home>/port`、`GET /health`、`WS /feed`、`POST /control`；`spawn` 只出现在「拉宿主」一处 |
| 服务端（整机一只） | 上游 `bin/pi-pet.cjs` | 单例锁 `<home>/host.lock`（mkdir）、端口写 `<home>/port`、状态写 `<home>/state.json` |
| 窗（整机一只） | 上游 Electron | 由服务端自己拉；`window:false` 时根本不拉 |

**三条铁律**（每条都对应本机真实报障）：

1. `spawn` 只许出现在拉宿主一处，且必须带 `mkdir` 启动锁 + 冷却 + 指数退避 + 每进程上限 —— 上一场「pet 自启动脚本会无限启动 bun 导致电脑卡死」就是这里没有闸。
2. 探活链路**零进程**：只读 `state.json` / `port` + `GET /health`。`process.execPath` **绝不能**当 node 跑 CLI —— 本机 pi 是 Bun 打包单文件（111MB），pi 会把脚本路径当 prompt 的位置参数，然后开一整个 TUI 会话挂在那儿（机器看着像「卡死」）。
3. **永不写** `~/.pi/agent/state/pi-pet-global.json`：上游 `foreignStateFiles()` 会把外部状态文件当成「别的宿主」，于是两个宿主互相认定对方活着 → 谁也不自启、谁也不退。本扩展只读 `<home>/` 下的文件 + `ctrl.json`。

配置 `~/.pi/agent/extensions/pi-dsh-pet.json`（默认启用；**0.0.1 的旧键已迁移**，原件留在同目录 `pi-dsh-pet.json.bak-v0.0.1`）：

```json
{ "autostart": true, "feed": true, "size": "normal", "maxPets": 1, "keepAlive": true, "window": true, "port": 0 }
```

- `autostart: false` → 不自动拉宿主（仍可 `/pet` 手动拉）；**只认显式 `false`**，写错类型（如 `"false"`）仍按启用算，避免宠物莫名消失。
- `feed: false` → 本会话不喂事件（宠物照常自己动）。
- `size` / `maxPets` / `keepAlive` / `window` → 写进上游 `<home>/ctrl.json`（服务端每 2s 读一次当控制通道；`desired:false` 由**服务端自己**关窗退出并放锁，别的进程不伸手 `taskkill`）。`maxPets` 1–8，超界报清范围。
- `window: false` → 拉宿主用 **`serve`**（只起服务不开窗，等价旧的 `start --no-window`）；`true` → `start`（前台带窗，服务端靠 `keepAlive()` 不退出）。
- `port: 0` → 拉宿主**不传** `--port`，由服务端自己挑（默认 47653，被占退随机）。**别把旧版的 `port` 搬过来**：那版指的是扩展自己那个 HTTP 桥的端口，现在归服务端，写死平白多一种「端口被占 → 退出码 4」。
- `startTimeoutMs`（默认 12s）/ `maxStartAttempts`（默认 3）/ `reapStrays`（整机野进程清理，默认开）/ `node`（跑服务端的运行时：config > `PI_PET_NODE` > PATH 上的 node > bun；**绝不是 pi 自己**）/ `home`（覆盖 `<home>`，默认 `%APPDATA%/pi-dsh-pet`）。
- 文件缺失 / 读坏 = 按**启用**处理（读坏会 `notify` 一次），与其他钩子扩展同一套约定。
- 会话内随手切：`/pet-auto on|off|size <档位>|max <只数>|restart|status`，改动写回同一个 json（并同步 `ctrl.json`）。
- 旧键 `delayMs` / `bridge` / `host` / `sweepMs` / `hostRuntime` 随旧架构作废（新扩展读都不读）；`/pet-auto cleanup|host|bridge` 同样作废 —— 单例与数量现在由服务端自己的锁 + `maxPets` 转发闸兜住（§3.6.1）。

#### 3.6.1 「只许一只」现在由谁兜

| 关口 | 归谁 | 怎么拦 |
|---|---|---|
| 两个 pi 会话同时拉宿主 | 本扩展 | `mkdir` 启动锁 `<state>/boot.lock`：抢不到就只等对方公布端口（`waitForHost`），**不 spawn** |
| 宿主之间 | 上游服务端 | `<home>/host.lock`（mkdir + `owner.json`）；主人 pid 活着就安静退出（让位），死了才接管 |
| 一扇窗里 `add_pet` | 上游服务端 | `maxPets<=1` 时转发层直接丢 `add_pet*` 帧，任何会话、任何旧路都绕不过 |
| 没人管时冒出来的野宿主 | 本扩展 | `reapStrays` 每 10 分钟整机扫一次，**只杀命令行含 `pi-pet.cjs` 的 `pi.exe`**（绝不碰当前会话的 pi.exe；判定用 `-match 'pi-pet\.cjs'`） |

本扩展**不再**扫窗（`pet-electron.cjs <port>` 那套 PowerShell/CIM 扫描连同它的四个 bug 一起退休）：窗归服务端管，扩展看不见也不该去动。

**零 token 成本（实测）**：两个扩展都**不注册工具**，不进 `defaultTools`（§3.4 硬规则）。装完跑 bench：system 3026B + tools 2638B（5 个）= **5664B，与装之前逐字节一致**。

**安装路径的坑**：上游 README 写 `npm install -g pi-dsh-pet`，但 **pi 不扫全局 `node_modules`** —— 只全局装的话 `/pet` 根本不存在。必须在 pi 里注册一次。本机 2026-09-30 换成 git 源：`pi remove npm:pi-dsh-pet` + `pi install git:github.com/qq458249269/pi-dsh-pet`（两份同时声明会被当两个包各加载一次，必须先 remove；`pi remove` 报 `EBUSY` 说明还有 Electron 窗占着旧目录 —— 先 `/pet-auto off` 或 `taskkill` 掉它）。装完落在 `~/.pi/agent/git/github.com/qq458249269/pi-dsh-pet`。

> **上游自带的扩展已禁用** —— 但**写法很关键**：必须在 `settings.json` 的 `packages` 里把 `pi-dsh-pet` 写成 **object form**（`{"source": "git:github.com/qq458249269/pi-dsh-pet", "extensions": []}`），**光写纯字符串 `git:github.com/...` 屏不掉上游扩展**（`extensions: []` 只筛 npm 包内的子扩展，对仓库顶层 `pi/extensions/index.ts` 无效 —— docs/packages.md「Select package resources」确认 1.1.0 支持 object form 的 `extensions` 选择）。
>
> | 写法 | 上游扩展 | 症状 |
> |---|---|---|
> | `"git:github.com/qq458249269/pi-dsh-pet"` | **照旧加载**（本机踩了一个月才发现） | 重复注册 `/pet` `/pet-stop` `/pet-say` `/pet-status`（本地薄客户端也注册同名 + `/pet-auto`）；多一条 `session_start → ensureHost()` 走 `state.json` 单一来源；终端刷 `[pi-dsh-pet] /feed 连接断开，2s 后重连`，headless 跑不完（§7.13 的 exit 124 噪音一半来自它） |
> | `{"source": "git:...", "extensions": []}` | **不加载** ✅ | 干净：`pi list` 该行显示 `git:github.com/qq458249269/pi-dsh-pet (filtered)`，终端只剩本地客户端的 `[pi-pet-autostart]` |
>
> 验证法（改完 `/reload` 后跑）：`timeout 70 pi --no-session -p "reply with: ok"` → 输出里应**不出现** `[pi-dsh-pet]` 前缀的行；`pi list` 应出现 `(filtered)` 且条目数不变（28）。上游源码留着做参考（`~/.pi/agent/git/github.com/qq458249269/pi-dsh-pet/pi/extensions/index.ts`），本机跑的是本地薄客户端。

**首次开窗要下 Electron ≈100MB**（上游在 Windows 自动设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）；包里 91 个透明 WebM，`assets/thumb` 解包 48MB。

这一轮重构定下的几条回归约束（历史探针随 `.sc-test/` 一起删除，改本扩展时按这几条自查）：**先打再探**（启动时零能力探测，命令失败才两个只读 GET）、**只有 `home/port` 也能复用宿主**（两宿主互锁的入场券）、**心跳陈旧不再单独判死**（`/health` + pid 才权威，陈旧且探不通才重拉）、**退出码翻译**（2 参数错 / 3 缺依赖 → `cd <pkg> && npm install` / 4 端口）、**一次 `/feed` 连接**（并发重连不许叠连接，见 §7.5）。回退：`pi remove git:github.com/qq458249269/pi-dsh-pet` + 删 `extensions/pi-pet-autostart.ts` 与 `pi-dsh-pet.json` 再 `/reload`。



#### 3.6.2 服务端契约（本扩展认的那份，2026-09-30 实测 0.0.2）

动词（`node bin/pi-pet.cjs <verb>`）：`serve`（= `start --no-window`，只起服务）/ `start`（前台带窗，`keepAlive()` 让它不退出）/ `status --json` / `stop` / `restart` / `feed` / `say` / `add` / `port`（**只打印端口，给脚本用**）/ `token` / `config` / `doctor`。退出码：`0` 正常、`1` 没在跑、`2` 参数错、`3` 依赖或资产缺失、`4` 端口问题 —— 扩展把子进程的退出码翻译成人话（并把原话留在 `~/.pi/agent/state/spawn-log.txt`，见下）。

| 文件 | 谁写 | 内容 |
|---|---|---|
| `<home>/port` | 服务端 | **端口真源**：一行数字。上游注释写明「pi 扩展 / dsh 插件 / 外部脚本读这一行就能连上」 |
| `<home>/token` | 服务端 | 鉴权口令，`Authorization: Bearer` 或 `?token=` |
| `<home>/state.json` | 服务端 | 本仓库宿主的额外记账（pid / port / token / windowState / heartbeatAt）；**没有它服务也在跑**，所以端口文件才是契约 |
| `<home>/ctrl.json` | 本扩展 | `desired` / `keepAlive` / `maxPets` / `size` / `window` / `restartNonce` |
| `<home>/host.lock/` | 服务端 | 整机单例锁（`owner.json` 带 pid）；主人死了下个来接管 |
| `~/.pi/agent/state/pi-pet-autostart.json` | 本扩展 | 自己的记账：冷却 `lastStartAt`、失败次数 `startAttempts`、野进程清理 `lastReapAt` |
| `~/.pi/agent/state/spawn-log.txt` | 本扩展 | 每次拉宿主的 stdout/stderr 尾（**落文件而不是管道**：服务端是前台应用，父会话退出后管道读端消失 → 它写 EPIPE 崩掉） |

**能力探测：先打再探，不预判**。`GET /control`（不带 action）只能回答「这个端点在不在」，回答不了「我这个动作行不行」；所以热路径上一次 POST 成功就完事，**失败之后**才做两个只读 GET（`/control` + `/event`，5s 缓存），用来判三种情况：外来/旧宿主**没有控制面**（404）→ `say` 退到事件面 `POST /event {type:"say"}`，其余动作说清「它只支持什么 + 怎么换成新宿主」；`401` → token 认错（多半是 `home` 认错了）；其余 → 把宿主自己的报错原样带出去。

> **上游 `probeCaps()` 在 0.0.2 上会把自己误判**（见 §7.5）：它要求 `GET /control` 回 400 **且 body 里有 hint**，而实测真宿主回的是 400 + **空 body** `{}`（带 hint 的那条只在 POST 分支）。照抄它的判据 = 「`/pet` 永远叫不出窗」，也就是本轮报障里的「拉不起来 pet」。本扩展的判据放宽到「非 404」。

**真机实测（已装副本，2026-09-30 晚）**：

```
session_start → 宿主 658ms 起来：pid 22652 port 47653 windowState=starting
/feed 接上：feeds=1 · {"pi-37780":1}
/pet-status → 宿主：pid 22652 :47653（端口来源 state.json，<home>/port 写的是 47653）· 窗：connected pid 39312 · 换窗 1 次
              生产者：feeds 1 · 能力：控制面 有 · 事件面 有 · 鉴权 通过
              它支持的动作：shutdown | restart-window | add-pet | drop-pets | say | pause | resume | hide-window | show-window
/pet-say → 说：真机验证（一次 POST 成功，零 GET 探测）
pi-pet doctor → ✓ 版本 / ✓ 包根目录 / ✓ 窗脚本 / ✓ 素材目录 …
pi-pet stop → 宿主自己退出，state.json 清掉；整机无 pi.exe 野进程
```

`/pet-status` 会摊开：宿主在不在（pid / 端口 / **端口来源**：`state.json` 还是 `port` 文件）、窗与换窗次数、生产者数（`feeds` + `feedsBySource`）、能力面与可用动作、feed 桥状态（`connecting/open/closed` + 最近错误）、本扩展的冷却与失败次数、spawn 日志路径；子命令 `doctor` 直接转发上游自检（用户主动触发的一次进程，不违反「spawn 只出现在拉宿主一处」的自动链路约定）。

---

### 3.7 `pi-web-access`：`~/.pi/agent/web-search.json` 必写 `toolActivation`

```json
{ "toolActivation": "eager" }
```

**只有一个键，但少写就退化成 §7.4 那个坑。** 取值只有三种（写错值扩展启动即抛）：

| 值 | 行为 | 本机为什么用 |
|---|---|---|
| `eager`（本机） | 四工具从会话第一轮就 active，全程**没有** `web_enable` 加载器，也就不会中途改 active 集 | ✅ |
| `auto`（默认） | 看模型：模型没有「会话中途加工具免重算」的 compat 标记 → 走 eager 分支 | 行为随模型/provider 变，不确定 |
| `dynamic` | 永远先给一个 `web_enable` 加载器，模型调它才 `setActiveTools` | ❌ 就是 §7.4 卸掉它的原因 |

**别担心「eager = 每轮多背 11KB」** —— 本机 lazy-tools 会接手（2026-10-06 探针实测）：

| 时点 | active 工具集 |
|---|---|
| `session_start` | 51 个注册工具**全部**在列，含 `web_search` `source_check` `fetch_content` `get_search_content` |
| `before_agent_start`（lazy-tools 跑完） | `read,edit,write,bash,omnify` |

即：eager 保证了**不会出现 `web_enable`**（前缀掀不掀）；lazy-tools 保证它们**不上 wire**（§6.3 的瘦身取向不受影响）；要用时 `omnify` 按名捞回来代理执行。**实测全链路通**：新会话里 `omnify` 搜到 `web_search` 并执行，查 `pi.dev` 返回标题 `Pi.dev`。

**缓存实测（2026-10-06，eager 启用后）**：

| 指标 | 结果 |
|---|---|
| wire 体积（`before_provider_request` 实测） | system 2804B + tools 2490B = **5294B**，tools 只有 `read,edit,write,bash,omnify`，**四个 web 工具一个都不在 wire 上** |
| 中途 active 集变化（transcript `toolsAdded`） | 全会话**仅 1 条**（session_start 那次），用完 `web_search` 之后**没有第二条** |
| cacheRead 序列（read → omnify 搜 nodejs → read，4 个请求） | 143 → 2679 → 2953 → 3640，**单调上升，无塌方**（对比 §7.4 旧版：86016 → 1152） |

结论：eager 模式下缓存**没有**问题——掀缓存需要「会话中途换工具集」，而 eager + lazy-tools 的组合里根本不存在这个动作。

搜索源共 26 个（brave / tavily / exa / kimi / firecrawl / … / duckduckgo），**duckduckgo 无需 key**，其余在同一个 `web-search.json` 里填 key。命令：`/websearch` 走 provider 选择面板、`/search` 直搜、`/curator` 批量检索、`/google-account` 管 Google 登录态。

> ⚠️ **SSRF 与本机 TUN/fake-IP 代理的旧账**（2026-09-30 实测）：fake-IP 把 `github.com` 解析成 `127.0.0.1`，`fetch_content` 直接报 `Blocked internal address for github.com: 127.0.0.1`。要抓这类站需在配置里放 `ssrf.allowRanges`。本机复装后**未复测出网**（只验证了加载不报错）。

### 3.8 `pi-checkpoint`：三个已知边界（不是 bug，是设计）

| 边界 | 后果 | 对策 |
|---|---|---|
| 快照在内存，非 git 里的栈 | 重启 pi 后 `/checkpoint` 栈空（git ref 还在） | 同一 sessionId 恢复会话时编号从最高 ref 续，不会覆盖旧点 |
| `/undo` 走 `git checkout <ref> -- .` | **只还原已跟踪文件**；该轮新增的未跟踪文件会留在原地，该轮新 `git add` 进索引的文件也留在原地 | undo 后自己扫一眼 `git status` |
| ref 按 commit date 剪 | 超过 **30 天**的快照被永久删 | 跨月的事别指望 `/undo` |

非 git 仓库里三个命令静默 no-op + 一条通知。另外它会写 `refs/pi-checkpoints/*`，不碰你的分支、tag、stash —— `git for-each-ref refs/pi-checkpoints` 可见。

### 3.9 `bash-prelude.sh`：每条 bash 命令前的兼容层（**必做，原文档漏记**）

`~/.pi/agent/settings.json` 里：

```json
"shellCommandPrefix": "source ~/.pi/agent/bash-prelude.sh"
```

`~/.pi/agent/bash-prelude.sh`（canonical 在仓库 `config/agent/bash-prelude.sh`，393B，由 `node install-project-config.mjs` 拷入；下为全文）：

```bash
# pi 的 Bash 工具用 `bash -c` 跑，不加载任何交互式启动文件；cmd.exe 习惯写的
# `cd /d D:/path` 到 bash 里是「内建 cd 收到两个参数」→ bash: cd: too many arguments。
# MSYS/MINGW64 下那个 /d 是 drive-D 挂载点而非 /d 开关，所以丢掉它永远是对的意图。
cd() {
	if [ "$#" -gt 1 ] && [ "$1" = "/d" ]; then
		shift
	fi
	builtin cd "$@"
}
```

- 只处理**独立**的 `/d` token：`cd /d/AI`（真路径）原样不动。
- **双向兼容 cmd 习惯**：既让 `cd /d D:/path` 能用，也不碰 bash 自己的 `cd` 语义（`builtin cd` 转发）。
- **别删**。删了以后每次 bash 里手写 `cd /d ...` 就报 `too many arguments`；而这个函数还会覆盖 bash 函数定义，必须跟本机 bash-guard 扩展的路径约定（正斜杠）配套。
- 写新前缀时的纪律：**保持快、无交互、不输出**（它在**每一条**命令前执行；`cd` 别加 echo）。

### 3.10 关闭内建 MCP：`"extensions": ["-builtin:mcp"]`（**必做**）

```json
"extensions": ["-builtin:mcp"]
```

- 本机**没有** `.mcp.json`（也没有任何 MCP server 配置），但内建 `mcp` 工具默认注册；`pi-mcp-adapter`（5.1.0）会接管它并接管 MCP 生命周期，**不需要**内建那份，两份共存会重复注册。
- 删掉这一行 → `mcp` 工具由 `pi-mcp-adapter` 正常提供，只是当前 0 个 server（`/mcp` 可查）。
- 留档：`~/.pi/agent/mcp-onboarding.json` = `{"version": 1, "sharedConfigHintShown": false, "setupCompleted": false, "piBuiltinMcpHandledVersion": "5.1.0"}` —— 内建 MCP 引导向导的完成标记；`setupCompleted: false` + `sharedConfigHintShown: false` 是**刻意保持**（不弹共享配置提示）。**不要手写这个文件**，它是向导自己维护的。

### 3.11 用户级 `settings.json` 备忘（非默认项，2026-10-09 实况）

以下都是本机**有意设的非默认值**，重建环境时漏写就会掉行为（已逐项实测生效）：

| 键 | 值 | 作用 / 备注 |
|---|---|---|
| `defaultThinkingLevel` | `"high"` | 默认思考强度 |
| `shellCommandPrefix` | `"source ~/.pi/agent/bash-prelude.sh"` | §3.9 |
| `extensions` | `["-builtin:mcp"]` | §3.10 |
| `defaultTools` | `["read","edit","write","bash"]` | §3.4 / §3.5（项目级同值） |
| `cacheWarming` | `"streaming"` | 流式 warmup |
| `compaction` | `{"enabled": true, "reserveTokens": 32768, "keepRecentTokens": 8000}` | 自动压缩开；预留 32K + 保留最近 8K（128K 窗下偏保守，且让 `pi-cache-compact` 有足够摘要空间） |
| `markdown.mermaid` | `"streaming"` | mermaid 流式渲染 |
| `whimsical` | `{"enabled": true, "weights": {A:15,B:10,C:10,D:15,E:0,F:25,G:25}, "spinnerPreset": "sleekOrbit"}` | 思考动画权重（`E:0` 是故意关掉某个效果） |
| `tuiMode` | `"fullscreen"` | 全屏 TUI |
| `doubleEscapeAction` | `"tree"` | 双击 ESC 打开文件树 |
| `httpIdleTimeoutMs` | `0` | 关闭 HTTP 空闲超时（长请求不被砍） |
| `images.blockImages` | `true` | 模型侧不传图 |
| `showHardwareCursor` | `true` / `fullscreenCopyOnSelect` | 光标形状 / 选中即复制 |
| `hideThinkingBlock` | `true` / `quietStartup` | 隐藏思考块 / 安静启动 |
| `showCacheMissNotices` | `true` | 缓存未命中提示 |
| `terminal` | `{"showTerminalProgress": true, "clearOnShrink": true}` | 终端区域进度条 |
| `defaultProjectTrust` | `"always"` | 不逐项目确认信任 |
| `theme` | `"light/dark"` | 跟随系统 |
| `defaultModel` / `defaultProvider` | `"1"` / `"1"` | 本地代理（模型名就是 `1`） |

> `lastChangelogVersion: "1.1.0"`、`collapseChangelog: true`、`treeFilterMode: "default"` 是宿主自维护的，不要手改。
> 改完 `settings.json` 一律 **`/reload`**（本会话不重启）——但注意：**会话中途改 `packages`/`extensions` 会改变已开扩展的加载面**，顺序是先改配置再开新会话（§9.6 教训）。

---

## 4. 工具归属（谁注册了什么）

| 扩展 | 工具 |
|---|---|
| 内建 pi | `read` `write` `bash` `powershell` `edit` `grep` `find` `ls`（受 `defaultTools` 闸门控制） |
| `@tian.zuo/pi-find` | `grep` `find`（覆盖内建） |
| `pi-fd`（本地 `extensions/pi-fd.ts`） | `fd`（能力上取代 pi-find 的 `find`，见 §4.1；本机懒加载） |
| `@aboutlo/pi-smart-edit` | `edit`（覆盖内建），匹配走「精确 → NFKC 归一化行」，容忍引号/空白差异 |
| `@trycedar/pi-mdiff` | `md_inspect` `md_diff` `md_edit` |
| `pi-dsh-pet` | 无工具（`/pet` `/pet-stop`；HTTP+WS 服务只把 agent 事件转发给 Electron） |
| `pi-pet-autostart`（本地 `extensions/pi-pet-autostart.ts`） | 无工具（`session_start` 钩子 + `/pet-auto` 命令） |
| `@henryqw/pi-ask-question` | `ask_question` |
| `@ssk_dev/rpiv-todo-lean` | `todo` |
| `@agenticup/pi-loop` | `loop` |
| `@arhen/pi-core-subagent` | `subagent` 及 status/await/steer/reply/result |
| `pi-mcp-adapter` | `mcp` |
| `pi-web-access` | `web_search` `source_check` `fetch_content` `get_search_content`（`eager` 模式**不注册** `web_enable`；四个都被 lazy-tools 藏起来，靠 `omnify` 捞，实测能搜，见 §3.7） |
| `@bacnh85/pi-checkpoint` | 无工具（`/undo` `/redo` `/checkpoint` 命令） |
| `pi-notify` | 无工具（`agent_end` 钩子 → Windows toast / OSC） |

| `pi-test-runner` | 测试运行工具 |
| ~~`pi-budget-guard`~~ | **已卸载** 2026-10-08（与 pi-meter 重叠），见 §7.12 |
| ~~`pi-zvec`~~ | `zg_search` 等（**已卸载** 2026-10-08，见 §7.11） |
| `pi-ocr` | OCR 工具 |
| `@chendpoc/pi-memory` | 记忆工具 + 生命周期钩子 |
| `pi-secret-guard` / `pi-mono-context-guard` | 无工具（拦截钩子 + 命令） |
| `pi-meter` | 1 个工具 + 预算命令 |
| ~~`pi-deepseek-cache`~~ | **已卸载** 2026-10-09（全部功能绑定 DeepSeek 后端），见 §7.13 |
| `pi-cache-compact` | 无工具（纯 `session_before_compact` 钩子；拒绝接管时打一行终端通知） |
| `@narumitw/pi-plan-mode` | 工具 + `/plan` 模式切换 |
| `pi-agent-browser-native` | `agent_browser` 及 7 个配套 |
| `pi-lazy-tools`（fork） | `omnify`（0.4.0 起四合一；`load_tools`/`call_tool` 已撤。只代理执行、**不切 active 集**） |
| ~~`pi-warm-cache`~~ | **已卸载** 2026-10-08（本机不生效的死安装），见 §7.12 |
| `pi-prefix-stabilizer` / `pi-cache-compact` / `pi-cache-guardian` | 无工具（纯事件钩子） |

**一道闸：`defaultTools`**（0.4.0 前是「`defaultTools` 管注册 + `resident` 管常驻」两道，0.4.0 起合并）：

| 工具 | 在 `defaultTools` 里？ | 后果 |
|---|---|---|
| `read` `write` `edit` `bash` | ✅ 在列 | 纯内建：不在列就不注册；本机就到这四个为止 |
| `grep` | ❌ 未列 → 懒加载 | pi-find 注册（扩展不占注册闸）；`omnify` 可搜出并执行 |
| `fd` | ❌ 未列 → 懒加载 | 本地 `pi-fd` 注册，同上 |
| `find` | ❌ 未列 → 懒加载 | 同一底层（fd）但只认 glob，作为 `fd` 的兜底 |
| `ls` `powershell` | ❌ 未列 → 懒加载 | 需要时 `omnify` 按名 load 回来（或用 `bash ls`） |
| `todo` / `loop` / `md_*` / `ask_question` / `mcp` / `agent_browser*` / `web_*` | ❌ 未列 | 全部默认懒加载，用 `omnify` 按需检索 / 代理执行（`web_*` 除外：它们是 eager，被 lazy-tools 藏而非闸门挡，见 §3.7） |
| `omnify` | ❌ 写不写都一样 | pi 核心无条件注册，**不需进名单**，写进去只是读起来清楚 |

漏了的后果（实测）：`defaultTools` 是内建工具的**注册闸**（不在列 → 根本注册），对扩展工具则是**常驻名单**（不在列 → 注册了但被 lazy 隐藏，wire 上看不到；要它时 `omnify` 一步拾回）。

### 4.1 `find` → `fd`（本仓库 `extensions/pi-fd.ts`）

`@tian.zuo/pi-find` 的 `find` **底层本来就是 fd**（`lib/tools.ts` 里 exec `fd`），但只开了 glob 模式的一层薄壳：`pattern` + `path` 两个参数。于是这些都做不到，而它们在 fd 里都是一行参数：

| 需求 | `find`（旧） | `fd`（现） |
|---|---|---|
| 列出全部 `.ts` | 必须编个 glob | `{type:"file", extension:"ts"}`（**pattern 可省略**） |
| 最近改过的 | 做不到 | `{changedWithin:"1d"}` |
| 区分文件/目录/可执行文件 | 做不到 | `{type:"directory"}` 等 |
| 正则匹配路径 | 做不到（只有 glob） | pattern 即正则，且 smart case |
| 限深度 | 做不到 | `{maxDepth:2}` |

**接线**：`fd` 不写进 `defaultTools`（与 `grep` 一样走懒加载，需要时 `omnify` 一步激活）；项目级与用户级两处都只保留内建默认 4 个。`pi-find` 仍在装（提供 `grep`），它的 `find` 作为 `fd` 的 glob 版兜底。

**超时参数（2026-10-09 加，§5 铁律二）**：`fd` 多一个 `timeoutMs`，默认 30s、硬上限 120s（`resolveTimeoutMs()` 夹取，非法值回落默认）；schema 的 `minimum`/`maximum`、参数描述、`promptGuidelines` 三处都写了「必须显式传」。超时按部分结果处理（kill + 附 `[Search timed out …]` 提示），不静默截断。上游 pi-find 的 `find`/`grep` 是写死 30s，所以三家口径一致。

**常驻 vs 懒加载的代价（实测）**：`fd` 若常驻，单它就 1280B + system 多一行简介与 guideline；若懒加载，0 upfront。**本机选懒加载**（`fd` 与 `grep` 都不在名单里），见 §3.4 / §6.3。

**fd 的两个反直觉点（已踩，代码里有注释）**：

1. **省略 pattern 时必须显式传空串**。否则唯一的 position 会被 fd 当成 pattern（`fd -t d .git` 返回空，`fd -t d "" .git` 才出结果）——「列出全部」是这个工具的主卖点。
2. **`--glob` 是「把 pattern 换成 glob」，不是额外过滤器**。glob 模式下再传位置 pattern 会被 fd 当成第二个搜索路径（报 `Search path 'capture' is not a directory`）。故工具里 `glob` 与 `pattern` 互斥。

**默认排除编译目录（2026-10-10 加）**：`node_modules dist build out target coverage __pycache__ vendor venv Pods DerivedData bower_components cmake-build-debug cmake-build-release`。
起因：fd 默认只做两件事（尊重 `.gitignore`、跳 hidden），而这两条**盖不住编译目录**——它们既不是 hidden，也常常不在 `.gitignore` 里（本仓库的 `.gitignore` 就只写了 `.sc-test/` `.zvec-grep/` `.pi/`），于是照样一层层往下爬。
**实测 28 → 12 条**。新增 `exclude`（追加）与 `noDefaultExcludes`（整体关闭）。
> **正确性保证（已实测）**：`--exclude` **只剪枝遍历、不剪搜索根**——`{path:"dist"}` 仍能搜出 `dist/static/s.css`。所以「进 dist 里找文件」这种正当需求不会被误伤；真要按名字找编译目录本身、或彻底关掉，用 `noDefaultExcludes`。
> **只列非 hidden**：`.next/.nuxt/.venv/.turbo` 这些 fd 本就跳（除非 `hidden:true`），列进来是冗余。

**另建 fd 全局 ignore 文件 `%APPDATA%\fd\ignore`**（`~/.config/fd/ignore` 是 POSIX 写法），内容与上表一致。好处：手工敲的 `fd`、以及 `~/.bashrc` 里 `alias find='fd'` 的交互式 shell 都自动生效，不依赖本扩展。
> ⚠️ 但它**只在 fd 被调用时生效**，且同样**只在 git 仓库内认 `.gitignore`**——家目录 / `C:\Windows` 下依旧无效（见 §5 规则 E）。

**验证**：`/fd-check`（fd 可执行文件解析）。回归：`.sc-test/probe-fd.mjs`。回退：删 `extensions/pi-fd.ts` 再 `/reload`（`fd` 懒加载与否都不影响其余工具）。

---

### 4.2 ~~全局禁用 `find`~~（**已卸载 2026-10-08**：本机恢复 `find`，4 层封锁全撤；卸载记录见 §7.9，以下为历史留档，勿再照着启用）

**为什么要禁**（⚠️ 下方第一条已被 2026-10-10 实测推翻，保留原文以备查）：本机 `find` 有两个不同的东西，症状都是「卡死」：
- ~~`C:\Windows\System32\find.exe`（cmd/PowerShell 里的 FIND.EXE）：语法与 GNU find 完全不同，`find . -name x` 被当成「pattern + 无文件名」→ **从 stdin 读**，表现就是永远不返回；~~
  > **2026-10-10 实测纠正：本机这条不成立。** PowerShell 的 PATH 顺序是 `C:\Program Files\Git\usr\bin` **排在** `C:\Windows\system32` **前面**，
  > 所以 `powershell` 里的 `find` 解析到的是 **Git 的 GNU find**（`Get-Command find` 实测 `Source = C:\Program Files\Git\usr\bin\find.exe`）。
  > 裸 `find` 实测立即返回（打印 490 行），**不挂 stdin**。真正的真凶是另一个东西——见下方「几小时的真凶」。
- Git Bash 的 `/usr/bin/find`：语法对，但没有 ignore/类型/深度过滤，在大目录树上能跑几分钟（`find .` 从家目录起步就够呛）。

**⚠️ 几小时的真凶（2026-10-10 定位，与上面的猜测不同）**：不是「System32 find 读 stdin」，而是
**`powershell` 工具没有 `timeout` 参数**（§5 表里已记「注入不了」）。裸 `find` = `find .` = 从当前目录
**递归打印整棵树**，无任何剪枝；放到大仓 / 家目录 / 系统盘就是几小时。bash 侧没这问题——守卫会把
`find`/`find.exe` 归入搜索档、30s 默认超时（实测 `judgeBashCommand("find.exe . -maxdepth 6") → 30`）。
**换 fd 也不会自动好**：见 §4.1 尾注——fd 的 ignore 规则在非 git 目录同样失效，真正要治的是**搜索根**，已由 §5 规则 E 拦。

**四层封锁**（前两层管模型，后两层管你自己）：

| 层 | 位置 | 覆盖 | 实测 |
|---|---|---|---|
管道后 `\| find`）
| bash（全局） | 用户环境变量 `BASH_ENV=C:\Users\yinxuehao\bin\no-find.sh`（非交互 `bash -c`）+ `~/.bashrc` 同款函数（交互） | 任何 bash，包括脚本 | `find` → 拒答 + exit 127；`fd` 正常 |
| cmd（交互） | `HKCU\...\Command Processor\AutoRun` 里的 doskey 宏 | 交互式 cmd 提示符 | doskey 宏**只在交互命令行展开**，`cmd /c` 不受影响 |
| PowerShell（交互） | `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` 里的 `function find` | 交互式 PowerShell | **本机没生效**：执行策略全是 `Undefined`（= 默认 `Restricted`），profile 根本不加载；要生效得 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`（安全策略变更，**没擅自改**） |

> `find.cmd`（`~/bin/find.cmd`）也备好了，但**默认盖不住 System32**：Windows 合并 PATH 是「机器 PATH 在前、用户 PATH 在后」，`~/bin` 在用户 PATH 里 → 只有当 `~/bin` 被排到 System32 之前（改机器 PATH，需管理员）才生效。要真在 `cmd /c` 里也拦，只能动机器 PATH 或改 System32 文件，**都没做**。

**判定规则**（`detectFindCommand`，可单测）：按 `;` `|` `&&` `||` 换行切段，递归摊开 `$( )` 与反引号，再剥掉 `sudo` / `env FOO=1` / `xargs` / `nohup` / 前置重定向，看每段**首词的 basename** 是否等于 `find` / `find.exe`。所以 `./find-helper.sh`、`findings.md`、`grep -rn "find me"`、`node scripts/find-them.js`、`fd`、`fdfind` 一律放行。

**开关**：`~/.pi/agent/extensions/no-find.json` → `{"enabled": false}` 整体停用；`{"allow": ["find -name *.go"]}` 按「首词 + 第二个词」前缀放行个别命令。配置坏了按「启用」处理（宁可多拦，不静默失效）。

~~**回退**…~~（已于 2026-10-08 执行：pi 内那层删扩展文件；全局那层按备份还原 `PATH` / `BASH_ENV`，见 §7.9）

**现状（2026-10-09，替代封锁的轻量做法）**：不再拦 `find`，改为 `~/.bashrc` 末尾一行 `alias find='fd'`——交互式 Git Bash 里 `find` 直接走 fd（尊重 `.gitignore`、默认排除 `.git`/`node_modules`，大目录树上快一个量级）。fd 用 pi 自带的 `C:\Users\yinxuehao\.pi\agent\bin\fd`（10.3.0），零安装。真 find 仍可 `/usr/bin/find` 调用；**脚本/CI 不受 alias 影响**（alias 只在交互 shell 展开），要快就在脚本里显式写 `fd`。非交互场景的慢 find 依旧存在——优化靠 `-maxdepth` / `-prune` / `-xdev`（见对话记录），不做全局封锁。

---

## 5. 使用纪律

**铁律：装机前先审「它运行时会不会动 active 工具集」。** 只要扩展在会话中途调 `pi.setActiveTools`（典型是 `pi-web-access` 的 `web_enable` 这类空参激活器），工具集一变，请求前缀从第 0 个 token 起整段作废——本机实测 `cacheRead` 从 86016 掉到 1152，等于每次首次激活都吃一发全量 prefill（§7.4）。所以只接受两种接入方式：① 常驻进 `defaultTools`（前缀恒定）；② 懒加载由 `omnify` 代理执行（只在 `session_start` 隐藏一次，全程不切 active 集，§7.4 尾注）。
- **凡「运行时增删工具」的扩展一律不装、不启用、不写进 `defaultTools`**——哪怕它的工具本身很有用（要联网搜就换 `agent_browser*` / `mcp` / `bash`，别为它掀缓存）。
- 审法：`read` 扩展源码搜 `setActiveTools` / `activeTools`；装完对比首请求的工具字节（口径见 §6），不一致就是它在散缓存。

**铁律二：所有命令都带超时**（2026-10-09 加，防止一条命令把会话卡几分钟）。

pi 内建 `bash` 工具的 `timeout` 参数是**可选且无默认值**，不传就是永远跑。本机用 `extensions/pi-bash-guard.ts`（只挂 `tool_call`，不注册工具）把它变成强制：按命令分档注入上限。

| 档 | 命中什么 | 默认 | 上限 |
|---|---|---|---|
| 搜索 | `find` `grep` `egrep` `fgrep` `rg` `ag` `ack` `fd` `fdfind`（按**流水线生产者**判，`find … \| head` 算搜索、`python x.py \| grep` 不算） | 30s | 120s |
| 构建 | `npm` `pnpm` `yarn` `pip` `cargo` `go` `make` `cmake` `docker` `tsc` `pytest` `jest` … 共约 70 个首词 | 1800s | 3600s |
| 其余 | 兜底一切（`ls` `cat` `git clone` `python x.py` …） | 300s | 3600s |

- **注入的是上限不是等待时间**，所以给大不亏；混合命令取最宽松那档（`npm run build && find dist -type f` → 1800s）。
- 模型自己显式传的 `timeout` 会被尊重，只夹到该档上限（`timeout: 600` 的 `find` → 120；`timeout: 7200` 的 `npm ci` → 3600）。**单位是秒**。
- 整条都被 coreutils `timeout` 包住时守卫不插手（作者自己管了）。要包就写 `timeout -k 2s 30s …`：只 TERM 直接子进程，不 `-k` 可能被抗住，且绕开 pi 的 killProcessTree。
- 搜索类被后台化（`&` / `nohup` / `setsid`）→ **block**：它本该秒回，却能活过超时（见下表最后一行）。

**另一类不是「太久」而是「永远不返回」→ 直接 block**（给 timeout 也只是白等一个上限，期间零输出）：
编辑器（`vim` `nano` `emacs`…）、分页器/监视器（`less` `top` `watch` `tail -f` `journalctl -f`…）、交互客户端（`ssh` `mysql` `psql` `sqlite3`…）、光杆 REPL（`python` / `node` 不带参数）、前台服务（`npm run dev|start|serve|preview`、`python -m http.server`、不带 `-d`/`--rm` 的 `docker run`）。
替代写法：把有产出的部分放前台跑（先 build/test，再查结果）；真需要常驻进程就显式 `… &` 起来、之后用另一条命令轮询。

**第三类：搜索根选错 → block（2026-10-10 加，`OVERSIZED_ROOTS`）**。比「命令慢」更隐蔽：它不报错、不超时，
就是不报错地返回一堆无关结果。本机实测量级：

| 目录 | 文件数 | fd 实测 |
|---|---|---|
| `AppData/Local` | 194,968 | — |
| `AppData/Roaming` | 137,869 | 2.6s |
| `C:\Windows` | 345,409 | 16.2s |
| `find ~ -maxdepth 6` | — | **60s 封顶都跑不完** |

> **关键：fd 的 ignore 规则在这些目录里同样不生效**——`.gitignore` 只在 git 仓库内认，而家目录 / 系统盘不是仓库（实测用户目录下无任何 `.gitignore`）。所以「换 fd 就快」这个前提在这些目录**不成立**；fd 只是快到能在超时内返回，结果仍是噪声。故此规则拦的是**搜索根**（`~` / `~/AppData` / `C:\Users\me` / `/c/Users/me` / `/home/me` / `C:\Windows` / `Program Files` / 盘根 `/` `/c/`），**不是命令名**。

配套实验（§4.1 尾注）证明了另一件事：**`-maxdepth` 不但没加速，还会让 find 答错**。node_modules 嵌 12 层的树上，`find . -maxdepth 6 -name '*.ts'` 返回 **0 条**（深度全花在爬 node_modules），`fd -t f -e ts .` 返回 **50 条**——所以「用 maxdepth 治慢」是饮鸩止渴。

**超时之后命令真的结束了吗（这一层的机制，2026-10-09 实测源码）**：

| 问题 | 答案 |
|---|---|
| pi 超时后会不会 kill？ | 会。`dist/core/tools/bash.js` 在 `timeout` 到点 / `signal` abort 时都调 `killProcessTree(pid)` |
| 杀的范围？ | Windows：`System32/taskkill.exe /F /T /PID`（整棵子进程树，强杀）；POSIX：`kill(-pid, "SIGKILL")`（bash 是 `detached` 的进程组，整组） |
| 默认有超时吗？ | **没有**。`timeout: Type.Optional(... "optional, no default timeout")`——这就是守卫存在的全部理由 |
| 什么会逃掉 kill？ | 只有 `cmd &` / `nohup` / `setsid`：shell 立即返回 → pi 清掉 timeout 计时器并注销 pid 追踪，命令在工具返回后继续跑，没人再管。故搜索类这么写直接 block |
| `fd` 工具超时？ | 自己的 `execFile({timeout})`，无子进程所以 kill 即干净；漏传 `timeoutMs` 时守卫会补 30_000 |
| `powershell` 工具超时？ | **无此参数**，注入不了。里面的 `find` 实测是 Git 的 GNU find（§4.2 纠正），不是 System32 那个读 stdin 的 → **唯一的治法是别裸跑 `find`**，硬约束只能靠文字纪律 |

搜文件的其余三条路（与超时无关，但同一节纪律）：`fd` 工具每次显式传 `timeoutMs`（毫秒，1s–120s，默认 30s，见 §4.1）；`find`/`grep` 工具（pi-find）自带 30s 硬超时但**必须缩范围**（`path`/`glob`）；大目录树先 `-maxdepth`/`-prune`/`-xdev`，或直接换 `fd`（尊重 `.gitignore`，默认跳 `.git`/`node_modules`）。超时提示出现时不要重跑同一条命令：先缩范围，再谈调大预算。

回归用例（54 例：三档默认值与上限、显式值夹取、管道生产者、`sudo`/`&&`/重定向、自带 timeout、永不返回的 block、`docker run --rm` 不误伤、`./find-helper.sh`/`findings.md`/`awk`/`git status` 不误伤）原先在 `.sc-test/probe-bash-guard.mjs`，**该文件已不存在**（`.sc-test/` 不入库，随清理丢了）——改 bash-guard 时按这份清单重写用例。


0. **新装扩展一律不进常驻集**（硬规则）
   - 理由：常驻集每轮都进 prompt（`grep`+`find` 就要 +1350B ≈ 350 tok），而多数扩展一天用不到几次。
   - **只有这三类才加常驻**：① 高频工具（见 §6.3 的取舍）；② 覆盖内建工具的（`grep`/`find`/`edit` 需先过 `defaultTools` 闸）；③ 缺失后 agent 会“瘫”的（如 `bash`）。
   - 例外：无。`grep` / `fd` 也只是「需要时 `omnify` 激活」，不进名单（§6.3）。
- 验证新装扩展是否真的零开销：看首请求的工具字节是否与基线一致（口径见 §6）。
1. **首字成本**：常驻集每轮都进 prompt；不在名单的工具靠 `omnify` 检索命中后**代理执行**（不把 schema 注入 active 集，见上面铁律）。
2. **激活往返**：0.86+ 流程是 `omnify`/`load_tools` → `call_tool` → 执行，多 1–2 个模型轮次。搜索类工具建议常驻（见 §6.3）。
3. **大输出工具**（`agent_browser*` / `mcp`，或 bash 直接抓页面）原始 HTML/JSON 全量进历史，会把前缀命中率打崩；用前先想清楚要不要落历史。
4. **改 `.md` 优先 `md_edit`**：散文/列表用 `md_edit`（锚定标题+块序号，不受换行重排影响），代码块用 `edit`，`.mdx` 一律用 `edit`。
~~`pi-deepseek-cache`（绑定 DeepSeek）~~ **2026-10-09 已卸**（§7.13）：实测遥测半边可用、压缩半边必败（接管条件 `ctx.modelRegistry.find("deepseek", …)` 在本机注册表里根本没有 deepseek provider，代理也拒 `deepseek-flash` 这个模型 ID），按 DeepSeek 价格表换算的「省钱估算」属虚构。**要压缩缓存就装 `pi-cache-compact`**（provider 无关，§7.13 实测命中 68.6%）。
6. **纯 UI 类扩展可以放心装**：`pi-tps` / `pi-one-ui` / `pi-dsh-pet` / `pi-pet-autostart` 这类只挂事件钩子、只注册命令的扩展，**不注册任何工具**，不进 `defaultTools`，wire 字节不变（§3.6 有 bench 实测：装宠物前后都是 5664B）。反过来，任何**注册工具**的扩展都要重新算 §6.3 那笔账。

---

## 6. 首字 token 优化（全部 wire 实测）

测量方式：沙箱（`PI_CODING_AGENT_DIR` 隔离 + junction 复用 npm/git/skills）+ mock OpenAI provider 抓**真实首请求字节**，再用真网关取 token 计数交叉验证。校准：**1 token ≈ 3.85B**。

### 6.1 手册「三步优化」在 0.87.1 上的真实收益

| 场景 | system | tools | 合计 | vs 基线 |
|---|---|---|---|---|
| 基线（5 工具） | 6758B | 4593B | 11351B | — |
| 只上 `pi-lean-prompt` | 6758B | 3043B | 9801B | **−1550B** |
| 只上 `pi-shell`（**已删除**） | 6794B | 4713B | 11507B | **+156B**（反而变大） |
| 手册全套（lean + shell） | 6794B | 3163B | 9957B | **−1394B / −12.3%**（≈ −362 tok/请求） |

- **第一步（压 Guidelines / Pi documentation）是 no-op**：`pi-lean-prompt` 见 `sections` 存在就 return（0.86+ 让路）；且其正则找的是 0.85 版那两个独立段落，0.87 的提示词里已不存在。
- **第三步单独是负收益**：`bash` 543B → `shell` 663B。只在与第二步叠加后才净赚 → **结论：这一步不做**，`pi-shell.ts` 已删（2026-09-28 五次），改用内建 `bash`。
- **真正有效的是第二步**（`edit` 2030→646B、`read` 684→518B），且只改文字不动结构，零副作用。

### 6.2 大头在 system：`<docs>` + `<skills>` 压缩（`pi-lean-sections.ts`）

| 改动 | wire system |
|---|---|
| 基线 | 6897B |
| 压 `<skills>`（2655B → 99B，单行改用 omnify 检索） | 4255B |
| 压 `<docs>`（655B → 256B，从原文抽路径重排） | 5869B |
| **两者都压（本机现状）** | **3556B（−3341B / −48%）** |

> **本机现状（2026-09-30，卸载 `pi-web-access` 后重测）**：常驻集 = pi 内置默认 4 个（§3.4）→ wire 上 **5 个工具** `bash edit omnify read write`，system **3026B** + tools **2638B** = **5664B ≈ 1573 tok/请求**（vs 优化前 11351B ≈ 2948 tok，**累计 −5687B ≈ −1477 tok / −50%**）。`grep` / `fd` 仍注册，按需 `omnify` **代理执行**——omnify 走 jiti 直接执行、**不切 active 集**，所以不会像 `web_enable` 那样掀前缀缓存（§7.4）。

连续 3 轮字节完全一致（轮间稳定，不散前缀缓存）。

**踩过的坑，写在这里免得重蹈**：

- **`before_agent_start` 的 `sections` 只有第一个注册的 handler 改得动。** 实测：先注册的探针看到空对象且它的赋值进 wire；后注册的拿到的是**已填充的独立副本**，改它无效、`return { systemPrompt }` 也无效。`pi-lazy-tools` fork 正占着「第一个」的位置（packages 源先于用户目录加载），所以它写在 `sections` 里的压缩**从未生效**——这就是本机 system 长期 6.9KB 的根因。
- **`before_provider_request` 的 `payload` 是共享可变的**（system 消息就在 `payload.messages` 里，`{role:"system", content:"<整串>"}`），在 wire 上改与加载顺序无关 → 本扩展走这条路。
- **不要压 `<rules>`**：单改 rules 块时落位正确（6897→5536B），但一旦与 docs/skills 同时改，pi 会把 rules 正文挪进 agent 文件段、把工具一行式塞进 `<rules>`，条目与续行错配。基线本身也有块间重排（`<tools>`/`<rules>` 内容逐轮互换、工具一行式本来就混在 agent 段里），属 pi 侧不确定性，不去碰它。
- **不要压 `<tools>`**：那段由 pi 按当前 active 工具动态生成，压它就得自己重建工具表，容易与实际 active 集脱节。

### 6.3 搜索类工具常驻的代价

| 场景 | system | tools | 合计 | vs 同基线 |
|---|---|---|---|---|
| 手册全套 + 常驻 grep/find/ls | 6897B | 4988B（9 个） | 11885B | **+1928B ≈ +500 tok/请求** |
| 常驻 grep+find（`ls` 懒加载，内建 `bash`） | 3050B | 4336B（8 个） | 7386B | vs 本机 **+1722B ≈ +447 tok/请求** |
| 常驻 grep+fd | 3205B | 5112B（8 个） | 8317B | vs 本机 **+2653B ≈ +689 tok/请求** |
| **本机现状**（只留内建默认 4 个） | 3026B | 2638B（5 个） | 5664B | — |

单工具 wire 字节：`grep` 846B、`fd` 1280B、`ls` 472B（`find` 若常驻是 504B）。

- **常驻**：每请求 +473 tok（首请求全价，之后走 cacheRead，本机本地端点基本免费），换搜索工具**直接可调、0 额外往返**。
- **懒加载**：0 upfront；要用时多 1–2 个模型轮次，并把同样的字节永久注入历史。
- **本机取舍（最终：只留内建默认 4 个）**：`defaultTools` 就是 `read edit write bash`，`grep` / `fd` / `ls` / `find` 全部懒加载，搜文件先 `omnify` 一步代理执行。**省 2653B ≈ 689 tok/请求**，代价是每次搜索多 1–2 个往返轮次（本机本地端点，这些轮次几乎不花钱，只花时间）。
  - 曾经选过方案 B（`grep` + `fd` 都常驻，8317B）：那时判断「搜索是编码高频操作，省轮次比省字节值」；现按「只保留默认」收敛，**要回退就把 `"grep"` / `"fd"` 加回两处 `defaultTools` 即可**（+2653B）。
  - 无论常驻与否，`fd` 的能力都远胜 pi-find 的 `find`（§4.1 五项），常驻与否只影响字节与往返，不影响能力。

### 6.4 优化后的静态前缀总账

`system 3026B + tools 2638B = 5664B ≈ 1.5k tok/请求`，相比优化前 `6758 + 4593 = 11351B ≈ 2.9k tok`，**累计 −50%**。

> 2026-09-29 装 `pi-dsh-pet` + `pi-pet-autostart` 后重跑 bench：**仍是 3026B + 2984B = 6010B、6 个工具、`extension_error` 0**，字节没动（两者都不注册工具，见 §3.6）。2026-09-30 卸 `pi-web-access` 后复测：**3026B + 2638B = 5664B、5 个工具、`extension_error` 0**（§6.2）。

---

## 7. 已知冲突与遗留

### 7.1 `edit` 工具槽位：已定为 `@aboutlo/pi-smart-edit`

`pi` 不允许两个扩展注册同名工具。`pi-edit-guard` 与 `@aboutlo/pi-smart-edit` 都想覆盖内建 `edit`，同时装必报：

```
Error: Failed to load extension ".../@aboutlo/pi-smart-edit/src/index.ts":
Tool "edit" conflicts with ".../pi-edit-guard/dist/index.js"
```

**决定：卸载 `pi-edit-guard`，由 `@aboutlo/pi-smart-edit` 独占 `edit`。**

| | `pi-edit-guard`（已卸） | `@aboutlo/pi-smart-edit`（在用） |
|---|---|---|
| 匹配策略 | 14 趟分级匹配 + 锚点窗口 + 自修复 | 精确 → NFKC 归一化行匹配 |
| 附加能力 | 注册 `undo`、越界 cwd 提示、`.env`/secret 提示、锚点与诊断报告 | 无 |
| 代价 | edit 描述更长（+59B/请求） | **失去 `undo` 与全部 guard 提示** |

`undo` 的替代：文件级靠 git（或改前先 `read` 留底）。会话级的 `pi-undo-redo` 也已卸载（2026-09-29），暂缺替代。这与本机「有 git、改动走 `md_edit`/`edit` 精确替换」的习惯相容。卸载连带清了 `~/.pi/agent/state/pi-undo-redo/`（13 个 worktree、52MB 死数据）。

> 若哪天要回退：装回 `pi-edit-guard` 并卸 smart-edit 即可；或给 edit-guard 写 `~/.pi/agent/extensions/edit-guard-config.json` 的 `{"editOverrideEnabled": false}`（**必须是 `extensions/` 子目录，放 `~/.pi/agent/` 根下不生效**——已实测），让它只让出 `edit`、保留 `undo`。

### 7.2 其它遗留

**已清理的死配置/死数据**（细节都在 git 历史里）：`~/.pi/lazy-tools.json`（含 `.bak`/`.bak2`，常驻名单已进 `settings.json` 的 `defaultTools`）、`settings.json` 里的 `alps-pi` 块、`~/.pi/agent/pi-hermes-memory/`（19MB）、`.backup-20250915/`（105 个文件，要找回：`git checkout bb9a6ae -- .backup-20250915`）、`settings.json.bak-*`、`state/pi-undo-redo/`（52MB）、`pi-better-toolcalls-undo-store.jsonl`（4MB）。共约 76MB。

**2026-10-09 本轮体检又清一批**（`config/` 已清空、`state/` 只剩 `pi-pet-autostart.json`）：

| 死物 | 为什么是死的 |
|---|---|
| `config/smart-context-ext-config.json` | 包已于 2026-10-02 卸载（§3.2），文件没人再读 |
| `settings.json.bak-160608` | 手写备份 |
| `pi-tidy-tools.pi-fff.json` | fff / pi-fff 卸载后的残留 |
| `fff/`、`pi-fff/`（缓存） | 同上 |
| `state/pi-undo-redo/` | pi-checkpoint 接手 undo/redo 后残留 |
| `state/pi-pet-host.cjs`(+`.lock/`) / `state/pi-pet-host.exe`（**89MB**） / `pi-pet-ctrl.json` / `pi-pet-global.json.electron.json` | 旧架构（0.0.1 内嵌宿主）的宿主脚本/镜像 exe/控制与全局状态文件，现由上游 `bin/pi-pet.cjs` + `<home>/ctrl.json` 接管（§3.6.2）；其中 `pi-pet-global.json.electron.json` 正是铁律 3 警告的「写它会让两个宿主互相认定对方活着」的那类文件 |
| `.pi-hermes-locks.sqlite{,-shm,-wal}`（4.1MB） | `pi-hermes-memory` 卸载后的 WAL 残留 |

> 删前建议先 `node -e` 列出路径确认（删除不可逆）。`config/` 空了不是异常：**只有某些包会往 `~/.pi/agent/config/` 写 `startupConfig`**（本机清空后仍只服务上述几个已卸包）。

**故意保留**：

- `~/node_modules/@earendil-works*@0.85.1`：一棵自洽的 0.85.1 生态，`@wolido/pi-lazy-tools` 依赖它，删了会连带坏掉。pi 自身的扩展从 `~/.pi/agent/npm/node_modules`（Pi 1.1.0）解析，**不会走到家目录那份**。

### 7.3 `omnify` 的两个 fork 修复（2026-09-29，`e972047`，已 push）

本地 clone `D:\AI\pi-lazy-tools`（remote = 你的 fork）改完直接 commit + push，`pi update --extensions` 就会带上；改前先看 `npm test`（`node --import tsx --test`）。

1. **内建工具执行不了却说「执行定义加载失败」**：pi 内建工具由内部工厂生成，`sourceInfo` 是合成标记（`agent-session.js:2502` `createSyntheticSourceInfo('<sdk:ls>', { source: "sdk" })`），jiti 没法 import。新增纯函数 `lazy-tools/core.ts` 的 `nonLoadableSourceReason()`，**先判后 import**，直接给「内建工具 omnify 执行不了，请用 bash / powershell」的可执行原因。
2. **非指名模式下静默执行错工具（假成功）**：旧代码候选失败后无条件 `continue`；schema 宽松的 `mcp`（`Record<string, unknown>`）会照单全收，返回 `MCP: 0/0 servers, 0 tools` 冒充成功。改为：**候选一旦通过参数校验并开始执行，它就是最佳匹配，失败即最终失败**（`break`）；校验不符时仍按原逻辑（非指名继续试下一个，指名立即返回要求）。
   - **BREAKING**：不再有「首个候选失败后自动换一个工具」。
   - 回归：`npm test` 76 passed（新增 4 条），`tsc --noEmit` 干净；改动同步到已装副本 `~/.pi/agent/git/github.com/qq458249269/pi-lazy-tools/`，`check-ext-errors` 的 `extension_error` 0。

### 7.4 `pi-web-access`：卸过一次又装回来了（2026-09-30 卸 → 2026-10-06 复装）

**历史决策（当时是对的）**：`pi remove npm:pi-web-access`，连带删掉两个只为它存在的缓存目录 `~/.pi/web-search-cache/`、`~/.pi/agent/web-search-cache/`（§2.4 纪律）。卸载后重跑 bench：**5 个工具 / system 3026B + tools 2638B = 5664B**。

**当时的卸载理由：`web_enable` 会在会话中途切 active 工具集，把前缀缓存整段掀掉。** 这是它的加载器设计：模型调空参 `web_enable` → `pi.setActiveTools([...现有, 4个])` → 工具集一变，请求前缀从第 0 个 token 起全部作废。本机实测（会话 `--D--AI-LLMlocal--/2026-09-30T00-55-59-851Z_01a0efcf…`）：

| 轮次 | input | cacheRead |
|---|---|---|
| 调 `web_enable` 前 | 3291 | 86016 |
| 调完（`toolsAdded` 四工具） | 92007 | **1152** |
| 下一轮 | 2233 | 91008 |

即激活那一轮把整段 89K 上下文按新 token 重算了一遍，下一轮才恢复。

**复装理由 + 上游修没修**：0.37.0 把激活策略提成配置项 `toolActivation`（`auto`/`dynamic`/`eager`，`registerWebToolActivation(pi, tools, mode)`；`eager` 时压根不注册加载器）。写 `eager` 后掀缓存的**机制不存在了** —— 旧的卸载结论已被新版本推翻，保留本节只作决策记录。现按 §3.7 配置，且 lazy-tools 又把四工具收进懒加载集：前缀既不掀、也不长胖。

> 顺带回答「懒加载工具会不会掀缓存」：**不会**。`omnify` 只在 `session_start` 调一次 `setActiveTools` 做隐藏（`D:\AI\pi-lazy-tools\lazy-tools.ts:487`），执行隐藏工具走 `findToolDefinition` + jiti 直接调 `definition.execute`（同文件 :349），**全程不动 active 集**；`load_tools`/`call_tool` 自 0.4.0 起已撤销。只有像 `web_enable` 这样主动 `setActiveTools` 的加载器才会掀 —— 且现在只在你主动配 `toolActivation: "dynamic"` 时才存在。内建工具（`ls` 等）omnify 根本执行不了（`nonLoadableSourceReason` 先判后 import），更不存在「激活」一说。

---

### 7.5 pi-dsh-pet 0.0.2 的两个上游坑（本机实测，2026-09-30）

1. **`probeCaps()` 把自己的宿主误判成「没有控制面」**。判据是「`GET /control` 不带 action → 400 **且 `body.hint` 非空**」，但 v0.0.2 的宿主回的是 **400 + 空 body `{}`**（带 hint 的那条分支只在 POST 上）。后果：照抄它的扩展会把 `say` / `show-window` 全拦下来 —— 表现就是**「宠物在跑，但 `/pet` 怎么都叫不出窗」**。判据放宽到「非 404」即可（400 本身就说明端点在、只是不接受空 action）。
2. **每 2s 探一次宿主能力会把服务端日志刷屏**（上游自己在 `app/server.cjs` 里为此专门加了注释）。本扩展改成「动作失败才探」+ 5s 缓存，热路径一个 GET 都不发。

**顺带修掉的一个自造 bug**：`connectFeed()` 先 `await findHost()`（一次 HTTP）才建 socket，这段 await 里 `sock` 还是 null —— 看门狗、会话事件、重连定时器撞在一起时会各开一条，`sock` 只留最后一条，前面的**没人关**（`close` 回调还会误杀活着的那条），宿主那边 `feeds` 只增不减（本机实测 15s 涨到 18）。开着是真连接泄漏，长会话必拖垮宿主。已加 `feedPending` 在途闸 + `close` 只认自己那条，探针有对应用例（`B2b`：整个会话只建一条 `/feed`）。

**旧路遗留的死文件**（架构换了，**已清**，本机 `state/` 下只剩 `pi-pet-autostart.json`）：`~/.pi/agent/state/pi-pet-host.cjs`（内嵌宿主源码，已不再落盘）、`pi-pet-global.json*`、`pi-pet-ctrl.json`、`pi-pet-host.cjs.lock/`、`pi-pet-host.cjs.boot.lock/`。新架构只认 `<home>/`（`%APPDATA%/pi-dsh-pet`）里的 `port` / `token` / `state.json` / `ctrl.json` / `host.lock` + `state/pi-pet-autostart.json` + `state/spawn-log.txt`。

### 7.6 `pi-session-memory` 加载即败

`pi install npm:pi-session-memory` 后 `pi list` 直接报：

```
Failed to load extension ".../pi-session-memory/extensions/index.ts":
ResolveMessage: No such built-in module: node:sqlite
```

Pi 内嵌运行时缺 `node:sqlite` 内建模块。已 `pi remove`，跨会话记忆换 `@chendpoc/pi-memory`（deps 无 sqlite：chalk/dayjs/dotenv/es-toolkit/execa/lru-cache/proper-lockfile），`pi list` 加载正常。

### 7.7 `@henryqw/pi-pr` 卸载 + `pi-zvec` Windows 补丁（2026-10-07）

**pi-pr**：装后报 `Error: PR status refresh failed: status unavailable` —— 它依赖 `gh` CLI，本机未装。已 `pi remove npm:@henryqw/pi-pr`。备选 `@narumitw/pi-github-pr` 自述「Requires `gh`; there is no direct GitHub API or `GITHUB_TOKEN` fallback」。结论：**不装 gh CLI 就没有 PR 插件**，PR 需求用 `mcp`/`bash`+git 绕。要装 gh：`winget install GitHub.cli` + `gh auth login`，之后重新装 pi-pr。

**pi-zvec**：两处需知（**已卸载 2026-10-08，见 §7.11**；下为历史留档）。

1. `zg` 二进制：pi 内嵌 npm 装 `@zvec/zvec-grep` 时 install 脚本被 `allowScripts` 拦（`install failed`）；已手动 `npm i -g @zvec/zvec-grep`（§3.1 的 `allowScripts` 名单未加它，靠手动装）。`zg index` / `zg query` 实测通（本地 potion-code-16m-v2 embedding，256 维）。
2. **Windows spawn 补丁**：上游 `env.ts` / `zg.ts` 裸 `spawn(ZG_BIN, ...)` 无 `shell:true`，Windows 上解析不到 `zg.cmd`（node 对 `.cmd` 裸 spawn 直接 `EINVAL`）。本机已 patch：两处 spawn 加 `shell: true`（env.ts 的 `--version` 探测、zg.ts 的执行入口）。**`pi update --extensions` 会冲掉此补丁**（同 fix-lazy-tools-notes.mjs），重装后重打：

```bash
sed -i 's/spawn(ZG_BIN, \["--version"\], { stdio: \["ignore", "pipe", "pipe"\] })/spawn(ZG_BIN, ["--version"], { stdio: ["ignore", "pipe", "pipe"], shell: true })/' ~/.pi/agent/npm/node_modules/pi-zvec/env.ts
sed -i 's/spawn(ZG_BIN, args, { cwd: opts.cwd, stdio: \["ignore", "pipe", "pipe"\] })/spawn(ZG_BIN, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], shell: true })/' ~/.pi/agent/npm/node_modules/pi-zvec/zg.ts
```

症状若再现：`could not run zg: not found on PATH`。验证：`node -e 'const{spawn}=require("child_process");spawn("zg",["--version"],{shell:true}).stdout.on("data",d=>console.log(String(d).trim()))'`。


**`indexMode: "auto"` 与 `index reported not ready after a successful build`**：

- 自动模式：`<项目>/.pi/zvec.json` 写 `{"indexMode":"auto","disabled":false,"coach":true,"verify":true,"gitignore":true}`（本仓库已写；**`.pi/` 已 gitignore（2026-10-08），不再随 repo** —— fresh checkout 需手写该文件才有 auto 索引；本机副本保留）。默认 `ask` 每次开仓弹选择框，`auto` 后台建/更新不弹。
- 该 warning = **良性竞态**：auto 后台建完 → 紧接着 `zg status --check-ready` 判 `stale`（构建期间文件被改，本机即 readme 刚编辑过）。非构建失败，下次 `/zg:index` 或下个会话 auto 追上。实录：`--check-ready` 报 `not ready (state: stale)` → 重跑 `zg index`（7s，1 modified）→ `--check-ready` exit 0。

### 7.8 `pi-ask-permission` 卸载（2026-10-30 前后）

替代 gate 靠 secret-guard 等钩子组合。

### 7.9 `no-find` 全局卸载（2026-10-08）

本机恢复 `find`，撤掉「禁用 find」全部 4 层封锁（§4.2 留档为历史）：

- 仓库：`git rm extensions/no-find.ts`；已装的 `~/.pi/agent/extensions/no-find.ts` 同步删除（同步脚本只拷不删，需手工）。
- 系统层回退到 `~/.pi/agent/no-find-global.json` 备份的原值：
  - 用户 `PATH` 去掉 `C:\Users\yinxuehao\bin`（该目录只剩 find 桩，已一并删除）；
  - 用户 `BASH_ENV` 还原为未设置；
  - `~/.bashrc` 里 `find()` 拒答函数与注释删除；`~/bin/no-find.sh` / `~/bin/find.cmd` 删除。
- 备份 `~/.pi/agent/no-find-global.json` 已删（还原完即无用）。

生效无需 `/reload`（没动 pi 的扩展加载）；`find` 回到系统原样（System32 FIND.EXE / GNU find 并存，按 PATH 顺序命中）。

### 7.10 `pi-cwd-guard` 卸载（2026-10-08）

`pi remove npm:pi-cwd-guard`（`~/.pi/agent/settings.json` 的 packages 同步移除，npm 目录副本删除）。随之消失：cwd/路径权限闸、破坏性命令与 cwd 外路径访问的批准提示、`.env`/密钥写保护。`.env` 防误写改回常规默契；提交侧凭据拦截由 `pi-secret-guard`（仍装）兜底。

### 7.11 `pi-zvec` 卸载（2026-10-08）

卸载与残留清理（`zg`/索引数据可由重装重建）：

- `npm uninstall pi-zvec --legacy-peer-deps`（在 `~/.pi/agent/npm/`；裸 `npm uninstall` 报 ERESOLVE）→ package.json/lock/node_modules 全清。
- `~/.pi/agent/settings.json` packages 移除 `"npm:pi-zvec"`。
- `npm uninstall -g @zvec/zvec-grep` → 全局 `zg` 二进制删（79 包）。
- 项目索引与配置全删：`<项目>/.zvec-grep/` + `<项目>/.pi/zvec.json`（本仓库 6.1M、TUIProjectManager 12M、狗头军师 349K）。
- Windows spawn 补丁（§7.7）随包删除作废。替代：`grep`/`fd`/`omnify`，需要语义搜索再重装（重装需重打 §7.7 补丁 + 重写 `zvec.json` auto 模式）。

### 7.12 预算/缓存去重 + 清单漂移补装（2026-10-08）

装 `@xynogen/pix-optimizer` 前做全量重叠排查的副产物，一并处理：

- **卸 `pi-budget-guard`**：与 `pi-meter` 在「花费追踪 → 预算告警 → 超限拦截」三层完全重叠，meter 另有 auto-downshift、跨会话 JSONL 账本、CLI 报表，是超集。原 §1 里「budget-guard 拦截、meter 降级」的分工说法不成立——meter 自带硬拦截。留 meter 卸 guard。
- **卸 `pi-warm-cache`**：§1 自己标注「本机不生效（本地代理属未注册路由），纯静默待命」。按本仓库 0 触发即卸的判据（同 zvec/smart-context）早就该卸。`pi remove npm:pi-warm-cache` 一条即净。
- **补装 `@arhen/pi-core-subagent`、`pi-ocr`**：清单/安装循环里都列了、实际 `pi list` 里没有（清单漂移）。2026-10-08 重装，并把 subagent 补进 §2.1 安装循环（此前循环里就没有它，重装复现不了）。
后端不是 DeepSeek 时三重叠全是白挂的钩子。**→ 2026-10-09 实测结论已出（已卸），见 §7.13**。

### 7.13 压缩侧换血：`pi-deepseek-cache` / `pi-compaction-cache` → `pi-cache-compact`（2026-10-09）

**先验 `pi-deepseek-cache`（装一天，判死）**：DeepSeek 绑定三处——① 省钱估算读 DeepSeek 官方价格表（本机全是虚构）② 压缩调用打 `deepseek-flash`（本机代理对它返回 400 "not a valid model ID"）③ 接管条件 `ctx.modelRegistry.find("deepseek", …)` 在本机注册表里根本没有 deepseek provider → 必失败。只剩遥测半边真实：headless 会话落盘 `~/.pi/agent/extensions/deepseek-cache/stats.json`，实测 `cacheRead:1664 / input:3856 / turns:1` ≈ 30.1% 命中——这同时证明**代理确实返回 `prompt_tokens_details.cached_tokens`，pi-ai 会归一化**。按本仓库 0 触发即卸的判据 → `pi remove npm:pi-deepseek-cache`。

**换 `pi-cache-compact` 0.2.0**（源码 0 处 "deepseek"，provider 无关）。fork 排查留档：上游 `ruanbw/pi-deepseek-cache` 只有 2 个 0-star 陈旧 fork（zzddk / fchaix），不值得。**同时卸 `pi-compaction-cache`**：两者抢同一个 `session_before_compact`，只能留一个。

**端到端实测（本机代理，provider `1` / 模型 `1`，非 DeepSeek）**：

| 场景 | 结果 |
|---|---|
| 自动压缩（89K 陈旧会话，冷前缀） | 扩展发出 128 条消息的续写请求 → `cacheRead: 0` → **拒绝接管**，让位 Pi 默认压缩（`deferAfterCacheMiss` 随后 15 分钟内继续让位），不烧第二次冷 prefill ✅ fail-safe 生效 |
| **手动 `/compact`（本会话，前缀热）** | `summary_start` → `provider_request msgs:162` → `200` → **`wrote cache-friendly summary`，`cacheRead: 81920`** → 压缩落地，会话缩到 54 条消息 ✅ |

命中账：`{cacheRead: 81920, cacheWrite: 0, input: 37576, output: 10084}` → 总 prompt ≈ 119.5K，命中 **68.6%**。对照 Pi 默认压缩：它发的是截断改写后的全新 prompt，同一 119.5K 前缀**必然 0 命中、全量重算**。（`81920` 恰好是 80×1024，说明上游按块记账、只读不写。）

**取舍结论（留 `pi-cache-compact`，不留 `pi-compaction-cache`）**：cache-compact 是唯一在**本机后端**跑完「命中 → 压缩落地 → 会话继续」全闭环的（compaction-cache 的 98.8% 是更早、不同后端的旧数据，恢复它要重走一遍今天的取证流程）；且它有 `deferAfterCacheMiss` 这个别的扩展没有的止损设计。代价：全文续写的摘要很重（本次 output 10084 tok、耗时 **227s**）——长会话压缩本来就慢，可接受。

**验证方法可复现**（供以后复测）：临时把 `models.json` 的 `contextWindow` 压到 9000 制造真实压缩场景 → headless `pi --session <id> -p "…"` 连打两轮大文本焐热前缀 → 手动 `/compact`；想把“手动”与“自动”分开取证，就把窗口调回 128000 排除自动压缩干扰（此时只剩手动一条路径）→ 读 `cache-compact-debug.jsonl` 里 `"summary": true` 记录的 `cacheRead`。坑：headless `pi -p` 会因 pi-dsh-pet 的 `/feed` 重连循环不退出，必须用 `timeout` 包裹（exit=124 属预期噪音）；`-c` 会续上**别的**旧会话（测到过 89K 的），要精确定位就 `--session <id>`。

### 7.14 subagent 把 pi 带崩：`proper-lockfile` 撞 jiti 的 interop Proxy（2026-10-09）

**症状**：subagent 跑着跑着整个 pi 进程死掉，控制台只留一行（没有扩展名、没有 TUI 堆栈）：

```
TypeError: Proxy handler's 'get' result of a non-configurable and non-writable
property should be the same value as the target's property
    at probe (C:\Users\yinxuehao\.pi\agent\node_modules\proper-lockfile\lib\mtime-precision.js:6:29)
```

（`6:29` 正是 `const cachedPrecision = fs[cacheSymbol];` 里 `fs` 的位置。行尾那串 `[13;5u[57442;1:3u` 是崩前 TUI 刷屏留下的转义残渣，不是错误的一部分。）

**根因（已本地复现，非猜测）**：`proper-lockfile@4.1.2` 的 `lib/mtime-precision.js` 把探测到的 mtime 精度用 `Object.defineProperty(fs, cacheSymbol, { value })` 挂在 **fs 模块对象**（= `graceful-fs` 的 exports）上，之后每次加锁都读 `fs[cacheSymbol]`。而 pi 用 **jiti 加载扩展**（`moduleCache:false` + `interopDefault:true`），jiti 的 interop 会把 CJS exports 包一层 **Proxy**：get 陷阱把每次取值缓存进 `Map`，对 target 上不存在的键（含 Symbol）返回并**缓存** `undefined`。于是：

1. 第 1 次 probe：`fs[sym]` → `undefined`（顺带被 trap 缓存）→ 继续；`defineProperty` 落到 Proxy 的 **target** 上，该属性变成 non-writable + non-configurable；
2. 第 2 次 probe：`fs[sym]` 命中 trap 缓存 → 仍返回 `undefined`，与 target 里的 `'ms'` 不等 → **JSC 抛 Proxy 不变量 TypeError** → 未捕获 → pi 死。

**为什么「像 subagent 的锅」**：subagent 只是在运行期触发落盘（settings/auth/trust、子代理状态），真正的雷是**同进程内第二次及以后**的加锁。fs 是不是 Proxy 与锁本身无关，jiti 只是让 `proper-lockfile` 内部的 `require('graceful-fs')` 拿到了 interop Proxy。

**处置**：缓存从 fs 对象挪进模块级 `WeakMap`（以 fs 对象为键），完全不再改写 fs——语义等价（仍是「每个 fs 对象只探测一次」），对 Proxy 免疫。`node fix-proper-lockfile-proxy.mjs`（幂等，`--check` 只体检）会把 `~/.pi/agent` 下**所有** proper-lockfile 副本一起改掉（本机 2 份：`agent/node_modules` + `agent/npm/node_modules`），写后回读校验。**pi 升本体/重装 node_modules 会冲掉补丁，重跑即恢复**（§2.3 已加提醒）。

验证：补丁前用 jiti 复现脚本抛的是同一行 frame（`at probe (...mtime-precision.js:6:29)`）；补丁后同一脚本在 bun 与 node 下、两个副本共 4 组全部通过（两次 probe 正常回调，无不变量错误）。

> 上游真修要看两处：jiti interop 的 get 陷阱（对非 own key 不该缓存 `undefined` / 该走 `Reflect.get`），或 proper-lockfile 别往外来对象上挂属性。本仓库只做后者，幂等且不动语义。

### 7.15 全机体检实录（2026-10-09）：清单没漂，漂的是「必做配置层」

对照 readme 与本机逐项过了一遍，**28 个扩展本身零漂移**（`pi list` = `settings.json` 的 `packages` = §1 表，26 npm + 2 git；本地扩展与仓库逐字节一致）。问题全在清单之外的层：

| # | 发现 | 根因 | 修法 | 验证 |
|---|---|---|---|---|
| 1 | **上游 `pi-dsh-pet` 扩展一直在加载**，与本地薄客户端重复注册 `/pet` `/pet-stop` `/pet-say` `/pet-status`（铁律 1 的事故源） | `extensions: []` 只筛 **npm 包内的子扩展**，对 git 仓库顶层 `pi/extensions/index.ts` 无效；以前一直以为「写了 extensions:[] 就算屏蔽」 | `packages` 里改成 object form：`{"source": "git:github.com/qq458249269/pi-dsh-pet", "extensions": []}`（§3.6） | `pi list` 该行显示 `(filtered)`；headless `pi --no-session -p "reply with: ok"` 里**再没有** `[pi-dsh-pet] /feed 连接断开，2s 后重连`，只剩本地客户端的 notify OSC 777 + `ok`；条目数仍 28 |
| 2 | `cache-compact.json` 是 debug 配置，会 dump 全量 payload（1.1MB） | 当初为取证开后忘关 | 改生产白名单 `{"models": ["1/1"]}`，删 `cache-compact-debug.jsonl`（§3.3） | 文件 23B，`debug` 键没了 |
| 3 | 一批死数据/死配置 | 旧架构 + 已卸包的遗留 | 列在 §7.2 表格，一律删 | `config/` 空、`state/` 只剩 `pi-pet-autostart.json` |
| 4 | **better-sqlite3 binding 丢了**（pi-memory 的 vec 索引用不了，报 `Could not locate the bindings file. Tried:`） | `npm uninstall` 触发整棵树重解析：`allowScripts` 里钉的 `better-sqlite3@13.0.3` 与树内实际的 `12.11.1`（pi-memory 的 `^12.10.0`）对不上 → npm 当「未覆盖」→ `node-gyp rebuild` 被挡 | `npm install-scripts approve better-sqlite3`（**不带版本号**）+ `npm rebuild better-sqlite3`（§3.1） | `node -e "require('better-sqlite3')(':memory:')"` OK；`npm install-scripts ls` 只剩 pi-memory 的 postinstall（有意不批） |
| 5 | `fix-lazy-tools-notes.mjs` 补的 DOCS_NOTE 路径**大小写错了半角** | 脚本做**精确字符串替换**，`D:\agent\pi\docs` 与实机 `D:\Agent\pi` 不符就不匹配 | 重跑脚本（幂等），并同步到已装副本 | `--check` exit 0；已装副本 `git status` 显示 ` M lazy-tools.ts` |
| 6 | readme 的必做配置层漏了 3 样东西 | 一边改一边没补文档 | §3.9 `bash-prelude.sh`（`shellCommandPrefix`）、§3.10 `-builtin:mcp`、§3.11 用户级 settings 备忘 | 照这三条即可从零复现 |
| 7 | readme 安装循环漏了 4 个包 | 清单加了但循环没加（§7.12 同一类错） | §2.1 补 `pi-secret-guard` / `pi-mono-context-guard` / `pi-meter` / `@narumitw/pi-plan-mode` | 循环数 = 26 npm + 2 git |

**顺序纪律（本次最贵的经验）**：先备份 → 改 `settings.json` → 验证 → 清死数据 → 补文档，**不要**在会话开着的时候边走边改（§9.6）。本轮全程用 headless `pi -p` 做验证，不碰自己这条交互会话。

**留个教训**：`extensions: []` 是「只筛 npm 包内子扩展」的语义，不看文档只信直觉，会让上游扩展在机器上多跑一个月都没人发现。**凡是屏蔽类配置，改完必须用 headless 实测**（只看 `pi list` 有 `(filtered)` 才行——那才是真屏蔽）。

---

### 7.16 子代理调不起来：不是插件坏了，是**一个 agent 定义都没有**（2026-10-10）

**症状**：子代理坏掉时**不报错、不崩、不进 `crashes.json`**，只是安静地调用失败或什么都不返回。表面看像插件坏了，实际是**配置文件一个都没装**。

**根因**：`@arhen/pi-core-subagent` 的 `src/agentfile.ts:20` 写死了发现目录：

```ts
const AGENT_DIRS = [".agents/agents", ".claude/agents", ".pi/agents"] as const;
```

它只从这三个目录读 `.md`（frontmatter 的 `description` 参与按描述匹配）。本机实测**三个全不存在**，`~/.pi/agents` 也没有 → 没有 agent → `agent` 参数无值可填。

**复现链（每一步的报错都指向同一处，很有迷惑性）**：

| 尝试的 args | 实际报错 |
|---|---|
| `{task}` | `Provide one subagent mode: agent+task (single), tasks: [...]…` |
| `{agent:"default", task}` | `2 model(s) available — this session has no model scoping…`（要求先定 model） |
| `{task, autoAwait}`（漏 goal） | `Validation failed for tool "omnify": goal: must have required properties` |
| `autoAwait: "true"`（字符串） | `参数不符（autoAwait: expected boolean, got "true"）` |

**修法**：建 `~/.pi/agents/default.md`（带 `description` frontmatter）。装完实测 `1/1 succeeded`，子代理正常返回。已固化为 `node fix-subagent-check.mjs`（幂等 + `--check`）。

> 冒烟测试默认**不跑**：rpc 没有「直接调工具」的命令，只能让模型发一次 tool call，受模型行为影响（会漏 `goal`、会把布尔值写成字符串）。故默认只做确定性静态检查（0.2s、不花 token）；需要确认「此刻真能调」时显式加 `--smoke`。

#### ⚠️ 一条已被实测推翻的诊断（勿再照抄）

当时另有诊断称：
> `pi.exe` 是 `bun build --compile` 单文件可执行；子代理从 `~/.pi/agent/node_modules` 动态加载 `pi-ai` **0.87.1**；该文件 `dist/utils/json-parse.js` 首行是 bare specifier `import … from "partial-json"`；而 Bun 编译版解析外部 bare specifier 时只看自身 bundle、不回落到 importer 的 `node_modules` → 即使磁盘上有 `partial-json` 也报找不到。

**三条前提实测全部不成立**：

| 诊断前提 | 实测 |
|---|---|
| exe 动态加载 `~/.pi/agent/node_modules` 的 0.87.1 | ❌ `pi.exe --version` = **1.1.0**，而 `~/.pi/agent/node_modules` 里是 0.87.1；且 `D:\Agent\pi\dist\` **不存在** → exe 是自包含 bundle，根本不读磁盘那份 |
| `json-parse.js` 首行是 bare specifier | ❌ 磁盘 0.87.1 那份首行是**相对路径** `"../../../../partial-json/dist/index.js"`；且 `fd -t f json-parse D:\Agent\pi` **零结果**——该文件不在 1.1.0 里 |
| Bun 不回落 `node_modules` 所以报找不到 | ❌ 实测在 `pi.exe` 下跑 subagent **1/1 succeeded**，无任何 `partial-json` 报错 |

**教训**：诊断里出现具体版本号与文件路径时，先跑 `pi.exe --version` 和 `fd` 确认它们对当前 exe 成立，再动手改代码。跨版本的旧结论会被当成现状（那个 `json-parse.js` 是 0.87.1 的，exe 早已是 1.1.0）。

---

### 7.17 配置源外迁 `config/`：`.pi/` 回到「纯运行时目录」（2026-10-10）

**起因**：`~/.pi/agent/settings.json` 在 2026-10-10 20:38 被写回旧快照——`packages` 退回 10-08 之前的 30 条（多出 `pi-compaction-cache`/`pi-warm-cache`/`pi-budget-guard`/`pi-zvec`/`pi-cwd-guard`，少了 `pi-cache-compact`/`@tian.zuo/pi-find`/`@narumitw/pi-lsp`），§3.11 的 13 个非默认键整段消失。机器侧按 readme 校正后（卸 5 装 3 + 补键），顺手把**配置与仓库的关系**改成不会丢的形态。

**问题**：pi 的项目级配置只认 `<cwd>/.pi/settings.json`（`docs/configuration.md`，目录名写死 `dist/config.js:403`），而 `.pi/` 是运行时目录（索引/阶段数据会 churn），在仓库里被整体 `.gitignore` → 配置无处可存，只能靠「单独放行一个文件」这种脆做法。

**改法**：配置的 canonical 源放仓库 `config/`（不被忽略、可 review、可 diff），由 `node install-project-config.mjs`（幂等 + `--check`）拷进 pi 实际读取的位置。

| 层 | canonical 源（入库） | 落到哪 | 怎么装 |
|---|---|---|---|
| 项目级 | `config/pi-project/settings.json` | `<仓库>/.pi/settings.json` | `node install-project-config.mjs` |
| 项目级留档 | `config/pi-project/zvec.json` | 不落（`pi-zvec` 已卸，§7.11） | 手动（重装 zvec 时） |
| 用户级脚本 | `config/agent/bash-prelude.sh` | `~/.pi/agent/bash-prelude.sh`（§3.9 的 `shellCommandPrefix` 指它） | 同上 |
| 用户级快照 | `config/agent/settings.snapshot-2025-09-15.json` | 不落（脚本对 `settings.snapshot-*` 一律跳过） | — |

- **恢复来源**：`.pi/settings.json`、`.pi/zvec.json` 取自 git 历史（`15c714b` 删除前）；`bash-prelude.sh` 取自 §3.9 全文；用户级快照取自 `.backup-20250915/settings.json`（`51e457d` 删除前，含 §3.11 多个键的取值）。
- `.pi/` 重新**整体忽略**（不再放行 `settings.json`）：配置是生成物，clone 后跑一次同步脚本即可；索引/churn 照样不入仓。
- **根目录放 `settings.json` 无效**（pi 不读它）→ 是「源放 `config/` + 脚本拷进 `.pi/`」，不是「把文件挪到仓库根」。
- 机器侧同时补回：`~/.pi/agent/settings.json` 的 §3.11 十三键（备份留 `settings.json.bak.2026-10-10-pre-config-restore`）、`bash-prelude.sh`、`~/.pi/agents/default.md`（§7.16）与 proper-lockfile 补丁 ×2（§7.14）。两个 fix 脚本 `--check` 全绿。
- 顺手修的两处 readme 失真：§5 与 §8 表引用的 `.sc-test/probe-bash-guard.mjs`（从未入库、现不存在）。

---

## 8. 体检与排障

本机的体检脚本**没有自动化的**，但有几个手跑的（都在仓库根或 `.sc-test/`，`.sc-test/` 属 gitignore、不入库）：

| 脚本 | 干什么 | 结果 |
|---|---|---|
| `node check-readme-tables.mjs` | 体检 readme 表格列数 | 一致 exit 0、不一致 exit 1 |
| `node install-local-extensions.mjs --check` | 本地扩展副本与仓库是否逐字节一致 | 不一致会提示重拷 |
| `node fix-lazy-tools-notes.mjs --check` | DOCS_NOTE 路径补丁是否需要重打 | 基线已修好 exit 0 |
| `node fix-proper-lockfile-proxy.mjs --check` | proper-lockfile 补丁在位 | 一致 exit 0 |
| `node fix-subagent-check.mjs --check` | 子代理可用（agent 定义目录 / modelPolicy / 插件在位） | 全绿 exit 0；缺 agent 定义 exit 1 |
| `node fix-browser-native-compat.mjs` | 双路回退兼容（新形态报 `[skip]`） | `[skip]` |
| `node install-project-config.mjs --check` | `config/` 里的配置/小脚本与 pi 实际读取位置是否一致 | 一致 exit 0 |
| `.sc-test/check-ext-errors.mjs` | 扫会话里的 `extension_error` | 盘上还在，但 `.sc-test/` 是 gitignore、**不入库** → 当一次性探针用，别当长期工具（升级/清理会丢） |
| ~~`.sc-test/probe-bash-guard.mjs`~~ | bash-guard 回归用例（54 例） | **已不存在**（未入库，随清理丢了）——要回归按 §5 那份清单重写 |

改完 `/reload`，看 TUI 有无 `extension_error`；本地扩展与仓库是否漂移跑 `node install-local-extensions.mjs --check`；readme 表格列数跑 `node check-readme-tables.mjs`（编辑手滑插/漏一个 `|` 时靠它兜住）。

| 症状 | 原因 | 处置 |
|---|---|---|
| 扩展报 `Tool "x" conflicts with ...` | 两个扩展抢同一工具名 | 二选一卸载（见 §7.1） |
| 懒加载报 `Cannot find module` | lazy 执行层地基缺失（版本要与 pi 本体一致，别写死） | `npm i --prefix ~/.pi/agent @earendil-works/{pi-coding-agent,pi-tui,pi-ai}@$(pi --version \| grep -oE '[0-9]+\.[0-9]+\.[0-9]+')` |
| 工具调用不到、wire 上也没有 | 内建工具不在 `defaultTools`（不注册），扩展工具不在其中（被 lazy） | 改 `defaultTools`（§3.4），`/reload` |
| `fd` 报 “fd executable not found” | pi 自带副本与 PATH 都没有 fd | 跑 `/fd-check` 看解析结果；或 `npm i -g fd-find` |
| 会话/文件撤销 | `pi-edit-guard` 已卸载，其 `undo` 工具随之消失 | 文件级靠 git 或改前先 `read`；**会话级 `/undo` 现由 `@bacnh85/pi-checkpoint` 提供**（见 §3.8；不在 git 仓库里则静默 no-op） |
| agent 没有 shell | `defaultTools` 里没有 `bash` | 写 `bash` 进两处 `defaultTools`（§3.4）；若 `extensions/pi-shell.ts` 被装回来，它会在 `session_start` 无条件隐藏 `bash` |
| 压缩后首轮命中低 | 正常现象 | 只有「命中 0」才是故障；压缩调用自身由 `pi-cache-compact` 兜（本机实测命中 68.6%，§7.13） |
| 终端打 `[cache-compact] summary rejected …` | 摘要空 / 被 `length` 截断 / 夹带工具调用 | 设计内行为：已回落 Pi 默认压缩，摘要不会变坏。`stopReason:"length"` 多半是 `summaryMaxTokens` 卡住（或测试时误压小了 `maxTokens`） |
| 压缩请求 `cacheRead: 0` | 前缀太老，上游缓存已过期（mimo 免费端点只活几分钟） | 正常现象；`deferAfterCacheMiss` 会让位 15 分钟。想看命中就在**刚聊完的会话里立刻** `/compact`（§3.3） |
| ~~`pi-warm-cache` 没反应~~ | 本地代理属未注册路由 | **已卸载**（2026-10-08 死安装，见 §7.12），此行留档 |
| 装/卸任何包时 npm 打 `EBADENGINE ... pi-agent-browser-native@0.9.3 ... node >=24.21.0` | 本机 node 24.16.0 低于该包声明的 engine | **可忽略**，纯警告；工具实测正常。要消掉就把 node 升到 24.21+，或接受每次都打一遍 |
| pi-agent-browser-native 报 `buildSessionProjection is not a function` | 扩展版本太老（<0.9.x，宿主 1.0.0 才自带该 API） | 本机 pi 1.1.0 + 扩展 0.9.3 不会发生。真发生先 `pi update pi-agent-browser-native`；仍不行跑 `node fix-browser-native-compat.mjs`（新形态下它报 `[skip]` 而非 `[fail]`） |
| `omnify` 搜不到 `web_search` / 每轮前缀突然被掀 | `web-search.json` 缺 `toolActivation: "eager"`，退回了 `web_enable` 加载器 | 写上该键 `/reload`（§3.7）；掀缓存的现场见 §7.4 表 |
| 跑完没通知 | 终端不支持（Terminal.app / Alacritty） | `pi-notify` 只覆盖 OSC 777/9/99 与 Windows Terminal；换终端，或改用 §1.2 桌宠看状态 |
| `/pet` 提示命令不存在 | 只 `npm i -g` 装过，pi 不扫全局 `node_modules` | `pi install git:github.com/qq458249269/pi-dsh-pet` → `/reload`（见 §3.6） |
| 宠物窗口不弹 | 首次要下 Electron ≈100MB；或自动启动被关了 | 看启动提示；`/pet-auto status` 看当前开关；`/pet small` 换小号试；关掉了就写回 `{"autostart": true}` |
| pi 整个进程崩，只留 `TypeError: Proxy handler's 'get' result … should be the same value as the target's property`（frame 指向 `proper-lockfile/lib/mtime-precision.js:6:29`） | proper-lockfile 把 mtime 精度缓存挂到 fs 对象上，而 jiti interop 把它包成了 Proxy；同进程第二次加锁即触发 JSC 不变量（多由 subagent 跑着跑着踩到） | 跑 `node fix-proper-lockfile-proxy.mjs`（幂等）；pi 升本体后若复发，重跑即可。根因与复现见 §7.14 |
| `pi list` 里某行带 `(filtered)` | 该包在 `packages` 里写成 object form 且注明了要屏蔽的部分 | **预期**（本机只有 `git:github.com/qq458249269/pi-dsh-pet (filtered)`，见 §3.6） |
| subagent 调不起来 / 报 `Provide one subagent mode: agent+task (single)…` | **不是插件坏了**，是 `agentfile.ts` 的三个发现目录（`.agents/agents`、`.claude/agents`、`.pi/agents`）一个都不存在 → 没有 agent 可填。详见 §7.16 | `node fix-subagent-check.mjs`（幂等，缺就补一个最小 `default.md`） |
| subagent 报 `2 model(s) available …` 后卡住 | `~/.pi/subagent.json` 的 `modelPolicy` 没锁 `default.model` | 写 `{"modelPolicy":{"default":{"model":"<provider>/<id>"}}}`（本机 `1/1`） |
| `pi --no-session -p ...` 不退出（shell 报 exit 124） | 桌宠的 `/feed` 长连接或宿主进程挂着父会话；headless 永远不会自己走完 | 用 `timeout 70 pi ...` 包一层（§7.13 已记录）；屏蔽上游扩展后刷屏的重连日志也会消失（§7.15） |
| 装东西后 pi-memory 报 `Could not locate the bindings file. Tried:` | 树被重解析，better-sqlite3 换了版本 → `allowScripts` 对不上 → 原生 binding 没编 | `npm install-scripts approve better-sqlite3 && npm rebuild better-sqlite3`（详见 §3.1） |

**磁盘布局速查**

| 路径 | 内容 |
|---|---|
| `~/.pi/agent/settings.json` | `packages` 注册表 + `defaultTools`（含 dsh-pet 的 object form 屏蔽，见 §3.6） |
| `~/.pi/agent/bash-prelude.sh` | 每条 bash 命令前的 `cd /d` 兼容层（`shellCommandPrefix`，见 §3.9）。**canonical 在仓库 `config/agent/bash-prelude.sh`** |
| `~/.pi/agent/extensions/` | 本地扩展副本 + 各扩展的全局配置（如 `edit-guard-config.json`、`pi-dsh-pet.json`，**只放这里，放 agent 根下不生效**） |
| `~/.pi/agent/web-search.json` | `pi-web-access` 的配置（`toolActivation`，见 §3.7）。注意它在 agent 根下，不在 `extensions/` 里 |
| `~/.pi/agent/cache-compact.json` | `pi-cache-compact` 的模型白名单（见 §3.3） |
| `~/.pi/agent/mcp-onboarding.json` | 内建 MCP 引导向导的状态（见 §3.10），**勿手改** |
| `~/.pi/agent/state/` | 跨会话记账，**2026-10-09 清理后只剩 `pi-pet-autostart.json`**（记「本 pid 已弹过窗 + 落在哪只宠物上」） |
| `~/.pi/agent/git/` | git 源扩展（lazy-tools fork + dsh-pet，后者扩展被屏蔽，见 §3.6） |
| `~/.pi/agent/npm/node_modules/` | npm 源扩展 |
| `~/.pi/agent/npm/package.json` | 26 个 dep + `allowScripts`（见 §3.1） |
| `~/.pi/agent/config/` | **已空**（smart-context 包卸载后配置已删，新装带 `startupConfig` 的包才会写） |
本目录名写死在 `dist/config.js:403`。本仓库这份是**生成物**：canonical 在 `config/pi-project/settings.json`，跑 `node install-project-config.mjs` 拷入 |
| `<仓库>/config/pi-project/*` | **项目级配置的 canonical 源**：`settings.json`（→ 拷进 `<仓库>/.pi/`）、`zvec.json`（留档件，不参与同步，见 §7.11） |
| `<仓库>/config/agent/*` | **用户级配置的 canonical 源**：`bash-prelude.sh`（→ 拷进 `~/.pi/agent/`）、`settings.snapshot-2025-09-15.json`（历史快照，只留档不拷） |
| `~/.pi/agent/sessions/**/*.jsonl` | 会话历史，算命中率的原始数据 |

**生效方式**：改配置或扩展后 `/reload`（不重启会话、不丢历史）。

---
---

## 9. 本轮实录：换包 + 升级 + 环境补齐（2026-09-29，`USERPROFILE=C:\Users\yxh`）

在另一台机器上照本清单完整走一遍。**配置值与 §1–§7 全部一致，唯一差异是路径前缀**（本机 `yxh`，原记录机 `yinxuehao`；`compaction-cache.json` 的 `logPath` 已是本机路径）。

2026-09-30 卸载 `pi-web-access` 后为 **18 项 / 5664B / 5 个工具**（详见 §1 与 §7.4）；2026-10-09 压缩侧换血（compaction-cache → cache-compact）后为 **28 项**（§7.13）。本节 §9.4 表里那行「`smart-context` / `compaction-cache` 已合规，未动」是快照原文，**勿照抄**。

### 9.1 拉代码：未提交改动先备份再 fast-forward

`git fetch` 后本地落后 17 个提交，工作区有两处未提交改动：

| 文件 | 改动 | 处置 |
|---|---|---|
| `extensions/pi-lean-prompt.ts` | +146 行，在 `before_provider_request` 里压 wire system 的 `<rules>`/`<docs>`/`<skills>` | 还原（已备份） |
| `readme.md` | 旧的 118KB 长版 | 还原（已备份） |

那 146 行不是「还没提交的新活」，而是**已被远端推翻的旧路线**：远端把 wire 压缩拆成独立的 `pi-lean-sections.ts`（只压 `<docs>` + `<skills>`），且 §3.2 明确「**不要压 `<rules>`**」（与 docs/skills 同改会让 pi 把 rules 正文挪位、条目与续行错配）。仓库是 canonical 源，直接还原即正确。备份留在 `/tmp/pi-ext-backup/`（`local-work.patch` + 两个原文件）。`e1758d3 → 16c8951` fast-forward 成功。

### 9.2 照清单换包：卸 3 装 3，仍是 19 个

| 操作 | 包 | 版本 | 依据 |
|---|---|---|---|
| 卸 | `pi-edit-guard` | 0.1.5 | §7.1，与 smart-edit 争 `edit` 槽 |
| 卸 | `pi-undo-redo` | 0.1.2 | 已弃用，连带清 `state/pi-undo-redo/`（22M 影子 worktree） |
| 卸 | `@nguyenquangthai/pi-ask` | 0.2.0 | 换包（`ask_user_question` → `ask_question`） |
| 装 | `@henryqw/pi-ask-question` | 2.0.3 | §1.1 |
| 装 | `@aboutlo/pi-smart-edit` | 0.4.0 | §7.1 独占 `edit` |
| 装 | `pi-dsh-pet` | 0.0.2 | §3.6 桌面宠物 |

`pi list` 实测 **19 项 = 18 npm + 1 git**，`settings.json` 的 `packages` 19 条。全程串行（§2.1 的硬规矩）。

### 9.3 升级：只有 mcp-adapter 动了，fork 带上了两个修复

`pi update --extensions`：

- `pi-mcp-adapter` **3.1.0 → 3.2.0**（唯一升版的 npm 包，其余已是 latest）
- fork `54bf2f2 → e972047` —— §7.3 那两个 omnify 修复已在上游，随 `git reset --hard` 一并带下来

⚠ 代价照旧：`reset --hard` + `clean -fdx` 把 `fix-lazy-tools-notes.mjs` 打的 `DOCS_NOTE` 路径补丁冲掉了，`--check` 报「待修补：docs 路径」，重打即恢复（幂等，复跑 `无需改动`）。实测命中 `D:\agent\pi-windows-x64`。**该机已无 `pi-shell.ts`，脚本第 2 段（bash→shell 措辞）自动跳过。**

### 9.4 配置同步

| 项 | 动作 |
|---|---|
| 本地扩展 | 4 个全量重同步（`pi-lean-prompt` / `pi-lean-sections` / `pi-fd` / `pi-pet-autostart`；`no-find.ts` 已卸，见 §7.9），`--check` 复跑全 `[ok]` |
| `extensions/pi-shell.ts` | **删**。仓库已删；留在用户目录里会 `setActiveTools` 无条件隐藏 `bash`/`powershell`，与 §3.4 直接冲突 |
| `~/.pi/lazy-tools.json` | **删**（0.4.0 死配置，只触发迁移告警） |
| 用户级 `defaultTools` | 补 `bash`：`["read","edit","write"]` → `["read","edit","write","bash"]`，与项目级对齐（§3.5 两处必须一致） |
| `extensions/pi-dsh-pet.json` | 新建 `{"autostart":true,"size":"normal","delayMs":400,"maxPets":1,"bridge":true}` |
| `smart-context` / `compaction-cache` | 已合规，未动 |
| computer-use | `allowScripts` 早已批准；`setup-helper.mjs --postinstall` → `already up to date` |

> `npm install-scripts approve better-sqlite3` 报 `ENOMATCH` —— **属预期**，该依赖早被两包移除；§3.1 那行命令在本机实际等于只批准 computer-use。

### 9.5 体检结果

| 检查 | 结果 |
|---|---|
| `check-ext-errors.mjs` | `extension_error` **0**、stderr 命中 **0**（smart-edit 与 edit-guard 的 `edit` 冲突已随卸载消失） |
| `install-local-extensions.mjs --check` | 5 个全 `[ok]`，exit 0 |
| `fix-browser-native-compat.mjs` | `[skip]`（双路回退仍在，0.87.1 本就不需要） |
| `fix-lazy-tools-notes.mjs --check` | 重打后 `无需改动` |

### 9.6 本机新发现

**② 中途改 `defaultTools` 而不 `/reload`，等于把自己锁在门外。**
本轮前半段按 §3.4 往 `defaultTools` 补了 `bash`（两处都写好了）。但**本会话是在改之前启动的**，工具集在启动时定死，改完没跑 `/reload`——于是后半段要执行 `git push` 时，手上只剩 `read`/`write`/`edit`/`web_enable`/`omnify`。`omnify` 兜底调 `bash`、`powershell`、`read` 全部被拒：

```
builtin工具（sourceInfo=<builtin:bash>，由 pi 内部工厂生成、
没有可 import 的源码）→ omnify 执行不了
```

这正是 §3.4 那条注记的实测复现（内建工具没有可 import 的源码，jiti 加载器执行不了它们）。但真正的坑在时序：**恢复 shell 的唯一动作 `/reload` 本身就需要 shell 或命令面板**。所以 §3.4「改完 `/reload` 生效」有个隐含前提——别在一个正指着 shell 干活的中途会话里改它。稳妥做法：**改 `defaultTools` 放在会话开头做，或改完立刻 `/reload` 再继续。**

> 收尾：`git push` 最终由人执行。push 前用 `read` 直接读 `.git/refs/heads/master` 与 `.git/refs/remotes/origin/master`，两者同为 `16c8951`，确认是空操作——**没有 shell 也能判断有没有东西要推**。（`packed-refs` 里有条陈旧的 `8e4776b → origin/master`，loose ref 优先，不影响判定。）

### 9.7 增补三扩展：联网 / 会话级撤销 / 完成通知（2026-10-06）

`pi-web-access` + `@bacnh85/pi-checkpoint` + `pi-notify`，17 → **20 个在用**（18 npm + 2 git）。§3.7 / §3.8 是配置与边界，§7.4 记了 web-access 装卸两轮的理由演进，这里只留操作流水。

| 步 | 动作 | 结果 |
|---|---|---|
| 装 | `pi install npm:pi-web-access` / `npm:@bacnh85/pi-checkpoint` / `npm:pi-notify` | **一次只能吃一条参数**（写 `pi install a b c` 报 `Unexpected argument npm:@bacnh85/pi-checkpoint`），已写进 §2.1 |
| 配 | 新建 `~/.pi/agent/web-search.json` = `{"toolActivation":"eager"}` | 值非法扩展启动即抛，只认 `auto`/`dynamic`/`eager` |
| 冒烟 | `pi -p` 无交互跑 | pi-notify 生效（stdout 直接打出 OSC 777 序列 `]777;notify;Pi;Ready for input`）；三个扩展均无 `extension_error` |
| 探针 | 临时扩展打 `getAllTools()` / `getActiveTools()` | 注册表 **51** 个工具（四个 web 工具都在）；`session_start` 时全 active，`before_agent_start` 被 lazy-tools 收到 5 个。探针跑完即删 |
| 全链路 | 让 agent `omnify` 捞 `web_search` 搜 `nodejs` | 通（provider exa），搜完再 read 一次照常 |
| 缓存 | 见 §3.7 表 | wire 5294B、cacheRead 单调、零中途翻转 |
| 清理 | 删仓库里的 `nul` 垃圾文件（69B） | 已删 |

**未实测的**：`/undo` `/redo` 的交互式回合（非 git 仓库与 30 天剪枝路径未走）；`fetch_content` 在本机 TUN/fake-IP 下的 SSRF 表现（§3.7 留注）。
