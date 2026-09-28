# Pi 扩展安装配置清单

本手册是一份**可直接照做的安装 + 配置清单**：装哪些、按什么顺序装、每个必做配置写什么、以及每条结论的实测依据。
扩展统一装在 `~/.pi/agent`（Windows：`%USERPROFILE%\.pi\agent`），下文路径均以此计。

**本机基线（所有实测都在这上面做的）**：Pi **0.87.1**、node **24.16.0**、npm 12、模型走本地代理 `http://localhost:20128/v1`（`openai-completions`，模型 id `1`，窗口 100K）。
换版本 / 换 provider 后，**先复测再信下面的数字**（见文末「怎么复测」）。

---

## 1. 清单（在用 19 个扩展 = 18 npm + 1 git）

> 下表 20 行里 `pi-edit-guard` 已卸载（删除线保留作决策记录，见 §7.1），**实际在用 19 个**。

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
| `npm:@tian.zuo/pi-find` | `grep` / `find` 工具 | **覆盖内建同名工具**（替换，不是并列） |
| `npm:pi-edit-guard` | 覆盖内建 `edit` + 注册 `undo` | **已卸载**，见 §7.1（要装的话注意与 smart-edit 争 `edit` 槽） |
| `npm:@trycedar/pi-mdiff` | `md_inspect` / `md_diff` / `md_edit` | Markdown 结构化编辑，`.md` 改动优先用它 |
| `npm:pi-undo-redo` | 会话 / 文件撤销重做 | 纯命令扩展，零工具 |
| `npm:pi-mcp-adapter` | 一个 `mcp` 代理工具替代成百上千个 MCP 工具定义 | 装完重启自动读 `.mcp.json` |
| `npm:pi-agent-browser-native` | 原生 `agent_browser*` 工具（8 个） | 要求 Pi ≥0.86.1；本机 0.87.1 满足，**不需要**兼容补丁 |
| `npm:@agenticup/pi-loop` | `loop` 递归深潜工具 | 入口是 `extensions/loop.ts`，不是 `dist/index.js` |
| `git:github.com/qq458249269/pi-lazy-tools` | 按需工具加载（`load_tools` / `call_tool`） | **fork，含 jiti 加载器补丁**；npm 版 `@wolido/pi-lazy-tools` 已下架 |
| `npm:@zhushanwen/pi-smart-context` | 智能压缩：注册 `compact_context` 交 agent 自决 | **必做配置**见 §3.2 |
| `npm:pi-prefix-stabilizer` | 系统提示词前缀稳定 + 漂移检测 | 与 compaction-cache 有先后要求，见 §2.2 |
| `npm:pi-compaction-cache` | 摘要调用复用已缓存前缀 | **必做配置**见 §3.3；实测把压缩调用自身命中从 1.6% 拉到 98.8% |
| `npm:pi-warm-cache` | 空闲期按厂商 TTL 续前缀缓存 | **本机不生效**（本地代理属未注册路由），纯静默待命 |
| `npm:@nguyenquangthai/pi-ask` | `ask_user_question` 结构化提问对话框 | 歧义时问用户，比猜省事 |
| `npm:@ssk_dev/rpiv-todo-lean` | `todo` 任务清单工具 + TUI overlay | `ctrl+shift+t` 折叠；`/todos` 看全量 |
| `npm:@aboutlo/pi-smart-edit` | 覆盖内建 `edit`，容忍引号/空白不匹配 | **已生效**；`edit` 归它，匹配走「精确 → NFKC 归一化行」 |

### 1.2 本地扩展（不走 `pi install`，放 `~/.pi/agent/extensions/`）

仓库 `extensions/` 是 canonical 源，`node install-local-extensions.mjs` 幂等同步到用户目录（`--check` 只体检、有漂移 exit 1）。

| 文件 | 作用 |
|---|---|
| `pi-lean-prompt.ts` | 裁 `payload.tools` 里 `edit`/`read` 的 description 与 schema 样板文字（**只改文字、不动字段结构**，故与 smart-edit / one-ui / undo-redo 兼容） |
| `pi-lean-sections.ts` | 压 wire 上 system 的 `<docs>` / `<skills>` 两块（见 §6.2） |

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
         @tian.zuo/pi-find @trycedar/pi-mdiff pi-undo-redo \
         pi-mcp-adapter pi-agent-browser-native @agenticup/pi-loop; do
  pi install "npm:$p" || echo "[失败] $p"
done

# 有硬顺序的后续
for p in @zhushanwen/pi-smart-context \
         pi-prefix-stabilizer pi-compaction-cache pi-warm-cache \
         @nguyenquangthai/pi-ask @ssk_dev/rpiv-todo-lean \
         @aboutlo/pi-smart-edit; do
  pi install "npm:$p" || echo "[失败] $p"
done

# git 源单独装
pi install git:github.com/qq458249269/pi-lazy-tools

# 本地扩展
node install-local-extensions.mjs
```

装完自查：`pi list` 应见 **19 个扩展**（18 npm + 1 git），`settings.json` 的 `packages` 19 条。少于 18 就是并行竞写伤痕，重跑补漏。

### 2.2 硬顺序约束

- `pi-compaction-cache` 必须在 `@zhushanwen/pi-smart-context` **之后**：两者都接 `session_before_compact`，靠后拿到的接管权；反过来压缩调用命中会退回 1.6%。
- `pi-prefix-stabilizer` 必须在 `pi-compaction-cache` **之前**：先稳前缀再谈复用。
- 其余顺序不限（`pi-warm-cache` / `pi-ask` / `rpiv-todo-lean` 都不抢 `session_before_compact`）。

### 2.3 升级

```bash
pi update --extensions        # 只升扩展，不动 pi 本体（--all 会连 pi 一起升）
```

**升级禁用 `pi install`**：对已装包会命中 npm 缓存、不升版本。升级一律走 `pi update --extensions`（不带版本号 = 取各包 npm 最新）。升级后跑 §8 体检。

> 首次安装（§2.1）同样不带版本号，npm 自动解析 latest；**本仓库任何位置都不写死扩展版本号**。

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

### 3.4 懒加载常驻集：`~/.pi/lazy-tools.json`

```json
{ "resident": ["read", "write", "edit", "bash", "find", "grep", "omnify"] }
```

### 3.5 工具注册闸：`defaultTools`（项目 + 用户两处都要写）

项目 `.pi/settings.json` 与 `~/.pi/agent/settings.json`：

```json
{ "defaultTools": ["read", "edit", "write", "bash"] }
```

> **`grep` 只需写进 `resident`**，不必加 `defaultTools`——它由 `@tian.zuo/pi-find` 注册，不受内建闸门约束。`bash` 则两处都要写。

---

## 4. 工具归属（谁注册了什么）

| 扩展 | 工具 |
|---|---|
| 内建 pi | `read` `write` `bash` `powershell` `edit` `grep` `find` `ls`（受 `defaultTools` 闸门控制） |
| `@tian.zuo/pi-find` | `grep` `find`（覆盖内建） |
| `@aboutlo/pi-smart-edit` | `edit`（覆盖内建），匹配走「精确 → NFKC 归一化行」，容忍引号/空白差异 |
| `@trycedar/pi-mdiff` | `md_inspect` `md_diff` `md_edit` |
| `pi-undo-redo` | 无工具（`/undo` `/redo` 等命令） |
| `@nguyenquangthai/pi-ask` | `ask_user_question` |
| `@ssk_dev/rpiv-todo-lean` | `todo` |
| `pi-smart-context` | `compact_context` |
| `@agenticup/pi-loop` | `loop` |
| `pi-mcp-adapter` | `mcp` |
| `pi-agent-browser-native` | `agent_browser` 及 7 个配套 |
| `pi-lazy-tools`（fork） | `load_tools` `call_tool` |
| `pi-warm-cache` / `pi-prefix-stabilizer` / `pi-compaction-cache` / `pi-cache-guardian` | 无工具（纯事件钩子） |

**两道闸（`defaultTools` 与 `resident` 必须同时满足才常驻）**：

| 工具 | `defaultTools` | `resident` | 说明 |
|---|---|---|---|
| `read` `write` `edit` `bash` | ✅ 需在列 | ✅ 需在列 | 纯内建 |
| `find` `grep` | ❌ 不需要 | ✅ 需要 | 由 pi-find 扩展注册，只受 resident 闸 |
| `ls` `powershell` | ✅/❌ | ❌ 未列 → 懒加载 | 需要时 `omnify` 按名 load 回来（或用 `bash ls`） |
| `web_enable` / `todo` / `loop` / `md_*` / `ask_user_question` / `compact_context` / `mcp` / `agent_browser*` | ❌ | ❌ | 全部默认懒加载，用 `omnify` 按需检索 |
| `omnify` | ❌ | 写不写都一样 | pi 核心无条件注册，**不受 resident 闸管辖**，常驻只是为了读起来清楚 |

漏了任一闸的后果（实测）：不在 `defaultTools` → **工具根本不注册**；不在 `resident` → 注册了但被 lazy 隐藏，wire 上看不到。

---

## 5. 使用纪律

1. **首字成本**：常驻集每轮都进 prompt；非 resident 的工具靠 `omnify` 检索命中后一次性注入。
2. **激活往返**：0.86+ 流程是 `omnify`/`load_tools` → `call_tool` → 执行，多 1–2 个模型轮次。搜索类工具建议常驻（见 §6.3）。
3. **大输出工具**（`web_search` 等）原始 HTML/JSON 全量进历史，会把前缀命中率打崩；用前先想清楚要不要落历史。
4. **改 `.md` 优先 `md_edit`**：散文/列表用 `md_edit`（锚定标题+块序号，不受换行重排影响），代码块用 `edit`，`.mdx` 一律用 `edit`。
5. **不装的东西**：`pi-observational-memory`（治压缩后记忆断层，方向不同）、`pi-deepseek-cache`（绑定 DeepSeek）、`pi-cache-optimizer`（与 guardian 重叠）——都不解决本机的主要成本（system 字节），装了只是多一份常驻负担。

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

> **本机现状（2026-09-28 五次变更后）**：卸 `pi-edit-guard` 交 smart-edit 接管 `edit`，再卸 `pi-shell` 改用内建 `bash` 并精简常驻集 → wire 上 **8 个工具** `bash edit find grep omnify read web_enable write`，system **3050B** + tools **4336B** = **7386B ≈ 1918 tok/请求**（vs 优化前 11351B ≈ 2948 tok，**累计 −3965B ≈ −1030 tok / −35%**）。

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
| **本机现状**（`grep`+`find` 常驻，`ls` 懒加载，改用内建 `bash`） | 3050B | 4336B（8 个） | 7386B | — |

单工具 wire 字节：`grep` 846B、`find` 504B、`ls` 472B（合计 1822B ≈ 473 tok）。

- **常驻**：每请求 +473 tok（首请求全价，之后走 cacheRead，本机本地端点基本免费），换搜索工具**直接可调、0 额外往返**。
- **懒加载**：0 upfront；要用时多 1–2 个模型轮次，并把同样的字节永久注入历史。
- **本机取舍（最终：方案 B）**：`grep` + `find` **都留常驻**（查内容 + 查文件名都是编码高频操作，省的是 1–2 个往返轮次而非 token）；`ls` 改用 `bash ls`、懒加载。
  - 对比过「砍掉 `grep`」的方案 A：6497B ≈ 1688 tok，比方案 B 少 889B ≈ 231 tok/请求。代价是**每次搜代码内容都要付 omnify 检索 + load + call 三步**，而那 846B 字节照样会永久进历史 → **不划算，故选 B**。
  - 反向开关：想再省那 231 tok，从 `~/.pi/lazy-tools.json` 的 `resident` 里删 `"grep"` 即可（不必动 `defaultTools`）。

### 6.4 优化后的静态前缀总账

`system 3050B + tools 4336B = 7386B ≈ 1.9k tok/请求`，相比优化前 `6758 + 4593 = 11351B ≈ 2.9k tok`，**累计 −35%**。

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

`undo` 的替代：会话级用 `pi-undo-redo`；文件级靠 git（或改前先 `read` 留底）。这与本机「有 git、改动走 `md_edit`/`edit` 精确替换」的习惯相容。

> 若哪天要回退：装回 `pi-edit-guard` 并卸 smart-edit 即可；或给 edit-guard 写 `~/.pi/agent/extensions/edit-guard-config.json` 的 `{"editOverrideEnabled": false}`（**必须是 `extensions/` 子目录，放 `~/.pi/agent/` 根下不生效**——已实测），让它只让出 `edit`、保留 `undo`。

### 7.2 其它遗留（2026-09-28 六次清理后只剩备份）

- `settings.json` 里的 `alps-pi` 死配置块（已被 pi-one-ui 取代）→ **已删**（2026-09-28 六次），删后 pi 启动与体检均正常。
- `~/.pi/agent/pi-hermes-memory/`（`pi-hermes-memory` 早已卸载）→ **已删**（19MB 死数据）。
- `~/node_modules/@earendil-works*@0.85.1`：**故意保留**。那是一棵自洽的 0.85.1 生态，且 `@wolido/pi-lazy-tools` 依赖它，删了会连带坏掉。pi 自身的扩展从 `~/.pi/agent/node_modules`（0.87.1）解析，**不会走到家目录那份**；pi-web-access 报的 "Dynamic tool activation requires Pi 0.86.1 or newer" 属误报，不影响功能。
- `.backup-20250915/`（仓库内未跟踪）与 `~/.pi/agent/settings.json.bak-*` ×4：**保留**。这是旧配置的唯一副本，删了不可逆；确认不再需要时可自行删。

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
| 工具调用不到、wire 上也没有 | 不在 `defaultTools`（不注册）或不在 `resident`（被 lazy） | 对照 §4 的两道闸 |
| 会话/文件撤销 | `pi-edit-guard` 已卸载，其 `undo` 工具随之消失 | 会话级用 `pi-undo-redo`（`/undo` `/redo`）；文件级靠 git 或改前先 `read` |
| agent 没有 shell | `defaultTools` 里没有 `bash` | 写 `bash` 进两处 `defaultTools` + `resident`；若 `extensions/pi-shell.ts` 被装回来，它会在 `session_start` 无条件隐藏 `bash` |
| 压缩后首轮命中低 | 正常现象 | 只有「命中 0」才是故障；压缩调用自身用 `pi-compaction-cache` 兜（1.6%→98.8%） |
| `pi-warm-cache` 没反应 | 本地代理属未注册路由 | 不是故障，`/warm status` 里 `automaticWarm:false` 即预期 |
| pi-agent-browser-native 报 `buildSessionProjection is not a function` | Pi < 0.86 | 本机 0.87.1 不会发生；若真发生跑 `node fix-browser-native-compat.mjs` |

**磁盘布局速查**

| 路径 | 内容 |
|---|---|
| `~/.pi/agent/settings.json` | `packages` 注册表 + `defaultTools` |
| `~/.pi/agent/extensions/` | 本地扩展副本 + 各扩展的全局配置（如 `edit-guard-config.json`，**只放这里，放 agent 根下不生效**） |
| `~/.pi/agent/git/` | git 源扩展（lazy-tools fork） |
| `~/.pi/agent/npm/node_modules/` | npm 源扩展 |
| `~/.pi/agent/config/` | smart-context 配置 |
| `~/.pi/lazy-tools.json` | 常驻工具集（用户级） |
| `<项目>/.pi/settings.json` | 项目级，**整体覆盖**用户级 |
| `<项目>/.pi/lazy-tools.json` | 项目级，**整体覆盖**用户级 |
| `~/.pi/agent/sessions/**/*.jsonl` | 会话历史，算命中率的原始数据 |

**生效方式**：改配置或扩展后 `/reload`（不重启会话、不丢历史）。

---

## 9. 怎么复测（结论过期了就自己重跑）

沙箱在 `.sc-test/bench/`（已 gitignore），不污染真实配置：

```bash
# 单场景：搭沙箱 → 起 mock provider → 抓首请求真实字节
node .sc-test/bench/run.mjs <标签> \
  userDefaultTools=read,edit,write,bash defaultTools=read,edit,write,bash \
  resident=read,write,edit,bash,find,omnify local=1

# 看结果：各块字节 + 关键内容判定
node .sc-test/bench/inspect.mjs <标签>

# 变体：local=lean|lean-shell|1|<逗号分隔文件名>  stripPkg=<子串>  provider=probe|real|realshape
```

沙箱要点：`PI_CODING_AGENT_DIR` 指向沙箱 agent 目录，`npm`/`git`/`node_modules`/`skills` 用 `mklink /J` junction 指向真实目录（**必须是反斜杠绝对路径**），项目级 `.pi/` 两份配置现写现用；mock 端口默认 18080（8799 在本机被占）。
