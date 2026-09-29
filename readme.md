# Pi 扩展安装配置清单

本手册是一份**可直接照做的安装 + 配置清单**：装哪些、按什么顺序装、每个必做配置写什么、以及每条结论的实测依据。
扩展统一装在 `~/.pi/agent`（Windows：`%USERPROFILE%\.pi\agent`），下文路径均以此计。

**本机基线（所有实测都在这上面做的）**：Pi **0.87.1**、node **24.16.0**、npm 12、模型走本地代理 `http://localhost:20128/v1`（`openai-completions`，模型 id `1`，窗口 100K）。
换版本 / 换 provider 后，**先复测再信下面的数字**（见文末「怎么复测」）。

---

## 1. 清单（在用 19 个扩展 = 18 npm + 1 git）

> 下表 21 行里 `pi-edit-guard`、`pi-undo-redo` 已卸载（前者的删除线保留作决策记录，见 §7.1），**实际在用 19 个**。

**不锁版本**：安装命令一律不带 `@版本号`（取 npm 最新），本清单不维护版本矩阵。要查本机实际装的版本：

```bash
node -e 'const{execSync}=require("child_process"),fs=require("fs");
execSync("pi list",{encoding:"utf8"}).split("\n").filter(l=>/^\s+(npm|git):/.test(l)).map(l=>l.trim())
 .forEach(s=>{const n=s.split(":").slice(1).join(":");
  try{console.log(n,"→",JSON.parse(fs.readFileSync("C:/Users/yinxuehao/.pi/agent/npm/node_modules/"+n+"/package.json","utf8")).version)}catch{console.log(n,"→ (git)")}})'
```

### 1.1 核心层（先装，装完先跑一次冒烟）

| 包 | 作用 | 备注 |
|---|---|---|
| `npm:pi-web-access` | 网页搜索 / 抓取 | 大输出工具，用前先看 §5 缓存纪律 |
| `npm:pi-tps` | 底部 token/speed 状态栏 | 装后跑 `fix-tps-theme.ps1` 让配色跟随系统主题 |
| `npm:@injaneity/pi-computer-use` | 桌面截图 / 点击 / 输入 | **唯一需批准 install 脚本的包**，见 §3.1 |
| `npm:pi-one-ui` | TUI 统一美化（Header/Context/WorkingLine/Editor/Footer） | 取代旧 `alps-pi`；要求 Node ≥22.19、Pi ≥0.84 |
| `npm:pi-cache-guardian` | 缓存命中巡检 + 前缀漂移告警 | 与 §6 的 prefix-stabilizer 是同一根因的两端，一并用 |
| `npm:@tian.zuo/pi-find` | `grep` / `find` 工具 | **覆盖内建同名工具**（替换，不是并列）。本机只用它的 `grep`；`find` 已降为懒加载兜底（见 §4.1） |
| `npm:pi-edit-guard` | 覆盖内建 `edit` + 注册 `undo` | **已卸载**，见 §7.1（要装的话注意与 smart-edit 争 `edit` 槽） |
| `npm:@trycedar/pi-mdiff` | `md_inspect` / `md_diff` / `md_edit` | Markdown 结构化编辑，`.md` 改动优先用它 |
| ~~`npm:pi-undo-redo`~~ | 会话 / 文件撤销重做 | **已卸载**（`pi remove npm:pi-undo-redo`），本机有 git + `edit` 精确替换，撤销走 git / 编辑历史；会话级撤销暂缺 |
| `npm:pi-mcp-adapter` | 一个 `mcp` 代理工具替代成百上千个 MCP 工具定义 | 装完重启自动读 `.mcp.json` |
| `npm:pi-agent-browser-native` | 原生 `agent_browser*` 工具（8 个） | 要求 Pi ≥0.86.1；本机 0.87.1 满足，**不需要**兼容补丁 |
| `npm:@agenticup/pi-loop` | `loop` 递归深潜工具 | 入口是 `extensions/loop.ts`，不是 `dist/index.js` |
| `git:github.com/qq458249269/pi-lazy-tools` | 按需工具加载（`omnify` 一站式：搜索 / 补参 / 代理执行） | **fork，含 jiti 加载器补丁**；npm 版 `@wolido/pi-lazy-tools` 已下架。**0.4.0 是 breaking**：常驻名单从自建 `~/.pi/lazy-tools.json` 改读 pi 的 `defaultTools`（见 §3.4）。本地 clone 在 `D:\AI\pi-lazy-tools`，改完直接 commit + push，`pi update --extensions` 就能带上 |
| `npm:@zhushanwen/pi-smart-context` | 智能压缩：注册 `compact_context` 交 agent 自决 | **必做配置**见 §3.2 |
| `npm:pi-prefix-stabilizer` | 系统提示词前缀稳定 + 漂移检测 | 与 compaction-cache 有先后要求，见 §2.2 |
| `npm:pi-compaction-cache` | 摘要调用复用已缓存前缀 | **必做配置**见 §3.3；实测把压缩调用自身命中从 1.6% 拉到 98.8% |
| `npm:pi-warm-cache` | 空闲期按厂商 TTL 续前缀缓存 | **本机不生效**（本地代理属未注册路由），纯静默待命 |
| `npm:@henryqw/pi-ask-question` | `ask_question` 交互式提问（单题，1–3 选项 + 自定义答案，首项为推荐） | 歧义时问用户，比猜省事 |
| `npm:@ssk_dev/rpiv-todo-lean` | `todo` 任务清单工具 + TUI overlay | `ctrl+shift+t` 折叠；`/todos` 看全量 |
| `npm:@aboutlo/pi-smart-edit` | 覆盖内建 `edit`，容忍引号/空白不匹配 | **已生效**；`edit` 归它，匹配走「精确 → NFKC 归一化行」 |
| `npm:pi-dsh-pet` | 桌面宠物：Electron 透明浮窗 + 91 个 WebM 动画，随 agent 状态（思考/写代码/空闲）切换 | **纯命令扩展**（`/pet` `/pet-stop`），零工具、零 wire 开销。**必须 `pi install`**，光 `npm i -g` pi 不加载（见 §3.6）；解包 48MB，首次 `/pet` 另下 Electron ≈100MB。常驻与「整机只留一只」由本仓库的 `pi-pet-autostart.ts` 接管 |

### 1.2 本地扩展（不走 `pi install`，放 `~/.pi/agent/extensions/`）

仓库 `extensions/` 是 canonical 源，`node install-local-extensions.mjs` 幂等同步到用户目录（`--check` 只体检、有漂移 exit 1）。

| 文件 | 作用 |
|---|---|
| `pi-lean-prompt.ts` | 裁 `payload.tools` 里 `edit`/`read` 的 description 与 schema 样板文字（**只改文字、不动字段结构**，故与 smart-edit / one-ui / undo-redo 兼容） |
| `pi-lean-sections.ts` | 压 wire 上 system 的 `<docs>` / `<skills>` 两块（见 §6.2） |
| `pi-fd.ts` | 注册 `fd` 工具（fd 原生接口），**取代 pi-find 那个只认 glob 的 `find`**（见 §4.1） |
| `no-find.ts` | **不注册工具**，只挂 `tool_call` 钩子：命令行里出现 `find` 就 block，并提示改用 `fd`（见 §4.2） |
| `pi-pet-autostart.ts` | 让 `pi-dsh-pet` **默认常驻且整机只留一只**：TUI 会话一开就派发 `/pet`，已有宠物窗就复用不新开，跨会话/多开 pi 也只一只。不注册工具，只挂 `session_start` + `/pet-auto` 开关。配置见 §3.6 |

> 曾经的 `pi-shell.ts`（把 `bash`+`powershell` 合成 `shell`）**已删除**：它不是 pi 内置也不是 npm 包，纯本仓库自写；它带的 `-156B` 收益抵不上维护成本，改用内建 `bash`（见 §6.1）。注意它在 `session_start` 里会无条件隐藏 `bash`/`powershell`，所以 `shell` 与 `bash` 只能二选一。

### 1.3 Skills（可选，非扩展）

| 技能 | 安装 | 用途 |
|---|---|---|
| `cangjie-skill`（仓颉） | `git clone github.com/kangarooking/cangjie-skill` | 把书 / 长视频 / 播客 / 课程蒸馏成可执行 skills |
| `goutoujunshi`（狗头军师） | `git clone github.com/shengjidaguai-china/goutoujunshi` | 恋爱军师与情绪支持 |

> skill 不再常驻注入系统提示词（见 §6.2），需要时用 `omnify` 检索。

---

## 2. 安装

### 2.1 顺序循环

**`pi install` 一次只写一条注册，绝不能并行**（并行会竞写 `settings.json` 丢包）。照序跑：

```bash
for p in pi-web-access pi-tps @injaneity/pi-computer-use pi-one-ui pi-cache-guardian \
         @tian.zuo/pi-find @trycedar/pi-mdiff \
         pi-mcp-adapter pi-agent-browser-native @agenticup/pi-loop; do
  pi install "npm:$p" || echo "[失败] $p"
done

# 有硬顺序的后续
for p in @zhushanwen/pi-smart-context \
         pi-prefix-stabilizer pi-compaction-cache pi-warm-cache \
         @henryqw/pi-ask-question @ssk_dev/rpiv-todo-lean \
         @aboutlo/pi-smart-edit pi-dsh-pet; do
  pi install "npm:$p" || echo "[失败] $p"
done

# git 源单独装
pi install git:github.com/qq458249269/pi-lazy-tools

# 本地扩展（含 pi-pet-autostart.ts，宠物默认启用就靠它）
node install-local-extensions.mjs
```

装完自查：`pi list` 应见 **19 个扩展**（18 npm + 1 git），`settings.json` 的 `packages` 19 条。少于 18 就是并行竞写伤痕，重跑补漏。

### 2.2 硬顺序约束

- `pi-compaction-cache` 必须在 `@zhushanwen/pi-smart-context` **之后**：两者都接 `session_before_compact`，靠后拿到的接管权；反过来压缩调用命中会退回 1.6%。
- `pi-prefix-stabilizer` 必须在 `pi-compaction-cache` **之前**：先稳前缀再谈复用。
- 其余顺序不限（`pi-warm-cache` / `pi-ask` / `rpiv-todo-lean` 都不抢 `session_before_compact`）。
- `pi-dsh-pet` 放哪都行：纯 UI 扩展，只广播事件不改 prompt；它的 `tool_call` 钩子只 `broadcast` 不 block，与 `no-find.ts` 的拦截钩子可共存（实测 `extension_error` 0）。

### 2.3 升级

```bash
pi update --extensions        # 只升扩展，不动 pi 本体（--all 会连 pi 一起升）

# 升完先看谁动了（fork 与 major 变更最容易出兼容问题）
node .sc-test/versions.mjs             # 本机实际版本（升级前先留一份对比）
node .sc-test/check-ext-errors.mjs     # 加载期体检：extension_error 应为 0
```

**升级禁用 `pi install`**：对已装包会命中 npm 缓存、不升版本。升级一律走 `pi update --extensions`（不带版本号 = 取各包 npm 最新）。升级后跑 §8 体检。

> 首次安装（§2.1）同样不带版本号，npm 自动解析 latest；**本仓库任何位置都不写死扩展版本号**。
> `pi-dsh-pet` 也会被这条命令带着升（它带 48MB 动画资源，弱网下别反复升）；升完第一次 `/pet` 若要重下 Electron，等它跑完即可。

**处理办法见 §3.4；升完必跑一次 bench 确认 wire 工具集没变**（本次实测未变：升完是 8 个工具 / 8317B，`extension_error` 0；随后按「只保留默认工具」收敛为 6 个 / 6010B）。

### 2.4 卸载

```bash
pi remove npm:<包名>
```

卸载后同步删掉只为它存在的配置（例：`pi-footer-template` 卸载时连带删 `~/.pi/agent/pi-one-ui.json`），否则留下死配置。

---

## 3. 必做配置

### 3.1 批准 install 脚本（仅 2 个包）

```bash
npm install-scripts approve @injaneity/pi-computer-use better-sqlite3
```

`allowScripts` 里只有这两个。其余包实测均无 install 脚本。

### 3.2 smart-context：`~/.pi/agent/config/smart-context-ext-config.json`

```json
{ "enabled": true, "compactModel": { "type": "ref", "ref": "" }, "reminderThresholds": [60000, 75000, 90000], "excludedModels": [] }
```

- `compactModel.ref` 空串 = 与当前会话同模型（same-model 模式）。
- `reminderThresholds` 是 100K 窗口下的三档提醒（token 绝对数，升序）；**默认值 400K/500K/600K 对本机 100K 窗口永远不触发**，必须调低。
- 路径是 `<agentDir>/config/`，不是 `<agentDir>/`。

### 3.3 compaction-cache：`~/.pi/agent/compaction-cache.json`

```json
{ "models": ["1", "1/1"], "scope": "boundary", "logPath": "C:/Users/yinxuehao/.pi/agent/logs/compaction-cache.log", "debug": false }
```

- `models` 是 matcher，**漏了会直接 decline**（本机模型无 cost 元数据，走 zero-cost heuristic 拒绝接管）。
- `scope: "boundary"` 让压缩请求锚在对话边界，前缀最齐。
- `/compaction-cache-status` 看逐次判定，日志落 `logPath`。

### 3.4 懒加载常驻集 = `settings.json` 的 `defaultTools`

一个字段两用：pi 用 `defaultTools` 决定「哪些内建工具注册」，`pi-lazy-tools` 用它决定「谁不被懒加载」（项目级整体覆盖用户级）。本机两处写同一份名单：

```jsonc
// ~/.pi/agent/settings.json 与 <项目>/.pi/settings.json
{ "defaultTools": ["read", "edit", "write", "bash"] }
```

> **本机就选 pi 的内置默认 4 个**（`dist/core/sdk.js:140` 的 `defaultActiveToolNames`），一个扩展工具都不加：搜文件名/目录、搜内容全部交给 `omnify` 按需激活。换来 `8317B → 6010B`（**−2307B ≈ −641 tok/请求**，见 §6.3），代价是每次搜索多 1–2 个往返轮次。
> **`omnify` 不写进 `defaultTools`**：它由 lazy-tools 在 `session_start` 无条件写进 active 集（`setActiveTools`），写不写都一样。
> **`grep` / `fd` 不写也会注册**（扩展注册不过内建闸），只是被 lazy 隐藏；`omnify` 能把它们搜出来并执行（已实测）。**内建的 `ls` / `powershell` 搜得出、却执行不了**（pi 用内部工厂造它们，`sourceInfo` 是合成标记 `<sdk:ls>`，没有可 import 的源码）→ 这类需求一律 `bash ls`。fork 已把这个原因写进 omnify 的失败文案（见 §7.3）。
> **`~/.pi/lazy-tools.json` 已删除**（2026-09-29，`pi-lazy-tools` 0.4.0 起只告警不读取；旧副本 `lazy-tools.json.bak` / `.bak2` 同日一并删掉，内容已进 `defaultTools`）。新装扩展**不要**往 `defaultTools` 里加（硬规则，见 §5 第 0 条）。
> 改完 `/reload` 生效（不必重启会话）。

### 3.5 工具注册闸：`defaultTools`（项目 + 用户两处都要写）

项目 `.pi/settings.json` 与 `~/.pi/agent/settings.json` 都要写上一节那份名单，否则进了某项目就被整体覆盖成内建默认（`read bash edit write`）。本机两处写的正是这份默认名单，所以项目间切换不会有差异。

> ⚠️ 0.4.0 之前这里确实是「两道闸」（`defaultTools` 管注册 + `lazy-tools.json` 的 `resident` 管常驻），**现在合并成一道**，只查 `defaultTools`。

### 3.6 桌面宠物：默认启用配置

上游 `pi-dsh-pet` **没有任何自动启动开关**（只注册 `/pet` `/pet-stop`），装完还得每次手敲 `/pet`。本机用本地扩展 `extensions/pi-pet-autostart.ts` 补这一层：TUI 会话一开就派发 `/pet`，**整机只留一只**（切会话 / 树跳转 / `/reload` / 多开 pi / 已有别的会话的宠物窗，都不叠第二只）。

配置 `~/.pi/agent/extensions/pi-dsh-pet.json`（**默认启用**，本机已写）：

```json
{ "autostart": true, "size": "normal", "delayMs": 400, "maxPets": 1, "bridge": true }
```

- `autostart: false` → 不自动弹（仍可手敲 `/pet`）；**只认显式 `false`**，写错类型（如 `"false"`）仍按启用算，避免宠物莫名消失。
- `size`：`small`(260) / `normal`(400) / `large`(540)，非法值按 `normal`（档位表在上游 `pi/assets/pet.js` 的 `SIZE_MAP`）。
- `delayMs`：等上游 HTTP 服务（随机端口 10240–49151）就绪的延时。上游 handler 自己也能补起服务，这一步纯稳态。
- `maxPets`：**同时最多几只**（1–8，默认 1）。已经超了就 `/pet-auto cleanup` 收掉多余的。
- `bridge`：复用别人的窗时是否把本会话事件转发过去（默认开）。
- 文件缺失 / 读坏 = 按**启用**处理（读坏会 `notify` 一次），与 `no-find.json` 同一套约定。
- 会话内随手切：`/pet-auto on|off|size <档位>|max <只数>|bridge on|off|status|cleanup|restart`，改动写回同一个 json。

#### 3.6.1 「只许一只」是怎么限住的

只做自动启动必然越弹越多，原因是两个**跨进程**的口子（按 pid 记账根本拦不住，实测本机一度开到 9 扇窗）：

| 口子 | 现象 | 闸 |
|---|---|---|
| 每个会话一扇窗 | 换会话 / `/reload` / 多开一个 pi = 新 pid = 又一扇窗 | **窗口闸**：`session_start` 先扫全机宠物窗（`pet-electron.cjs <port>` 主进程，wmic ≈0.4s，PowerShell CIM 兜底），已有 ≥ `maxPets` 扇就**复用**不派发；再叠一个 `mkdir` 原子锁挡住「两个会话同时开」的竞态 |
| 一扇窗里 `add_pet` | 上游 `/pet` 在窗已开时不是新开窗，而是广播 `add_pet:<size>` 让窗里**再加一只** | **数量闸**：在 `WebSocket.prototype.send` 上挂钩子，`maxPets=1` 时丢掉 `add_pet*` 帧，其余原样放行 |

两个容易踩的细节：

- 扫进程要认 **`pet-electron.cjs`** 这个特征，不能认 `pi-dsh-pet`——上游那一条启动链有 `cmd.exe`→`node.exe`(npx)→`electron.exe` 三个进程的命令行都带 `pi-dsh-pet`，只有主进程带 `pet-electron.cjs <port>`。认错了会把一只数成三只。
- 钩子必须**从上游自己的入口文件起算 `require('ws')`**（`pi.getCommands()` 里 `/pet` 的 `sourceInfo.path`）。这机器上 `agent/node_modules/ws` 与 `agent/npm/node_modules/ws` 是两份不同实例，打在错的实例上等于没打。

**复用时的事件桥**：复用的窗连的是**别的** pi 进程的服务，只听那个进程的广播。扩展会再连一条 WS 当转接头，把本会话的 `agent_start` / `thinking`（2s 节流，与上游同）/ `tool_call` / `agent_idle` 用同样的消息格式转发过去，于是「一只宠物」照样跟着**每个**会话的思考、敲代码动。没有 ws 依赖就静默跳过（宠物照常呼吸，只是不跟本会话联动）。

`/pet-auto` 常用：`status`（当前几只 / 上限 / 拦下几次 add_pet / 钩子装没装）、`cleanup`（关掉多余的、保留最老的一只）、`restart`（全关掉再在本会话开一扇新的）、`max 2`（允许多只）。

**为什么是「派发命令」而不是自己 spawn Electron**：端口是上游在 `session_start` 里现找的空闲端口，外部拿不到；派发 `/pet` 则由它自己的 handler 决定「开窗 / 未起则先起服务」，连 Windows 自动切 npmmirror 镜像都走它自己的代码。派发路径是 pi 官方的 `sendUserMessage(..., { expandPromptTemplates: true })` → 命令执行完直接 `return`，**不进 prompt、不起 LLM 轮次**。

**零 token 成本（实测）**：`pi-dsh-pet` 与 `pi-pet-autostart` **都不注册工具**，不进 `defaultTools`（§3.4 硬规则）。装完跑 bench：system 3026B + tools 2984B（6 个）= **6010B，与装之前逐字节一致**。

**安装路径的坑**：上游 README 写的是 `npm install -g pi-dsh-pet`，但 **pi 不扫全局 `node_modules`**——只全局装的话 `/pet` 根本不存在。必须在 pi 里注册一次（`pi install npm:pi-dsh-pet`），本机两份都装了，加载的是 `~/.pi/agent/npm/node_modules` 那份（`pi update --extensions` 也能升它）。想只留一份可把全局那份当本地源：`{ "source": "D:/resp/npm/npm-global/node_modules/pi-dsh-pet" }`（不复制，但就不再跟 `pi update` 走了）。

**首次开窗会下 Electron ≈100MB**（上游在 Windows 自动设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）；包里 91 个透明 WebM，`assets/thumb` 解包 48MB。

验证：`node .sc-test/probe-pet-autostart.mjs`（**64 个 case**，探针默认测**仓库里的源文件**并在开头报「仓库 vs 已装副本」的漂移——不同步时 pi 跑的根本不是你刚改的代码）。覆盖配置解析、只在 tui 弹、只弹一次、pid 记账、`/pet-auto` 写回、**单只限制**（已有窗→复用、`maxPets`、锁抢占/陈旧锁、`cleanup`/`restart`、ws 钩子真起服务验证 `add_pet` 被丢），以及 2026-09-29 补的 5 组回归：**端口验活**（`dead` 判孤儿并收掉 / `unknown` 保守放过）、**事件桥端到端**（真起 ws 服务，验证 `thinking`/`tool_call` 真的发得出去）、**`/reload` 后桥仍在**、**扫不动 ≠ 没有窗**、**status 摊开活窗/孤儿/桥状态**。探针用 `globalThis.__piPetScanWindows` / `__piPetKillWindow` / `__piPetProbePort` 顶掉扫进程、taskkill、端口探测，不会误动真实宠物。末条 case 查真实机器上是否只剩一只（**红了就说明机器上真有多只，跑 `/pet-auto cleanup`**）。回退：`pi remove npm:pi-dsh-pet` + 删 `extensions/pi-pet-autostart.ts` 与 `pi-dsh-pet.json` 再 `/reload`。

**已知残留**：上游 `pet-electron.cjs` **没有** `app.requestSingleInstanceLock()`，即窗口层零单例保护，且 `electronProc` 是进程内变量、看不见别的进程的窗。所以「整机一只」完全是本扩展在**外面**兜的；一旦本扩展没跑起来（`autostart:false`、非 tui 模式、配置坏到读不出）而有人手敲 `/pet`，就可能多一扇。**这也是当初评估「要不要 fork 上游」的唯一真实理由**——本次先把扩展侧四个成因修完，fork 留作备选。

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
| `pi-smart-context` | `compact_context` |
| `@agenticup/pi-loop` | `loop` |
| `pi-mcp-adapter` | `mcp` |
| `pi-agent-browser-native` | `agent_browser` 及 7 个配套 |
| `pi-lazy-tools`（fork） | `load_tools` `call_tool` |
| `pi-warm-cache` / `pi-prefix-stabilizer` / `pi-compaction-cache` / `pi-cache-guardian` | 无工具（纯事件钩子） |

**一道闸：`defaultTools`**（0.4.0 前是「`defaultTools` 管注册 + `resident` 管常驻」两道，0.4.0 起合并）：

| 工具 | 在 `defaultTools` 里？ | 后果 |
|---|---|---|
| `read` `write` `edit` `bash` | ✅ 在列 | 纯内建：不在列就不注册；本机就到这四个为止 |
| `grep` | ❌ 未列 → 懒加载 | pi-find 注册（扩展不占注册闸）；`omnify` 可搜出并执行 |
| `fd` | ❌ 未列 → 懒加载 | 本地 `pi-fd` 注册，同上 |
| `find` | ❌ 未列 → 懒加载 | 同一底层（fd）但只认 glob，作为 `fd` 的兜底 |
| `ls` `powershell` | ❌ 未列 → 懒加载 | 需要时 `omnify` 按名 load 回来（或用 `bash ls`） |
| `web_enable` / `todo` / `loop` / `md_*` / `ask_question` / `compact_context` / `mcp` / `agent_browser*` | ❌ 未列 | 全部默认懒加载，用 `omnify` 按需检索（`web_enable` 例外：pi-web-access 自己在 `session_start` 写进 active 集，实测 wire 上可见） |
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

**常驻 vs 懒加载的代价（实测）**：`fd` 若常驻，单它就 1280B + system 多一行简介与 guideline；若懒加载，0 upfront。**本机选懒加载**（`fd` 与 `grep` 都不在名单里），见 §3.4 / §6.3。

**fd 的两个反直觉点（已踩，代码里有注释）**：

1. **省略 pattern 时必须显式传空串**。否则唯一的 position 会被 fd 当成 pattern（`fd -t d .git` 返回空，`fd -t d "" .git` 才出结果）——「列出全部」是这个工具的主卖点。
2. **`--glob` 是「把 pattern 换成 glob」，不是额外过滤器**。glob 模式下再传位置 pattern 会被 fd 当成第二个搜索路径（报 `Search path 'capture' is not a directory`）。故工具里 `glob` 与 `pattern` 互斥。

验证：`node .sc-test/probe-fd.mjs`（13 个 case，含上面两个回归）、`node .sc-test/measure-fd.mjs`（wire 字节）、`/fd-check`（fd 可执行文件解析）。回退：删 `extensions/pi-fd.ts` 再 `/reload`（`fd` 懒加载与否都不影响其余工具）。

---

### 4.2 全局禁用 `find`（本仓库 `extensions/no-find.ts` + 系统层 stub）

**为什么要禁**：本机 `find` 有两个不同的东西，症状都是「卡死」：
- `C:\Windows\System32\find.exe`（cmd/PowerShell 里的 FIND.EXE）：语法与 GNU find 完全不同，`find . -name x` 被当成「pattern + 无文件名」→ **从 stdin 读**，表现就是永远不返回；
- Git Bash 的 `/usr/bin/find`：语法对，但没有 ignore/类型/深度过滤，在大目录树上能跑几分钟（`find .` 从家目录起步就够呛）。

**四层封锁**（前两层管模型，后两层管你自己）：

| 层 | 位置 | 覆盖 | 实测 |
|---|---|---|---|
| pi 钩子 | `extensions/no-find.ts` → `tool_call` | `bash` / `powershell` 命令行里的 `find`（含 `find.exe`、`xargs find`、`$(find …)`、管道后 `| find`）+ pi-find 的 `find` **工具** | `probe-no-find.mjs` 22 个 case 全过；真 pi 里 `extension_error` 0 |
| bash（全局） | 用户环境变量 `BASH_ENV=C:\Users\yinxuehao\bin\no-find.sh`（非交互 `bash -c`）+ `~/.bashrc` 同款函数（交互） | 任何 bash，包括脚本 | `find` → 拒答 + exit 127；`fd` 正常 |
| cmd（交互） | `HKCU\...\Command Processor\AutoRun` 里的 doskey 宏 | 交互式 cmd 提示符 | doskey 宏**只在交互命令行展开**，`cmd /c` 不受影响 |
| PowerShell（交互） | `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` 里的 `function find` | 交互式 PowerShell | **本机没生效**：执行策略全是 `Undefined`（= 默认 `Restricted`），profile 根本不加载；要生效得 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`（安全策略变更，**没擅自改**） |

> `find.cmd`（`~/bin/find.cmd`）也备好了，但**默认盖不住 System32**：Windows 合并 PATH 是「机器 PATH 在前、用户 PATH 在后」，`~/bin` 在用户 PATH 里 → 只有当 `~/bin` 被排到 System32 之前（改机器 PATH，需管理员）才生效。要真在 `cmd /c` 里也拦，只能动机器 PATH 或改 System32 文件，**都没做**。

**判定规则**（`detectFindCommand`，可单测）：按 `;` `|` `&&` `||` 换行切段，递归摊开 `$( )` 与反引号，再剥掉 `sudo` / `env FOO=1` / `xargs` / `nohup` / 前置重定向，看每段**首词的 basename** 是否等于 `find` / `find.exe`。所以 `./find-helper.sh`、`findings.md`、`grep -rn "find me"`、`node scripts/find-them.js`、`fd`、`fdfind` 一律放行。

**开关**：`~/.pi/agent/extensions/no-find.json` → `{"enabled": false}` 整体停用；`{"allow": ["find -name *.go"]}` 按「首词 + 第二个词」前缀放行个别命令。配置坏了按「启用」处理（宁可多拦，不静默失效）。

**回退**：`powershell -ExecutionPolicy Bypass -File .sc-test/enable-global-nofind.ps1 -Undo` 还原 `PATH` / `BASH_ENV`（原值备份在 `~/.pi/agent/no-find-global.json`）；删 `extensions/no-find.ts` + `/reload` 关掉 pi 内那层。

---

## 5. 使用纪律

0. **新装扩展一律不进常驻集**（硬规则）。装完只保证**能加载**、不报 conflict，**不要**顺手把它的工具名加进 `defaultTools`。它们默认就是懒加载状态，靠 `omnify` 检索 → 按需激活。
   - 理由：常驻集每轮都进 prompt（`grep`+`find` 就要 +1350B ≈ 350 tok），而多数扩展一天用不到几次。
   - **只有这三类才加常驻**：① 高频工具（见 §6.3 的取舍）；② 覆盖内建工具的（`grep`/`find`/`edit` 需先过 `defaultTools` 闸）；③ 缺失后 agent 会“瘫”的（如 `bash`）。
   - 例外：无。`grep` / `fd` 也只是「需要时 `omnify` 激活」，不进名单（§6.3）。
   - 验证新装扩展是否真的零开销：`node .sc-test/bench/run.mjs <标签> ...` 看 `toolsBytes` 是否与基线一致（§9）。
1. **首字成本**：常驻集每轮都进 prompt；不在名单的工具靠 `omnify` 检索命中后一次性注入。
2. **激活往返**：0.86+ 流程是 `omnify`/`load_tools` → `call_tool` → 执行，多 1–2 个模型轮次。搜索类工具建议常驻（见 §6.3）。
3. **大输出工具**（`web_search` 等）原始 HTML/JSON 全量进历史，会把前缀命中率打崩；用前先想清楚要不要落历史。
4. **改 `.md` 优先 `md_edit`**：散文/列表用 `md_edit`（锚定标题+块序号，不受换行重排影响），代码块用 `edit`，`.mdx` 一律用 `edit`。
5. **不装的东西**：`pi-observational-memory`（治压缩后记忆断层，方向不同）、`pi-deepseek-cache`（绑定 DeepSeek）、`pi-cache-optimizer`（与 guardian 重叠）——都不解决本机的主要成本（system 字节），装了只是多一份常驻负担。
6. **纯 UI 类扩展可以放心装**：`pi-tps` / `pi-one-ui` / `pi-dsh-pet` / `pi-pet-autostart` 这类只挂事件钩子、只注册命令的扩展，**不注册任何工具**，不进 `defaultTools`，wire 字节不变（§3.6 有 bench 实测：装宠物前后都是 6010B）。反过来，任何**注册工具**的扩展都要重新算 §6.3 那笔账。

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

> **本机现状（2026-09-29 六次变更后）**：卸 `pi-edit-guard` 交 smart-edit 接管 `edit`，卸 `pi-shell` 改用内建 `bash`，最后把常驻集收回 pi 内置默认 4 个（§3.4）→ wire 上 **6 个工具** `bash edit omnify read web_enable write`，system **3026B** + tools **2984B** = **6010B ≈ 1669 tok/请求**（vs 优化前 11351B ≈ 2948 tok，**累计 −5341B ≈ −1279 tok / −47%**）。`grep` / `fd` 仍注册，按需 `omnify` 激活。

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
| 常驻 grep+find（`ls` 懒加载，内建 `bash`） | 3050B | 4336B（8 个） | 7386B | vs 本机 **+1376B ≈ +358 tok/请求** |
| 常驻 grep+fd | 3205B | 5112B（8 个） | 8317B | vs 本机 **+2307B ≈ +641 tok/请求** |
| **本机现状**（只留内建默认 4 个） | 3026B | 2984B（6 个） | 6010B | — |

单工具 wire 字节：`grep` 846B、`fd` 1280B、`ls` 472B（`find` 若常驻是 504B）。

- **常驻**：每请求 +473 tok（首请求全价，之后走 cacheRead，本机本地端点基本免费），换搜索工具**直接可调、0 额外往返**。
- **懒加载**：0 upfront；要用时多 1–2 个模型轮次，并把同样的字节永久注入历史。
- **本机取舍（最终：只留内建默认 4 个）**：`defaultTools` 就是 `read edit write bash`，`grep` / `fd` / `ls` / `find` 全部懒加载，搜文件先 `omnify` 一步激活。**省 2307B ≈ 641 tok/请求**，代价是每次搜索多 1–2 个往返轮次（本机本地端点，这些轮次几乎不花钱，只花时间）。
  - 曾经选过方案 B（`grep` + `fd` 都常驻，8317B）：那时判断「搜索是编码高频操作，省轮次比省字节值」；现按「只保留默认」收敛，**要回退就把 `"grep"` / `"fd"` 加回两处 `defaultTools` 即可**（+2307B）。
  - 无论常驻与否，`fd` 的能力都远胜 pi-find 的 `find`（§4.1 五项），常驻与否只影响字节与往返，不影响能力。

### 6.4 优化后的静态前缀总账

`system 3026B + tools 2984B = 6010B ≈ 1.7k tok/请求`，相比优化前 `6758 + 4593 = 11351B ≈ 2.9k tok`，**累计 −47%**。

> 2026-09-29 装 `pi-dsh-pet` + `pi-pet-autostart` 后重跑 bench：**仍是 3026B + 2984B = 6010B、6 个工具、`extension_error` 0**，字节没动（两者都不注册工具，见 §3.6）。

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

**故意保留**：

- `~/node_modules/@earendil-works*@0.85.1`：一棵自洽的 0.85.1 生态，`@wolido/pi-lazy-tools` 依赖它，删了会连带坏掉。pi 自身的扩展从 `~/.pi/agent/node_modules`（0.87.1）解析，**不会走到家目录那份**；pi-web-access 报的 "Dynamic tool activation requires Pi 0.86.1 or newer" 属误报。

### 7.3 `omnify` 的两个 fork 修复（2026-09-29，`e972047`，已 push）

本地 clone `D:\AI\pi-lazy-tools`（remote = 你的 fork）改完直接 commit + push，`pi update --extensions` 就会带上；改前先看 `npm test`（`node --import tsx --test`）。

1. **内建工具执行不了却说「执行定义加载失败」**：pi 内建工具由内部工厂生成，`sourceInfo` 是合成标记（`agent-session.js:2502` `createSyntheticSourceInfo('<sdk:ls>', { source: "sdk" })`），jiti 没法 import。新增纯函数 `lazy-tools/core.ts` 的 `nonLoadableSourceReason()`，**先判后 import**，直接给「内建工具 omnify 执行不了，请用 bash / powershell」的可执行原因。
2. **非指名模式下静默执行错工具（假成功）**：旧代码候选失败后无条件 `continue`；schema 宽松的 `mcp`（`Record<string, unknown>`）会照单全收，返回 `MCP: 0/0 servers, 0 tools` 冒充成功。改为：**候选一旦通过参数校验并开始执行，它就是最佳匹配，失败即最终失败**（`break`）；校验不符时仍按原逻辑（非指名继续试下一个，指名立即返回要求）。
   - **BREAKING**：不再有「首个候选失败后自动换一个工具」。
   - 回归：`npm test` 76 passed（新增 4 条），`tsc --noEmit` 干净；改动同步到已装副本 `~/.pi/agent/git/github.com/qq458249269/pi-lazy-tools/`，`check-ext-errors` 的 `extension_error` 0。

---

## 8. 体检与排障

```bash
# 加载期体检：扫 RPC 事件流里的 extension_error + stderr
node .sc-test/check-ext-errors.mjs
```

| 症状 | 原因 | 处置 |
|---|---|---|
| 扩展报 `Tool "x" conflicts with ...` | 两个扩展抢同一工具名 | 二选一卸载（见 §7.1） |
| 懒加载报 `Cannot find module` | lazy 执行层地基缺失（版本要与 pi 本体一致，别写死） | `npm i --prefix ~/.pi/agent @earendil-works/{pi-coding-agent,pi-tui,pi-ai}@$(pi --version \| grep -oE '[0-9]+\.[0-9]+\.[0-9]+')` |
| 工具调用不到、wire 上也没有 | 内建工具不在 `defaultTools`（不注册），扩展工具不在其中（被 lazy） | 改 `defaultTools`（§3.4），`/reload` |
| `fd` 报 “fd executable not found” | pi 自带副本与 PATH 都没有 fd | 跑 `/fd-check` 看解析结果；或 `npm i -g fd-find` |
| 会话/文件撤销 | `pi-edit-guard` 已卸载，其 `undo` 工具随之消失 | 文件级靠 git 或改前先 `read`；**会话级 `pi-undo-redo` 也已卸载**（2026-09-29），暂无可用替代，需要时再装回 |
| agent 没有 shell | `defaultTools` 里没有 `bash` | 写 `bash` 进两处 `defaultTools`（§3.4）；若 `extensions/pi-shell.ts` 被装回来，它会在 `session_start` 无条件隐藏 `bash` |
| 压缩后首轮命中低 | 正常现象 | 只有「命中 0」才是故障；压缩调用自身用 `pi-compaction-cache` 兜（1.6%→98.8%） |
| `pi-warm-cache` 没反应 | 本地代理属未注册路由 | 不是故障，`/warm status` 里 `automaticWarm:false` 即预期 |
| pi-agent-browser-native 报 `buildSessionProjection is not a function` | Pi < 0.86 | 本机 0.87.1 不会发生；若真发生跑 `node fix-browser-native-compat.mjs` |
| `/pet` 提示命令不存在 | 只 `npm i -g` 装过，pi 不扫全局 `node_modules` | `pi install npm:pi-dsh-pet` → `/reload`（见 §3.6） |
| 宠物窗口不弹 | 首次要下 Electron ≈100MB；或自动启动被关了 | 看启动提示；`/pet-auto status` 看当前开关；`/pet small` 换小号试；关掉了就写回 `{"autostart": true}` |

**磁盘布局速查**

| 路径 | 内容 |
|---|---|
| `~/.pi/agent/settings.json` | `packages` 注册表 + `defaultTools` |
| `~/.pi/agent/extensions/` | 本地扩展副本 + 各扩展的全局配置（如 `edit-guard-config.json`、`no-find.json`、`pi-dsh-pet.json`，**只放这里，放 agent 根下不生效**） |
| `~/.pi/agent/state/` | 跨会话记账（如 `pi-pet-autostart.json` 记「本 pid 已弹过窗 + 落在哪只宠物上」，`pi-pet-autostart.json.lock/` 是跨进程开窗锁） |
| `~/.pi/agent/git/` | git 源扩展（lazy-tools fork） |
| `~/.pi/agent/npm/node_modules/` | npm 源扩展 |
| `~/.pi/agent/config/` | smart-context 配置 |
| `<项目>/.pi/settings.json` | 项目级 `defaultTools`，**整体覆盖**用户级（且需项目被信任） |
| `~/.pi/agent/sessions/**/*.jsonl` | 会话历史，算命中率的原始数据 |

**生效方式**：改配置或扩展后 `/reload`（不重启会话、不丢历史）。

---

## 9. 怎么复测（结论过期了就自己重跑）

沙箱在 `.sc-test/bench/`（已 gitignore），不污染真实配置：

```bash
# 单场景：搭沙箱 → 起 mock provider → 抓首请求真实字节
node .sc-test/bench/run.mjs <标签> \
  userDefaultTools=read,edit,write,bash,grep,fd defaultTools=read,edit,write,bash,grep,fd \
  local=1
# 注：0.4.0 起常驻名单 = defaultTools，bench 的 `resident=` 只是它的别名

# 看结果：各块字节 + 关键内容判定
node .sc-test/bench/inspect.mjs <标签>

# 变体：local=lean|lean-shell|1|<逗号分隔文件名>  stripPkg=<子串>  provider=probe|real|realshape

# 升级前后各跑一次：版本对比 + 加载期体检
node .sc-test/versions.mjs
node .sc-test/check-ext-errors.mjs

# fd 工具单独体检（不起 pi）：13 个行为 case + wire 字节对比
node .sc-test/probe-fd.mjs            # 行为（改过 fd 调用就要跑）
node .sc-test/measure-fd.mjs          # 字节（改了 description/schema 就要跑）

# 宠物自动启动体检（不起 pi、不弹窗）：64 个 case（配置/派发时机/幂等 + 端口验活 + 事件桥端到端）
node .sc-test/probe-pet-autostart.mjs
```

沙箱要点：`PI_CODING_AGENT_DIR` 指向沙箱 agent 目录，`npm`/`git`/`node_modules`/`skills` 用 `mklink /J` junction 指向真实目录（**必须是反斜杠绝对路径**），项目级 `.pi/` 两份配置现写现用；mock 端口默认 18080（8799 在本机被占）。
