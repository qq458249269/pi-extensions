# Pi Extensions 安装清单

本手册汇总一套推荐的 Pi 扩展安装方案，按「缓存与节省优先，编程增强次之」的原则组织。扩展统一安装在 Pi 配置根 `~/.pi/agent`（Windows 下为 `%USERPROFILE%\.pi\agent`），以下路径均以此计。

> 不装 `lazy` 类扩展：`pi-tool-search` 已承担按需工具加载，与 `lazy` 同时使用会在工具生命周期管理上冲突。
>
> 本轮（2026-09-17）新增 4 个扩展，全部**零工具注入**（无 `registerTool`/`setActiveTools`），只挂事件钩子，不增加首请求 token、不与 `pi-tool-search` 懒加载冲突。

## 推荐清单（8 个，始终最新）

### A. 核心层（先装）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-tool-search` | `npm:pi-tool-search` | **核心**。把非核心工具全部隐藏到 `tool_search` 后面，按需解锁，避免注入上百个工具 schema，直接改善前缀缓存命中与 token 消耗。核心工具 `read/write/edit/bash/grep/find` 默认启用。**关键：`alwaysEnabled` 必须只列核心工具，否则首次请求会注入所有工具 schema，token 飙升到 2w+** |
| `pi-cache-guardian` | `npm:pi-cache-guardian` | **缓存守护（防 autocompact 后命中率归零）**。首轮完整链处理后将 system prompt 捕获为 **golden 副本**，之后每轮无条件恢复——字节级一致保证前缀缓存不因 autocompact 重建 system prompt 而整体失效；叠加 prompt reorder（稳定内容前置）、skill 压缩（>4 个 skill 时 4 行 XML 压缩为单行索引）、`<session-overview>` 变化字段剥离（RECENT COMMITS/目录状态/行数），并自动设 `PI_CACHE_RETENTION=long`。自动兼容检测：OpenAI 400 时剥离 `prompt_cache_retention`、Anthropic 400 时降级 `cache_control` TTL、OpenAI 兼容端点注入 `prompt_cache_key`。**不注入任何工具**（无 `setActiveTools`），与 `pi-tool-search` 懒加载不冲突。命令：`/cache-guardimizer`（npm README 里的 `/cache-guardian` 为旧名）查看每轮 `cacheRead`/`cacheWrite` 统计。可选：`PI_CACHE_GUARD=1` 时会话结束命中率 < `PI_CACHE_GUARD_THRESHOLD`（默认 90）报警 |
| `pi-tps` | `npm:pi-tps` | TPS/TTFT/停顿/token 成本监控 widget + **运行状态指示**（回合运行中 TUI 底部状态栏实时 spinner、实时 TPS、Waterfall 瀑布图，回合结束弹整回合统计摘要）。配置：`/pi-tps`（`showTraces`/`showStats`/`showTtft`/颜色）。**必须配主题**：装好后 `colorPreset` 默认 `mono`，运行 `fix-tps-theme.ps1`（幂等：同时把 `pi-tps.json` 设为 `theme`、`settings.json` 的 `theme` 设为 `light/dark` 跟随系统）或手动 `/pi-tps` 选 `theme`、`/settings` 主题设 `light/dark` |

### B. 功能增强（其次）

| 扩展 | 来源 | 作用 |
|---|---|---|
| `pi-web-access` | `npm:pi-web-access` | 网页搜索、URL 抓取、GitHub 克隆、PDF/YouTube 理解 |
| `@injaneity/pi-computer-use` | `npm:@injaneity/pi-computer-use` | 观察并控制 macOS/Windows/Linux 桌面应用，**需运行时授予平台权限** |
| `@tian.zuo/pi-find` | `npm:@tian.zuo/pi-find` | **搜索增强**：用 ripgrep/fd 实现 `grep`/`find`，**复用内建工具名**（替换内建而非并列，模型只看到一套搜索面）。有界输出（grep ≤100 命中、find ≤200 文件、行长裁剪、硬字节上限、大文件/超长记录跳过），尊重 `.gitignore` 并跳过 `.git`，支持 `glob`/`!` 排除/`@`与`~` 路径展开。**只注册 `grep`/`find` 两个工具名，正好落在 `pi-tool-search` 的 `alwaysEnabled` 6 核心内，不新增工具、不增加注入量** |
| `pi-edit-guard` | `npm:pi-edit-guard` | **编辑强化**：覆盖内建 `edit`（**同名替换**），多层容错匹配（simple → line/whitespace/indentation/escape/unicode 归一化 → block-anchor → fuzzy 等 12+ passes）、匹配唯一性校验、缩进漂移修复、批量感知错误报告。另注册 `undo` 工具（可撤销编辑）。**`edit` 在核心 6 内即生效；`undo` 不在核心，由 `pi-tool-search` 隐藏、按需解锁，不增首请求注入**。⚠ 声明 `engines.node >=24.18.0`（本机 24.16.0 仅 npm 告警，仍可安装运行） |
| `@trycedar/pi-mdiff` | `npm:@trycedar/pi-mdiff` | **Markdown 编辑**：面向 `.md` 的规范化 SEARCH 匹配 + 块级锚定编辑，注册 `md_inspect`/`md_diff`/`md_edit` 三个工具。**旧包名 `pi-mdiff` 已弃用并迁移到带 scope 的 `@trycedar/pi-mdiff`**。三个工具名均不在核心 6，默认被 `pi-tool-search` 隐藏、按需解锁，**不增首请求注入** |

## 安装与配置

> **警：逐条串行安装，勿并行。** 多进程 `pi install` 会竞写 `~/.pi/agent/settings.json` 丢注册（实测 17 项仅剩 5 项留存），且并发操作同一 `~/.pi/agent/npm` 目录会触发 `ENOENT: Cannot cd into .../node_modules/<pkg>`（实测 `typebox`）。
>
> `pi install` 一次只接受单个 source，故直接串行跑循环：

```bash
for p in pi-tool-search pi-cache-guardian pi-tps \
         pi-web-access @injaneity/pi-computer-use @tian.zuo/pi-find \
         pi-edit-guard @trycedar/pi-mdiff; do
  pi install "npm:$p" || echo "[失败] $p"
done
```

装完自查（`pi extensions list`，不并行）：应见 **8 个 npm 扩展**——`pi-web-access`、`pi-tool-search`、`pi-tps`、`@injaneity/pi-computer-use`、`pi-cache-guardian`、`@tian.zuo/pi-find`、`pi-edit-guard`、`@trycedar/pi-mdiff`。若少于 8（并行竞写伤痕），重跑上述循环补漏。

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
> | 4 扩展全量（`tool-search`+`tps`+`web-access`+`computer-use`） | 2,654 chars（≈0.8-1k token） | 7 | 增量仅 `tool_search` 描述 + 运行时状态 widget（`alps-pi` 纯 TUI 零注入、2026-09-19 已卸载，数值不受影响） |

> 该表为首轮 `session_start` 实测基线（安装 `pi-cache-guardian` 前）。`pi-cache-guardian` 不注入工具，`activeTools` 数不变；system prompt 内容受其 reorder/压缩影响（长度基本持平，压缩仅在 skill>4 时生效），属 `before_agent_start` 阶段内部改写，不影响首请求注入量与基线对比结论。
>
> **2026-09-17 追加 4 个扩展后基线结论不变**：`pi-cache-guardian` 不注入工具；`alps-pi` 纯 TUI 零工具注入（`activeTools` 仍 7，首请求注入量不变），已于 2026-09-19 卸载。
>
> `pi-tps` 是纯 UI/运行时监控扩展，不注册任何 agent 工具，因此**不增加首次请求 token**（相对基线仅 +~150 chars 的 `pi-tps` 策略文字）。其余扩展工具在需要用时 `tool_search` 解锁即可，不占首次请求 token。
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
2. 新会话里用 `tool_search` 按需解锁新扩展的工具（如 `web_search`、`computer_use`）。
3. `pi-tps`：运行 `fix-tps-theme.ps1` 让颜色跟随系统主题。`@injaneity/pi-computer-use`：首次运行时授予平台权限。
4. `pi-cache-guardian`：装上即用（golden freeze + `PI_CACHE_RETENTION=long` 自动生效），`/cache-guardimizer` 查看每轮缓存统计；可选开启会话结束命中率报警：`PI_CACHE_GUARD=1`（阈值 `PI_CACHE_GUARD_THRESHOLD`，默认 90）。autocompact 后是新 session，会重新捕获 golden，无需干预。
5. **`pi-edit-guard`**：装上即用，**同名接管内建 `edit`**（无需改 `alwaysEnabled`）。需要解锁 `undo` 时用 `tool_search`。⚠ 若启动报 node 版本相关错误，需将 Node 升到 `>=24.18.0`（本机 24.16.0 实测仅安装告警、运行正常）。
6. **`@trycedar/pi-mdiff`**：装上即用，编辑 `.md` 时用 `tool_search` 解锁 `md_inspect`/`md_diff`/`md_edit`。**旧包名 `pi-mdiff` 已弃用，务必用 `npm:@trycedar/pi-mdiff`**（bare 名会触发弃用告警甚至 ECONNRESET 失败）。
