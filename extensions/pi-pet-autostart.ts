/**
 * pi-pet-autostart — 桌面宠物：**整机一只、端口全局共享、不随父 cmd 进程消亡**
 *
 * 上游 `pi-dsh-pet` 只注册两个命令（`/pet` / `/pet-stop`），没有任何自动启动开关；
 * 更要命的是它把「窗」和「服务」都挂在**当前 pi 进程**上：
 *   - `pi.on('session_start')` 起一个随机端口的 HTTP+WS；
 *   - `/pet` → `spawn('npx.cmd', ['--yes','electron','pet-electron.cjs', port], {detached:false, windowsHide:true, shell:isWin})`；
 *   - `process.on('exit'/'beforeExit'/'SIGINT'/'SIGTERM')` → `taskkill /f /t` 关窗。
 * 于是「关掉父 cmd 进程宠物就没了」，而且**有两处互相独立的成因**，都实测确认过：
 *   1. **上游自己杀**：pi 退出 → `exit`/`beforeExit`/`SIGINT`/`SIGTERM` → `taskkill /pid <npx 起的 cmd> /f /t`，
 *      electron 整棵树被显式干掉。这跟控制台无关，是代码里写死的。
 *   2. **窗会自己关**（把 1 堵掉也一样）：服务随 pi 进程一起没了 →
 *      `pi/assets/pet.js` 的 `ws.onclose` 重试 5 次（3s 一次 ≈15s）后调
 *      `__petElectron__.closeWindow()` → preload 发 `pet:close` → `app.quit()`。
 *      也就是说：**只要服务住在 pi 进程里，「宠物活得比父进程久」就是不可能的**，
 *      改 spawn 参数救不了，必须把服务搬到 pi 进程外面去。
 * （顺手排掉一个常见误判：控制台不是凶手。实测 `windowsHide:true` 起的孩子走
 *   CREATE_NO_WINDOW，本来就不挂父控制台（`GetConsoleProcessList` 查不到它）；
 *   `detached:false` 且不带 windowsHide 才会挂上去。别再往「给上游加 detached」上找答案。）
 *
 * ## 三层结构：宿主进程 / 本扩展 / 上游
 *   ① **宿主** `pi-pet-host.cjs`（源码内嵌在本文件里，运行时写到 `~/.pi/agent/state/`）：
 *      一个**不属于任何 pi 进程**的独立进程。`mkdir` 独占锁 → 整机只可能有一个宿主，
 *      也就只可能有一扇窗；自己提供窗要的那套 HTTP+WS（`/ /pet.js /pet.css
 *      /config.jsonc /thumb/* /health` + `WS /ws`），端口写进全局状态文件
 *      `pi-pet-global.json`；自己拉 electron；按 ctrl 文件维持窗。
 *   ② **本扩展**（每个 pi 进程一份）：`session_start` 读全局状态 → 探 `/health` →
 *      没有就抢锁拉起宿主 → 把本会话的 agent 事件喂到宿主 `WS /feed`。
 *   ③ **上游**：仍在 pi 进程里起它自己那套（我们不再派发 `/pet`）。手敲 `/pet` 仍会多一扇，
 *      由下面的巡检收掉。
 * 事件汇聚：各会话 `WS /feed` → 宿主转给窗的 `WS /ws`。于是「一只宠物」跟着**所有**会话动，
 * 而窗和端口是全局唯一的两样东西。`add_pet*` 帧在宿主那层按 `maxPets` 丢掉（=1 时），
 * 这是**机器级**单只的最后一道闸，不再依赖「哪个进程的钩子」。
 *
 * ## 拉宿主为什么这么写 spawn 参数
 * `detached: true` + `windowsHide: true` + `stdio:'ignore'`：前者让宿主不在父进程的控制台
 * 事件范围里（Ctrl+C / 关 cmd 都不沾），后者让宿主**没有控制台**（CREATE_NO_WINDOW），
 * 任一生效都够；给全了就不用赌某个运行时（Bun / node）对 `detached` 的支持程度。
 * 探针里有一格死盯这两个参数（回归点：谁哪天手滑删掉 `detached` 就会红）。
 *
 * ## 起不来怎么办（降级，不假装有宠物）
 * 宿主拉不起来（没有 node、抢锁失败、20s 内 `/health` 不通）→ 明确告警 + 退回旧路：
 * 派发 `/pet` 让上游在本进程开窗（旧逻辑整套保留：窗口闸/锁/桥/记账）。`/pet-auto host off`
 * 可以主动切回旧路逐个排查。
 *
 * ## 旧路（降级用）保的那几道闸
 * 只做自动启动会越弹越多，原因有两个，都是跨进程的、记账按 pid 根本拦不住：
 *   1. **每个会话一扇窗**：原记账只认「本 pi 进程已弹过」，换会话 / `/reload` / 多开一个 pi
 *      就是一个新 pid → 又一扇窗。开 9 个会话就 9 只。
 *   2. **一扇窗里 `add_pet`**：上游 `/pet` 在窗已开时不新开窗，而是广播 `add_pet:<size>`
 *      让窗口里**再加一只**。手敲第二次 `/pet` 就多一只。
 * 所以旧路里加两道闸：
 *   - **窗口闸（跨进程）**：`session_start` 先扫全机的宠物窗（`pet-electron.cjs` 主进程
 *     + 端口），已有 ≥ `maxPets` 扇就**复用**（不派发 `/pet`），并用 `mkdir` 原子锁挡住
 *     「两个会话同时开」的竞态。
 *   - **数量闸（进程内）**：`maxPets=1` 时在 `WebSocket.prototype.send` 上挂钩子，丢掉
 *     `add_pet*` 消息——只认这个前缀，其余帧原样放行。钩子从**上游自己的入口文件**起算
 *     `require('ws')`，否则可能打在另一份 ws 实例上（本机有 `agent/node_modules/ws` 和
 *     `agent/npm/node_modules/ws` 两份）。
 *
 * ## 「一直在待机 / 突然多出第二只」的成因（2026-09-29/30 修；宿主化后大部分从根上消失）
 * 1. **pid 记账把桥一起跳过了**：`session_start` 里 `alreadyFiredThisProcess()` 直接 return，
 *    而它 return 在建桥之前。于是同进程内第二次 `session_start`（`/reload`、`/clear`、树跳转）
 *    之后，复用的窗**永远没人喂事件**——不动，就是一直待机。现在建桥提到那个闸**外面**，
 *    每次 `session_start` 都跑一遍 `ensureBridge()`（已有桥就跳过，自己开的窗不桥）。
 * 2. **闸门只认命令行，不验活**：上游清理只挂在 `process.on('exit'/'SIGINT'/'SIGTERM')`——
 *    **硬杀/崩溃就留下永久孤儿窗**。旧逻辑把 `pet-electron.cjs <port>` 进程一律当「已有 1 只」
 *    → 吸附上去 → 桥到没人监听的端口 → 永远发不出东西。现在每个端口都探一次 `/health`。
 * 3. **探不通的端口被当成活的（最阴的一个）**：主人 pi 被硬杀后，它的 LISTENING socket 会被
 *    electron 子进程**带着一起活下来**——`netstat` 看着在监听，内核照常完成 TCP 握手，所以
 *    连接**不报错**，但永远没人 `accept`：`/health` 超时、WS upgrade 挂死。窗照常亮着、照常呼吸，
 *    就是收不到任何事件。**只要窗在，这个假端口就一直在**，是个自我维持的死循环。
 *    （实测：netstat 报 `LISTENING` 归 pid 95932，而该 pid 在 tasklist 里已不存在；
 *    杀掉 electron 后该 socket 立刻消失，证实是子进程持有的。）
 *    所以探不通**不能**当活窗：先用短超时探一次，`unknown` 就**再用长超时宽限探一次**
 *    （别误杀刚起、只是慢的窗），还不行就判失活收掉。留着它 = 永远待机；收掉它 = 自动重开一只能用的。
 * 4. **「扫不动」被当成「真没有」**：wmic 被新版 Windows 删掉 + PowerShell 兜底也失败时，
 *    旧代码拿到 `[]` 就去开第二扇。现在扫描结果带 `ok`，全挂则重试一次，仍失败就**照开但
 *    明确告警**（不让人没宠物，同时把「保证已降级」摆到台面上）。
 * 5. **桥坏了没人知道**：`connect` 的 error 以前是空 handler、close 后 5s 重连也不吭声。
 *    现在记 `{state, lastError, sent}` 并加**握手看门狗**（`PI_PET_BRIDGE_WATCHDOG_MS`，默认 6s），
 *    超时未 open 就报 `err`——不能让状态永远停在 `connecting` 装样子。`/pet-auto status` 一行摊开。
 * 6. **PowerShell 兜底整个是死的（2026-09-30 实测）**：脚本里 `[int]($_.CreationDate…).TotalMilliseconds`
 *    把 epoch 毫秒（≈1.79e12）强转 Int32 → **溢出报错，整个脚本一行都不吐**；而 `capture` 把空 stdout
 *    当失败。于是 wmic 只要一次超时（机器忙 / 被 AV 拖住），兜底也一起哑掉 → `ok:false` → 静默降级
 *    开第二扇。修：`[long]`。另外脚本按 `Name='electron.exe'` 列出**所有** Electron 进程，gpu/utility/
 *    renderer 子进程命令行里也带 `pet-electron.cjs` 但**没有端口** → `port=0`；`probeHealth` 把 0 判成
 *    `dead` → 被当孤儿 `taskkill`（会把好窗自己的子进程杀掉）。现在脚本只吐带端口的主进程，解析端再兜一道。
 * 7. **「这扇窗是谁开的」认得不准**：`markFired({...born[0], reused:false})` 把「派发后新出现的窗」
 *    一律当自己的。baseline 用的是**第一次**扫描的结果（扫挂时 = 空集），而抢锁最长能等 25s——
 *    这期间别的会话开的窗会被记成「本进程自己开的」（`reused:false`），于是 `ownWindowPort()>0`：
 *    本会话既不建桥也不再开窗，宠物永远不动。现在只在**复核扫描可信**时才敢认领，否则记 `reused:true`
 *    并老老实实建桥。
 * 8. **窗被换掉后旧桥不死**：`ensureBridge` 见「已经有桥」就 return。`/pet-auto restart`（或窗崩了被
 *    重开）之后，老会话还挂在**已经不存在的端口**上，新窗没人接。现在每次 `session_start` 按当前活窗
 *    **对账**：停掉指向死端口的桥、接上新出现的活窗（扫描失败时维持原状，别因一次抖动误停好桥）。
 * 9. **`pending` 记账**：以前 `session_start` 先写「本进程已弹」再派发，中途扫挂/等窗超时就**永久**
 *    放弃（`alreadyFiredThisProcess()` 永远 true，只有 `/reload` 能解）。现在先记 `pending:true`，
 *    真等到窗（或复用）才转正；`pending` 超过 90s（`PI_PET_PENDING_TTL_MS`）放行重试。记账另加
 *    进程出生时刻 `startedAt`，防 pid 被回收后「新进程被当成老的那个」。派发失败 / 等不到新窗都明说。
 * 10. **上游那套「进程内所有权」**：见开头两处实测成因。这是宿主化最直接的理由。
 * 11. **手敲 `/pet` 会多一扇**：宿主只保证「自己那只」唯一，别人手敲出来的窗照样存在。所以除了
 *     `session_start`，还有一个**巡检**（`PI_PET_SWEEP_MS`，默认 60s）持续按「宿主报的那只 = 合法的，
 *     其余 = 多余」收口；扫不动（`ok:false`）时一律不动手。宿主没起来（旧路）时巡检按
 *     「本进程开的那只 + 至多 maxPets 扇」收口。
 *
 * 默认启用，开关在 `~/.pi/agent/extensions/pi-dsh-pet.json`：
 *   { "autostart": true, "size": "normal", "delayMs": 400, "maxPets": 1, "bridge": true,
 *     "host": true, "port": 47653, "sweepMs": 60000, "keepAlive": true, "hostRuntime": "" }
 *   - autostart: false → 不自动开窗（仍可手敲 `/pet`）
 *   - size: small | normal | large，非法值按 normal
 *     （注：上游压根没把尺寸传给 electron，初始窗里几只、每只多大只由 `assets/config.jsonc` 决定；
 *      这个 size 只对 `add_pet:<size>` 有意义，而 maxPets=1 时它是被拦掉的）
 *   - delayMs: 等上游起 HTTP 服务的延时，默认 400ms；上游 handler 也能自己补起，纯粹是稳态
 *   - maxPets: 同时最多几只（1–8，默认 1）；已经多了用 `/pet-auto cleanup` 收掉多余的
 *   - bridge: 本会话是否把事件喂给宿主（默认开）
 *   - host: 用全局宿主（默认 true）还是退回旧路（false）
 *   - port: 宿主**优先**用的端口，被占就退一个随机空闲端口，真实端口写进全局状态文件
 *   - sweepMs: 巡检间隔（0 = 关）；扫全机要起进程，别设太小
 *   - keepAlive: 窗自己没了要不要被宿主重新拉起（默认开）
 *   - hostRuntime: 宿主用哪个可执行文件跑（绝对路径）。改名用，见上；空 = 默认

 *
 * 产物与状态文件（都在 `~/.pi/agent/state/`）：
 *   pi-pet-host.cjs         宿主源码（本文件内嵌，sha1 没变就不重写）
 *   pi-pet-host.cjs.lock    宿主**单例锁**（整机单例；主人 pid 死了就允许接管）
 *   pi-pet-host.cjs.boot.lock 宿主**启动锁**（扩展之间「谁去拉宿主」；拉完就还）
 *   pi-pet-global.json      宿主写：端口/宿主 pid/窗 pid/会话数/心跳。各会话读它 = 端口全局共享
 *   pi-pet-ctrl.json        扩展写：desired/keepAlive/size/maxPets/bridge。宿主每 2s 读一次
 *   pi-pet-autostart.json   旧路的 per-pid 记账（宿主化之后只用于 `/pet-auto status` 与降级路径）
 *   pi-pet-autostart.json.lock 旧路开窗锁（降级路径用）
 *
 * ## 启动锁与单例锁必须是两把（2026-09-30 修，之前 100% 自锁死）
 * 扩展先 `acquireLockAt(HOST_LOCK_PATH)` 当「启动锁」用，又把**同一个路径**当 `--lock`
 * 传给宿主。宿主起来 `acquireLock()` 读到 owner.json 里那个**活着的 pi 进程 pid** →
 * 「已有宿主在跑」→ `process.exit(0)`。于是宿主每次秒退、扩展每次等满 20s 报
 * 「拉起了宿主进程（node.EXE）但 20s 内没应答」→ 退回旧路 → 宠物一直绑在本会话上。
 * **症状像「node 起不来」，实际是自己把自己挡在门外**：`pi-pet-global.json` 从来不生成。
 * （顺带一提：`.sc-test` 里的探针抓不到它，因为探针的 spawner 是假的、不会真起一个自杀的宿主。）
 * 现在 `HOST_BOOT_LOCK_PATH`（`.boot.lock`）归扩展、`HOST_LOCK_PATH` 归宿主，各管一件事。
 * 还有一处连带：等不到 `/health` 时**不能**顺手 `releaseLockAt(HOST_LOCK_PATH)`——那把锁
 * 已经被宿主接过去了，抽掉等于放第二个宿主进来开第二个服务端口。只还启动锁。
 *
 * ## 想改宿主的进程名（任务管理器里那只 node.exe）
 * 复制一份 node.exe 改名即可（node.exe 自包含，复制出来能直接跑）：
 *   copy "<node 目录>\node.exe" "%USERPROFILE%\.pi\agent\state\pi-pet-host.exe"
 * 然后在 `pi-dsh-pet.json` 里写 `"hostRuntime": "C:\\Users\\<你>\\.pi\\agent\\state\\pi-pet-host.exe"`
 * （等价的环境变量：`PI_PET_NODE`；优先级 config > env > PATH 上的 node > bun）。
 * `/pet-auto status` 会把当前用的哪个运行时打出来。
 * **electron 那只（`electron.exe`）没做**：扫描/巡检/孤儿判定全靠
 * `Name='electron.exe'` + 命令行里的 `pet-electron.cjs <port>` 认窗，exe 一改名就一只都扫不到，
 * 孤儿收不掉、宿主自己的窗还会被当「多余的」误杀。想改得连带改扫描，别单改 exe 名。

 * 会话内随手切：
 *   `/pet-auto [on|off|size <档位>|max <只数>|bridge on|off|host on|off|status|cleanup|restart]`
 *   `on/off` 改的是 ctrl 里的 `desired`：off 会让宿主自己关窗退出（下次 on 再拉起）
 *   `host on/off` 在「全局宿主」与「旧路」之间切，`/pet-auto status` 会报当前走的是哪条
 * 只在 TUI 模式自动开窗：`print` / `json` / `rpc`（含 bench 沙箱）不弹桌面窗口。
 *
 * 幂等：同一 pi 进程只自动开一次（pid 记账在 `pi-pet-autostart.json`），切会话、`/reload`、
 * 树跳转都不会叠出第二只。回退：删本文件 + `/reload`（宠物包留着，手敲 `/pet` 照常）。
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";


const AGENT_DIR = path.join(homedir(), ".pi", "agent");
// 两个环境变量只为可测（.sc-test/probe-pet-autostart.mjs 指到临时目录），日常不用设
const CONFIG_PATH = process.env.PI_PET_CONFIG ?? path.join(AGENT_DIR, "extensions", "pi-dsh-pet.json");
const STATE_PATH = process.env.PI_PET_STATE ?? path.join(AGENT_DIR, "state", "pi-pet-autostart.json");
/** 开窗锁：mkdir 跨进程原子，谁建成功谁负责开窗，别的会话等它开出来复用。 */
const LOCK_PATH = process.env.PI_PET_LOCK ?? `${STATE_PATH}.lock`;

/** 宿主产物与它的两个文件（都走 env 是为了让探针指到临时目录，不碰真机器上的宠物）。 */
const HOST_SCRIPT_PATH = process.env.PI_PET_HOST_SCRIPT ?? path.join(AGENT_DIR, "state", "pi-pet-host.cjs");
/** 宿主**自己**的单例锁：谁起谁占着，进程活着就一直占（整机只可能有一个宿主）。 */
const HOST_LOCK_PATH = process.env.PI_PET_HOST_LOCK ?? `${HOST_SCRIPT_PATH}.lock`;
/**
 * 启动锁：**扩展之间**「谁去拉宿主」，拉完立刻释放。
 *
 * 这两把锁以前是同一把，于是 100% 自锁死（2026-09-30 实测）：扩展先
 * `acquireLockAt(HOST_LOCK_PATH)`（owner.json 写的是**活着的 pi 进程 pid**），
 * 又把同一个路径当 `--lock` 传给宿主；宿主起来 `acquireLock()` 读到 owner 还活着 →
 * 「已有宿主在跑」→ `process.exit(0)`。宿主每次秒退，扩展每次等满 `HOST_WAIT_MS` →
 * 报「拉起了宿主进程但 20s 内没应答」→ 退回旧路。症状与「node 起不来」一模一样，
 * 但 `pi-pet-global.json` 永远不生成、宠物一直绑在本会话上（关掉父 cmd 就没）。
 * 拆成两把就干净了：启动锁归扩展（短命、TTL 内可被接管），单例锁归宿主（长命）。
 */
const HOST_BOOT_LOCK_PATH = process.env.PI_PET_HOST_BOOT_LOCK ?? `${HOST_SCRIPT_PATH}.boot.lock`;
const GLOBAL_PATH = process.env.PI_PET_GLOBAL ?? path.join(AGENT_DIR, "state", "pi-pet-global.json");
const CTRL_PATH = process.env.PI_PET_CTRL ?? path.join(AGENT_DIR, "state", "pi-pet-ctrl.json");

/** 上游注册的命令名（`pi.registerCommand('pet')`）。找不到就说明包没装/被卸了。 */
const PET_COMMAND = "pet";
const SIZES = ["small", "normal", "large"] as const;
type PetSize = (typeof SIZES)[number];
/** maxPets 上限：再多也没意义（每只一个 electron 渲染进程），也免得有人写 999。 */
const MAX_PETS_CEILING = 8;
/** 锁的存活上限：主人进程被硬杀时留下的陈旧锁，超过这个时间就允许接管。 */
const LOCK_TTL_MS = 45_000;
/** 轮询间隔 / 两个等待上限（等别人的窗、等自己的窗；npx 首次拉 Electron 可能要十几秒）。 */
const POLL_MS = numEnv("PI_PET_POLL_MS", 1_500);
const LAUNCH_WAIT_MS = numEnv("PI_PET_LAUNCH_WAIT_MS", 25_000);
const WATCH_MS = numEnv("PI_PET_WATCH_MS", 25_000);
/** `/pet-auto restart` 关完窗后要等上游的 exit 回调把 electronProc 置空，否则再派发 /pet 会被当成 add_pet。 */
const RESTART_WAIT_MS = numEnv("PI_PET_RESTART_WAIT_MS", 1_200);
/** 首次探不通时再宽限探一次的时长（别把刚起、只是慢的窗判死） */
const SLOW_PROBE_TIMEOUT_MS = numEnv("PI_PET_SLOW_PROBE_MS", 5_000);
/** 桥的握手看门狗：超时就报 err，不让状态永远停在 connecting */
const BRIDGE_WATCHDOG_MS = numEnv("PI_PET_BRIDGE_WATCHDOG_MS", 6_000);
/** 宿主端口：优先这个（全局共享的固定端口），被占就由宿主退一个随机空闲端口。 */
const HOST_PORT = numEnv("PI_PET_PORT", 47_653);
/** 等宿主 /health 通的时长上限（起宿主只要拉起 node，npx 拉 electron 由宿主自己慢慢来）。 */
const HOST_WAIT_MS = numEnv("PI_PET_HOST_WAIT_MS", 20_000);
/** 巡检间隔：持续保证「整机只有宿主那一扇窗」（手敲 /pet 冒出来的第二只靠它收）。 */
const SWEEP_MS = numEnv("PI_PET_SWEEP_MS", 60_000);

/** 等待类参数只为可测（探针把它们压到毫秒级），日常不用设。 */
function numEnv(name: string, fallback: number): number {
	const raw = Number(process.env[name]);
	return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

interface PetConfig {
	autostart?: boolean;
	size?: string;
	delayMs?: number;
	maxPets?: number;
	bridge?: boolean;
	host?: boolean;
	port?: number;
	sweepMs?: number;
	keepAlive?: boolean;
	/**
	 * 宿主用哪个可执行文件跑（绝对路径）。**改名用**：把 node.exe 复制一份成
	 * `pi-pet-host.exe` 指到这里，任务管理器里那只就从 node.exe 变成 pi-pet-host.exe。
	 * 空 = 走 `PI_PET_NODE` → PATH 上的 node → bun。写错（路径不存在）时忽略并回退。
	 */
	hostRuntime?: string;
}

/** 归一后的配置：size 一定是合法档位，autostart 一定是布尔，maxPets 落在 1–8。 */
interface ResolvedConfig {
	autostart: boolean;
	size: PetSize;
	delayMs: number;
	maxPets: number;
	bridge: boolean;
	/** 用全局宿主（默认）还是退回旧路（本进程内派发 /pet）。 */
	host: boolean;
	port: number;
	sweepMs: number;
	keepAlive: boolean;
	/** 宿主运行时绝对路径；空串 = 用默认（`PI_PET_NODE` / PATH 上的 node / bun）。 */
	hostRuntime: string;
}

const DEFAULTS: ResolvedConfig = {
	autostart: true,
	size: "normal",
	delayMs: 400,
	maxPets: 1,
	bridge: true,
	host: true,
	port: HOST_PORT,
	sweepMs: SWEEP_MS,
	keepAlive: true,
	hostRuntime: "",
};

/** 读配置；文件缺失 = 默认启用；读坏也按默认启用，但记一笔好提示。 */
function loadConfig(): { config: ResolvedConfig; broken: boolean } {
	try {
		if (!existsSync(CONFIG_PATH)) return { config: { ...DEFAULTS }, broken: false };
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PetConfig;
		const size = SIZES.includes(raw.size as PetSize) ? (raw.size as PetSize) : DEFAULTS.size;
		const want = raw.maxPets;
		return {
			config: {
				// 只认显式 false：写错类型（如 "false"）时仍视为启用，避免宠物莫名消失
				autostart: raw.autostart === false ? false : true,
				size,
				delayMs: typeof raw.delayMs === "number" && raw.delayMs >= 0 ? raw.delayMs : DEFAULTS.delayMs,
				// 只数「同时活着的宠物」，1 是本扩展的默认；0 / 负数 / 非整数一律回到 1
				maxPets:
					typeof want === "number" && Number.isInteger(want) && want >= 1
						? Math.min(want, MAX_PETS_CEILING)
						: DEFAULTS.maxPets,
				bridge: raw.bridge === false ? false : true,
				// 宿主是这条修复的主路，默认可用；只有显式 false 才退回旧路。
				// `PI_PET_HOST=0` 是同一个开关的环境形态：出问题时能一键退回旧路，也给探针用
				host: process.env.PI_PET_HOST === "0" ? false : raw.host === false ? false : true,
				// 端口要在 1024–65535 之间（<1024 要管理员）；写错了就回默认端口
				port:
					typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port >= 1024 && raw.port <= 65_535
						? raw.port
						: DEFAULTS.port,
				// 0 = 不巡检（扫全机要起进程，嫌吵的人可以关）
				sweepMs: typeof raw.sweepMs === "number" && raw.sweepMs >= 0 ? raw.sweepMs : DEFAULTS.sweepMs,
				keepAlive: raw.keepAlive === false ? false : true,
				// 写死的路径当没配（别把宿主钉死在一个已经不存在的文件上）
				hostRuntime:
					typeof raw.hostRuntime === "string" && raw.hostRuntime.trim() !== "" && existsSync(raw.hostRuntime.trim())
						? raw.hostRuntime.trim()
						: DEFAULTS.hostRuntime,
			},
			broken: false,
		};
	} catch {
		return { config: { ...DEFAULTS }, broken: true };
	}
}

function saveConfig(config: PetConfig): void {
	mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/* ================================ 状态记账 ================================ */

/** 本进程出生时刻，四舍五入到秒（写/读之间有几毫秒抖动，比较时留 2s 容差）。 */
const PROCESS_STARTED_AT = Math.round((Date.now() - process.uptime() * 1000) / 1000) * 1000;
/** `pending` 记账的有效期：比一条 `openWindow` 的最坏耗时（≈25s 抢锁 + 25s 等窗）长一点。 */
const PENDING_TTL_MS = numEnv("PI_PET_PENDING_TTL_MS", 90_000);

interface PetState {
	pid?: number;
	/** 进程出生时刻（ms）：pid 会被回收，光比 pid 会把新进程认成老的那个。旧记录没这个字段。 */
	startedAt?: number;
	firedAt?: string;
	/** true = 只记了「本进程要开窗」，还没等到窗。超时后允许重试，不再一次失败就永久放弃。 */
	pending?: boolean;
	/** 最后一次「开窗 or 复用」的结果，给 `/pet-auto status` 看。 */
	window?: { pid: number; port: number; startedAt: number; reused: boolean };
}

function readState(): PetState {
	try {
		return JSON.parse(readFileSync(STATE_PATH, "utf8")) as PetState;
	} catch {
		return {};
	}
}

function writeState(state: PetState): void {
	try {
		mkdirSync(path.dirname(STATE_PATH), { recursive: true });
		writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	} catch {
		/* 记账失败只是下次多弹一次，不值得打断会话 */
	}
}

/** 这条记账是不是本进程写的（pid 相同 + 出生时刻对得上）。 */
function isThisProcess(s: PetState): boolean {
	if (s.pid !== process.pid) return false;
	// 旧记录没有 startedAt：按老规矩只认 pid（兼容一次 /reload 前的记账）
	if (typeof s.startedAt !== "number") return true;
	return Math.abs(s.startedAt - PROCESS_STARTED_AT) <= 2_000;
}

/** 本进程是否已经自动开过窗（切会话 / /reload 都不重复弹）。 */
function alreadyFiredThisProcess(): boolean {
	const s = readState();
	if (!isThisProcess(s)) return false;
	if (s.pending !== true) return true;
	// 还在开窗途中：短时间内不重复开；拖太久（扫挂 / 等窗超时）就放行重试，
	// 不然一次失败会把「自动弹窗」永久关掉，只有 /reload 能解。
	const at = Date.parse(s.firedAt ?? "") || 0;
	return Date.now() - at < PENDING_TTL_MS;
}

/** 记「本 pid 弹过」+（可选）落在了哪扇窗上；`pending=true` 表示只是「打算开」。 */
function markFired(window?: PetState["window"], pending = false): void {
	const prev = readState();
	// 转 pending 时别把**别的进程**留下的窗继承过来：那会让 ownWindowPort() 认错自己的窗
	const keepWindow = window ?? (isThisProcess(prev) ? prev.window : undefined);
	writeState({ pid: process.pid, startedAt: PROCESS_STARTED_AT, firedAt: new Date().toISOString(), pending, window: keepWindow });
}

/* ====================== 跨进程：现在到底有几只宠物在跑 ====================== */

/**
 * 判定特征：上游用 `npx electron pi/assets/pet-electron.cjs <port>` 起窗，**只有主进程**
 * 的命令行带 `pet-electron.cjs <port>`（gpu / utility / renderer 子进程带的是
 * `--app-path=…/pi\assets`，没有这段，所以别拿 "pi-dsh-pet" 当特征，会把子进程数进来）。
 */
const SCAN_MARK = "pet-electron.cjs";

interface PetWindow {
	pid: number;
	port: number;
	/** 毫秒时间戳，只为排序（谁先开的）；拿不到就记 0，cleanup 时当最新的处理。 */
	startedAt: number;
}

/** 一次扫描的结果。`ok:false` = 扫描后端全挂（**不等于**没窗），调用方必须区别对待。 */
interface ScanResult {
	windows: PetWindow[];
	ok: boolean;
}

/** `…/pet-electron.cjs 43260` 里的端口。 */
function extractPort(args: string): number {
	const m = args.match(/pet-electron\.cjs\s+(\d+)/);
	return m ? Number(m[1]) : 0;
}

/** wmic 的 `20260929142048.759016+480` → 毫秒时间戳。 */
function wmicTimeToMs(value: string): number {
	const day = value.slice(0, 8);
	const clock = value.slice(8, 14);
	const ms = Number(value.slice(14, 17)) || 0;
	const offsetMin = Number(value.slice(value.indexOf("+") + 1)) || 0;
	if (day.length !== 8 || clock.length !== 6) return 0;
	return (
		Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), +clock.slice(0, 2), +clock.slice(2, 4), +clock.slice(4, 6), ms) -
		offsetMin * 60_000
	);
}

/** `wmic /format:list`：记录之间空行分隔，每行 `key=value`。 */
function parseWmic(stdout: string): PetWindow[] {
	const out: PetWindow[] = [];
	let args = "";
	let pid = 0;
	let startedAt = 0;
	const flush = (): void => {
		if (pid > 0 && args.includes(SCAN_MARK)) out.push({ pid, port: extractPort(args), startedAt });
		args = "";
		pid = 0;
		startedAt = 0;
	};
	for (const raw of stdout.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) {
			flush();
			continue;
		}
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const key = line.slice(0, eq);
		const value = line.slice(eq + 1);
		if (key === "CommandLine") args = value;
		else if (key === "ProcessId") pid = Number(value);
		else if (key === "CreationDate") startedAt = wmicTimeToMs(value);
	}
	flush();
	return out;
}

/** `ps -eo pid=,etimes=,args=`：`etimes` 是已运行秒数，取负得到出生时刻。 */
function parsePs(stdout: string): PetWindow[] {
	const out: PetWindow[] = [];
	for (const raw of stdout.split(/\r?\n/)) {
		const m = raw.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
		if (!m || !m[3].includes(SCAN_MARK)) continue;
		out.push({ pid: Number(m[1]), port: extractPort(m[3]), startedAt: Date.now() - Number(m[2]) * 1000 });
	}
	return out;
}

/** PowerShell 兜底：脚本自己吐 `pid|毫秒|端口`。 */
const PS_SCAN = [
	"$ErrorActionPreference='SilentlyContinue'",
	"Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | ForEach-Object {",
	// 只吐命令行里带 `pet-electron.cjs <端口>` 的主进程。以前对每个 electron.exe 都吐一行（子进程
	// 的端口位补 0），那些 port=0 的行会被 probeHealth 判 dead → 当孤儿 taskkill 掉。
	"  if ($_.CommandLine -match 'pet-electron\\.cjs\\s+(\\d+)') {",
	// 必须是 [long]：epoch 毫秒 ≈1.79e12 超出 Int32，[int] 会溢出报错，**整个脚本一行都不吐**
	// （`capture` 把空 stdout 当失败）→ 兜底等于没有。
	"    '{0}|{1}|{2}' -f $_.ProcessId, [long]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds, [int]$Matches[1]",
	"  }",
	"}",
].join("; ");

function parsePipeLines(stdout: string): PetWindow[] {
	const out: PetWindow[] = [];
	for (const raw of stdout.split(/\r?\n/)) {
		const m = raw.trim().match(/^(\d+)\|(\d+)\|(\d+)$/);
		// port=0 的行（没有端口的子进程）一律丢：probeHealth 把 0 判成 dead，留着会被当孤儿杀掉
		if (m && Number(m[3]) > 0) out.push({ pid: Number(m[1]), startedAt: Number(m[2]), port: Number(m[3]) });
	}
	return out;
}

/** 跑一条命令取 stdout；ENOENT / 非零退出 / 超时都算失败（null），交给下一个后端。 */
function capture(file: string, args: string[], timeout = 5_000): Promise<string | null> {
	return new Promise((resolve) => {
		try {
			execFile(
				file,
				args,
				{ timeout, windowsHide: true, maxBuffer: 4 << 20, encoding: "utf8" },
				(err, stdout) => resolve(err || !stdout ? null : String(stdout)),
			);
		} catch {
			resolve(null);
		}
	});
}

/**
 * 依次试各后端，第一个「跑通」的就是真相（跑通但 0 只 = 真没有）。
 * **全挂时返回 `ok:false`** 而不是 `[]`——「扫不动」和「真没有」必须分得开，
 * 否则扫不动就会被当成「0 只」再弹一扇，单只保证当场破功（见 `openWindow`）。
 * Windows: wmic ≈0.4s 主力 → PowerShell CIM ≈2.7s 兜底（新版 Windows 删了 wmic）；
 * 其它平台走 ps。都在 session_start 之后异步跑，不挡会话。
 */
async function scanRealWindows(): Promise<ScanResult> {
	const backends =
		process.platform === "win32"
			? [
					{
						file: "wmic",
						args: ["process", "where", "name='electron.exe'", "get", "CreationDate,CommandLine,ProcessId", "/format:list"],
						parse: parseWmic,
					},
					{ file: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", PS_SCAN], parse: parsePipeLines },
				]
			: [{ file: "ps", args: ["-eo", "pid=,etimes=,args="], parse: parsePs }];
	for (const backend of backends) {
		const out = await capture(backend.file, backend.args);
		if (out !== null) return { windows: backend.parse(out), ok: true };
	}
	return { windows: [], ok: false };
}

type Scanner = () => Promise<ScanResult>;

/** 探针用 `globalThis.__piPetScanWindows` 顶掉真扫描（.sc-test/probe-pet-autostart.mjs）。 */
function scanner(): Scanner {
	const hook = (globalThis as { __piPetScanWindows?: Scanner }).__piPetScanWindows;
	return typeof hook === "function" ? hook : scanRealWindows;
}

/** 扫描失败不能挡住会话；但要把「扫不动」如实带出去，别和「真没有」混为一谈。 */
async function scan(): Promise<ScanResult> {
	try {
		const raw = await scanner()();
		// 探针可能返回旧格式的裸数组，一律当 ok
		if (Array.isArray(raw)) return { windows: raw, ok: true };
		return { windows: raw?.windows ?? [], ok: raw?.ok !== false };
	} catch {
		return { windows: [], ok: false };
	}
}

/* ================== 窗的存活探测：光看进程表会被孤儿骗 ================== */

/**
 * 端口的三个状态，不只用 bool：
 *   - `up`      `/health` 回了 200 → 真的是活的服务
 *   - `dead`    连接被拒（ECONNREFUSED）→ **确定性**的「没人监听」，即孤儿
 *   - `unknown` 超时/其它错 → 机器忙或被杀，不确定，**不当孤儿处理**（宁可多留一只）
 * 区分开是为了不因为一次网络抖就把好窗误杀。
 */
type PortHealth = "up" | "dead" | "unknown";

/** 探上游的 `/health`（`startServer` 起好后该端点回 `{ok:true,port}`）。 */
function probeHealth(port: number, timeoutMs = 1_500): Promise<PortHealth> {
	return new Promise((resolve) => {
		if (!Number.isInteger(port) || port <= 0) return resolve("dead");
		let settled = false;
		const done = (h: PortHealth): void => {
			if (settled) return;
			settled = true;
			resolve(h);
		};
		let req: ReturnType<typeof httpRequest>;
		try {
			req = httpRequest({ host: "127.0.0.1", port, path: "/health", method: "GET", timeout: timeoutMs }, (res) => {
				res.resume();
				done(res.statusCode === 200 ? "up" : "unknown");
			});
		} catch {
			return done("unknown");
		}
		req.on("error", (err: NodeJS.ErrnoException) => done(err.code === "ECONNREFUSED" ? "dead" : "unknown"));
		req.on("timeout", () => {
			req.destroy();
			done("unknown");
		});
		req.end();
	});
}

type PortProbe = (port: number) => Promise<PortHealth>;

/** 探针用 `globalThis.__piPetProbePort` 顶掉真探测（默认放行，单独 case 才造孤儿）。 */
function portProbe(): PortProbe {
	const hook = (globalThis as { __piPetProbePort?: (p: number, t?: number) => Promise<PortHealth | boolean> }).__piPetProbePort;
	if (typeof hook !== "function") return probeHealth;
	return async (port: number, timeoutMs?: number) => {
		const raw = await hook(port, timeoutMs);
		return typeof raw === "boolean" ? (raw ? "up" : "dead") : raw;
	};
}

interface LiveSplit {
	/** 能用的窗（up + unknown）——只有这些能占 maxPets 的名额。 */
	alive: PetWindow[];
	/** 端口没人监听的孤儿：主人 pi 进程已死，窗还在但永远收不到事件。 */
	orphans: PetWindow[];
}

/** 把进程表按端口探一遍，分成「能用」和「孤儿」。 */
async function splitByHealth(wins: PetWindow[]): Promise<LiveSplit> {
	if (wins.length === 0) return { alive: [], orphans: [] };
	const probe = portProbe();
	const alive: PetWindow[] = [];
	const orphans: PetWindow[] = [];
	for (const w of wins) {
		let health: PortHealth = "unknown";
		try {
			health = await probe(w.port);
		} catch {
			health = "unknown";
		}
		// 探不通分两种，得分开判：
		//  - dead（ECONNREFUSED）：端口压根没人听 → 铁孤儿
		//  - unknown（超时 / 非 200）：**不等于能用**。最阴的一种是「死进程泄漏的 LISTENING
		//    socket」——netstat 看着在监听，内核照样完成握手，于是连接不报错，但永远没人
		//    accept，/health 和 WS upgrade 一起挂死。窗还亮着，事件发不进去，就是「一直待机」。
		//    所以再宽限探一次（别误杀刚起、只是慢的窗），还不行就判失活收掉：
		//    留着它 = 永远待机；收掉它 = 扩展自动重开一只能用的，明显划算。
		if (health === "unknown") {
			try {
				health = await probe(w.port, SLOW_PROBE_TIMEOUT_MS);
			} catch {
				health = "unknown";
			}
		}
		if (health === "up") alive.push(w);
		else orphans.push(w);
	}
	return { alive, orphans };
}

function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** 关掉一只宠物窗（Windows 用 taskkill /t 连带 gpu/renderer 子进程）。 */
async function killWindow(w: PetWindow): Promise<boolean> {
	if (!pidAlive(w.pid)) return false;
	if (process.platform === "win32") {
		await capture("taskkill", ["/pid", String(w.pid), "/f", "/t"]);
	} else {
		try {
			process.kill(w.pid, "SIGTERM");
		} catch {
			/* 已经没了 */
		}
	}
	return true;
}

/** 探针用 `globalThis.__piPetKillWindow` 顶掉真 taskkill（免得误杀测试机上的东西）。 */
type Killer = (w: PetWindow) => Promise<boolean> | boolean;
function killer(): Killer {
	const hook = (globalThis as { __piPetKillWindow?: Killer }).__piPetKillWindow;
	return typeof hook === "function" ? hook : killWindow;
}

/* ================================ 开窗锁 ================================ */

/** 本进程手上正持有的锁（开窗锁、宿主锁各算一个），用来做同一次调用里的重入短路。 */
const heldLocks = new Set<string>();

/** 主人进程已死、或锁太老（硬杀留下的）→ 允许接管。 */
function lockStaleAt(lockPath: string): boolean {
	try {
		const owner = JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")) as { pid?: number; at?: number };
		if (typeof owner.pid === "number" && pidAlive(owner.pid)) {
			return Date.now() - (Number(owner.at) || 0) > LOCK_TTL_MS;
		}
		return true;
	} catch {
		return true;
	}
}

/** mkdir 是跨进程原子的：抢到 = 归我开窗；抢不到且锁不陈旧 = 别人正在开。 */
function acquireLockAt(lockPath: string): boolean {
	if (heldLocks.has(lockPath)) return true;
	try {
		mkdirSync(lockPath);
	} catch {
		if (!lockStaleAt(lockPath)) return false;
		// 陈旧锁（主人进程硬杀留下的）：清掉重抢一次
		try {
			rmSync(lockPath, { recursive: true, force: true });
			mkdirSync(lockPath);
		} catch {
			return false;
		}
	}
	heldLocks.add(lockPath);
	try {
		writeFileSync(
			path.join(lockPath, "owner.json"),
			`${JSON.stringify({ pid: process.pid, at: Date.now() }, null, 2)}
`,
			"utf8",
		);
	} catch {
		/* 写不上 owner 也认了：最坏情况是下个会话等满 TTL */
	}
	return true;
}

/**
 * 进程退出时释放锁。只往 `process` 上挂**一个**监听（`/reload` 会反复重新求值本模块，
 * 每次都 `once` 一个会攒到 MaxListenersExceededWarning），退出时遍历当前所有实例的钩子。
 */
const EXIT_HOOKS = Symbol.for("pi-pet-autostart.exit-hooks");
function releaseLockOnExit(hook: () => void): void {
	const host = process as unknown as Record<symbol, { hooks: Array<() => void> } | undefined>;
	const reg = (host[EXIT_HOOKS] ??= { hooks: [] });
	reg.hooks.push(hook);
	if (reg.hooks.length > 1) return;
	process.once("exit", () => {
		for (const h of reg.hooks.splice(0)) {
			try {
				h();
			} catch {
				/* 退出阶段不再纠错 */
			}
		}
	});
}

function releaseLockAt(lockPath: string): void {
	if (!heldLocks.delete(lockPath)) return;
	try {
		rmSync(lockPath, { recursive: true, force: true });
	} catch {
		/* 留着就留着，等 TTL 过期被接管 */
	}
}

/** 旧路的开窗锁（降级路径用）。 */
const acquireLock = (): boolean => acquireLockAt(LOCK_PATH);
const releaseLock = (): void => releaseLockAt(LOCK_PATH);

/**
 * 等待用真实计时器（不 unref）：整条 `openWindow` 链都挂在这些 await 上，
 * unref 掉会在「进程里没别的事」时直接放走 promise（探针 case 19 就撞到过）。
 * 上限由 LAUNCH_WAIT_MS / WATCH_MS / RESTART_WAIT_MS 圈住，最多拖 25s。
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询扫描直到冒出 baseline 之外的新**活**窗，或等到超时。 */
async function waitForNewWindow(baseline: Set<number>, timeoutMs: number, ignore: ReadonlySet<number> = new Set()): Promise<PetWindow[]> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await sleep(POLL_MS);
		// 只认「真的能收事件」的窗：刚弹出来的 electron 要等本进程的 pet 服务接上，
		// 端口会先拒连接——不探一下就分不清「自己刚开的」和「别人的孤儿」。
		// `ignore` 是刚 taskkill 掉的窗：它们可能还在进程表里挂着，别把尸体认成活窗。
		const fresh = (await splitByHealth((await scan()).windows)).alive.filter(
			(w) => !baseline.has(w.pid) && !ignore.has(w.pid),
		);
		if (fresh.length > 0) return fresh;
		if (Date.now() >= deadline) return [];
	}
}

/**
 * 本进程自己开出来的那扇窗的端口（没有则 0）。
 * 自己的上游已经在广播了，再桥一次只是双发；反过来，**不是**自己的才必须桥——
 * 这就是「复用时一直在待机」的第二个成因。
 */
function ownWindowPort(): number {
	const s = readState();
	if (!isThisProcess(s)) return 0;
	const w = s.window;
	if (!w || w.reused !== false) return 0;
	// 窗可能已经关了、或者被 /pet-auto restart 换掉：进程不在了就不算自己的。
	// 否则本会话会一直以为「上游在替我广播」，新窗永远接不上桥。
	return pidAlive(w.pid) ? w.port : 0;
}

/* ====================== 进程内：拦下 add_pet（第二只） ====================== */

/** 被钩子拦下的 add_pet 次数，给 `/pet-auto status` 看。 */
let blockedAddPet = 0;

/**
 * 从**上游自己的入口文件**起算 `require('ws')`：这机器上 `agent/node_modules/ws` 与
 * `agent/npm/node_modules/ws` 是两份，打在错的实例上钩子等于没打。
 */
function loadWs(petEntry?: string): { prototype?: Record<string, unknown> } | null {
	const bases = [petEntry, path.join(AGENT_DIR, "package.json"), import.meta.url].filter(Boolean) as string[];
	for (const base of bases) {
		try {
			return createRequire(base)("ws") as { prototype?: Record<string, unknown> };
		} catch {
			/* 这个位置 require 不到 ws，换下一个 */
		}
	}
	return null;
}

/**
 * 上游 `/pet` 的注册入口文件（从命令表拿），用来从它的位置解析 `ws`。
 *
 * `pi.getCommands()` 是 **action method**：扩展还在加载（runtime 没 bind）时调它会抛
 * `Extension runtime not initialized. Action methods cannot be called during extension loading.`
 * ——那会把整个 session_start 打断（pi 弹一个扩展报错，宠物这条 session_start 全丢）。
 * 所以：**宁可当「有」也不抛**（探不到只说明这一瞬间拿不到命令表，宠物包本机装着），
 * 调用方拿 undefined 会走「找不到包」的降级分支，不会静默炸掉整个钩子。
 */
function petEntryPath(pi: ExtensionAPI): string | undefined {
	try {
		return pi.getCommands().find((c) => c.source === "extension" && c.name === PET_COMMAND)?.sourceInfo?.path;
	} catch {
		return undefined;
	}
}

/**
 * 上游 `/pet` 在「窗已开」时广播 `add_pet:<size>`，让窗里**再加一只**——这是宠物
 * 越叠越多的第二个来源。宠物服务广播时逐个 client 调 `ws.send()`，所以在
 * `WebSocket.prototype.send` 上挂个只认 `add_pet` 前缀的钩子就能拦掉，其余帧原样放行。
 * 钩子只装一次（幂等标记打在 prototype 上），是否拦截看实时的 `atLimit()`。
 */
function installAddPetBlock(pi: ExtensionAPI, atLimit: () => boolean): boolean {
	const proto = loadWs(petEntryPath(pi))?.prototype;
	if (!proto || typeof proto.send !== "function") return false;
	if (proto.piPetAddPetBlock === true) return true;
	const original = proto.send as (this: unknown, data: unknown, ...rest: unknown[]) => unknown;
	proto.send = function patchedSend(this: unknown, data: unknown, ...rest: unknown[]): unknown {
		try {
			const text = typeof data === "string" ? data : String(data);
			if (text === "add_pet" || text.startsWith("add_pet:")) {
				if (atLimit()) {
					blockedAddPet++;
					return undefined;
				}
			}
		} catch {
			/* 不是文本帧就当普通帧放行 */
		}
		return original.call(this, data, ...rest);
	};
	proto.piPetAddPetBlock = true;
	return true;
}

/* ================== 复用时的事件桥：把本会话接到别人的窗 ================== */

const bridgedPorts = new Set<number>();
let thinkingTimer: ReturnType<typeof setInterval> | null = null;
/** 端(口) → 停桥函数。对账要用：窗换掉后得知道该停哪条、还差哪条。 */
const activeBridges = new Map<number, () => void>();

/**
 * 桥的**真实**状态，给 `/pet-auto status` 看。
 * 以前这里全靠静默：connect 的 error 是空 handler、close 后 5s 重连也不吭声，
 * 于是「宠物一直待机」这件事没有任何线索（这正是它难查的原因）。
 */
interface BridgeInfo {
	port: number;
	state: "connecting" | "open" | "closed" | "error";
	/** 最后一次错的原因（连不上/被拒…），没有则空串。 */
	lastError: string;
	/** 桥建立至今成功发出的消息数。 */
	sent: number;
	since: number;
	/** 接的是哪条："/feed" = 全局宿主，"/ws" = 旧路的复用窗。 */
	endpoint?: "/ws" | "/feed";
}

const bridgeStates = new Map<number, BridgeInfo>();

function setBridge(port: number, patch: Partial<BridgeInfo>): void {
	const prev = bridgeStates.get(port) ?? { port, state: "connecting", lastError: "", sent: 0, since: Date.now() };
	bridgeStates.set(port, { ...prev, ...patch });
}

/** 状态栏用的一行摘要。`/feed` 那条是接全局宿主，`/ws` 是旧路的复用窗。 */
function bridgeReport(): string {
	if (bridgeStates.size === 0) return "无（没找到可复用的窗 / 宿主）";
	return [...bridgeStates.values()]
		.map((b) => `:${b.port}${b.endpoint === "/feed" ? "/feed" : ""} ${b.state}${b.lastError ? `(${b.lastError})` : ""} 发${b.sent}`)
		.join("  ");
}

function stopThinking(): void {
	if (thinkingTimer) {
		clearInterval(thinkingTimer);
		thinkingTimer = null;
	}
}

/**
 * 复用的窗连着别的 pi 进程的服务（或全局宿主），只听那边广播。这里当一次转接头：自己再连一条
 * WS，把同样的消息（agent_start / thinking / tool_call / agent_idle）转发过去，于是
 * 「一只宠物」照样跟着**每个**会话的思考、敲代码动。
 * `endpoint` 区分两种上游（这条是**唯一**的差别，别的都一样）：
 *   - `"/ws"`   旧路的复用窗：那个 pi 进程自己的宠物服务；
 *   - `"/feed"` 全局宿主：接 `/ws` 会被宿主当成「第二只窗的客户端」，接 `/feed` 才是喂事件。
 * 没有 ws 依赖就静默跳过——宠物照常呼吸，只是不跟本会话联动。
 * 返回停桥函数（`/pet-auto bridge off` 用；`pi.on` 的返回值就是退订）。
 */
function bridgeTo(pi: ExtensionAPI, petPort: number, endpoint: "/ws" | "/feed" = "/ws"): (() => void) | null {
	if (petPort <= 0 || bridgedPorts.has(petPort)) return null;
	const Ctor = (loadWs(petEntryPath(pi)) as { WebSocket?: new (url: string) => Record<string, unknown> } | null)?.WebSocket;
	if (typeof Ctor !== "function") {
		// 拿不到 ws 就明说，别再静默滑回「只会呼吸」
		setBridge(petPort, { state: "error", lastError: "拿不到 ws 依赖" });
		return null;
	}
	bridgedPorts.add(petPort);
	setBridge(petPort, { endpoint });

	let sock: Record<string, unknown> | null = null;
	const send = (msg: string): void => {
		try {
			if (sock?.readyState === 1) {
				(sock.send as (m: string) => void)(msg);
				setBridge(petPort, { state: "open", lastError: "", sent: (bridgeStates.get(petPort)?.sent ?? 0) + 1 });
			}
		} catch (err) {
			/* 桥断了就断了，宠物照旧；记一笔好查 */
			setBridge(petPort, { state: "error", lastError: (err as Error).message.slice(0, 40) });
		}
	};
	let alive = true;
	const connect = (): void => {
		if (!alive) return;
		setBridge(petPort, { state: "connecting" });
		try {
			sock = new Ctor(`ws://127.0.0.1:${petPort}${endpoint}`);
		} catch (err) {
			setBridge(petPort, { state: "error", lastError: (err as Error).message.slice(0, 40) });
			return;
		}
	const on = (event: "open" | "error" | "close", fn: (arg?: unknown) => void): void => {
			try {
				(sock?.on as ((e: string, f: (arg?: unknown) => void) => void) | undefined)?.(event, fn);
			} catch {
				/* 忽略 */
			}
		};
		on("open", () => {
			clearTimeout(watchdog);
			setBridge(petPort, { state: "open", lastError: "" });
		});
		// 「connecting」不能是终态：上面那个泄漏 socket 的情形下，握手永远不完成，
		// 状态就永远停在 connecting，看上去像在连、其实早死了。给它一个看门狗。
		const watchdog = setTimeout(() => {
			if (bridgeStates.get(petPort)?.state === "connecting") {
				setBridge(petPort, { state: "error", lastError: "连接超时：端口有人监听但无人应答" });
			}
		}, BRIDGE_WATCHDOG_MS);
		(watchdog as unknown as { unref?: () => void }).unref?.();
		on("error", (err) =>
			setBridge(petPort, { state: "error", lastError: String((err as Error)?.message ?? err ?? "connect failed").slice(0, 40) }),
		);
		on("close", () => {
			sock = null;
			// 主人会话退了再接回去。顺便把状态标出来，别让「静默」又变成无头案。
			setBridge(petPort, { state: "closed" });
			sleep(5_000).then(connect);
		});
	};
	connect();

	const offs = [
		pi.on("agent_start", () => {
			// 一轮新的 run 开始：先把可能残留的 thinking 节流清掉，
			// 否则 agent_settled 漏发时，本轮第一个 turn_start 不会立即报 thinking（只剩 2s 后的补发）
			stopThinking();
			send("agent_start");
		}),
		pi.on("agent_settled", () => {
			stopThinking();
			send("agent_idle");
		}),
		// 和上游一样：思考中最多每 2s 推一次，别刷爆
		pi.on("turn_start", () => {
			if (thinkingTimer) return;
			send("thinking");
			thinkingTimer = setInterval(() => send("thinking"), 2_000);
			(thinkingTimer as unknown as { unref?: () => void }).unref?.();
		}),
		pi.on("tool_call", (event) => send(JSON.stringify({ type: "tool_call", tool: event.toolName }))),
	];
	return () => {
		alive = false;
		stopThinking();
		for (const off of offs) off();
		bridgedPorts.delete(petPort);
		setBridge(petPort, { state: "closed", lastError: "已停" });
		try {
			(sock?.close as (() => void) | undefined)?.();
		} catch {
			/* 已经关了 */
		}
		sock = null;
	};
}

function stopBridges(): void {
	for (const stop of [...activeBridges.values()]) {
		try {
			stop();
		} catch {
			/* 忽略 */
		}
	}
	activeBridges.clear();
	bridgedPorts.clear();
}

/* ================================ 扩展本体 ================================ */

/** ctx 里只用得到 ui.notify；它和事件 ctx、命令 ctx 都兼容。 */
type NotifyLevel = "info" | "warning" | "error";
type Notifier = { ui: { notify: (message: string, type?: NotifyLevel) => void } };

/** notify 包一层：ctx 在 reload / 切会话后会失效，延迟回调里 notify 可能抛。 */
function notify(ctx: Notifier, message: string, level: NotifyLevel = "info"): void {
	try {
		ctx.ui.notify(message, level);
	} catch {
		/* 会话已经换走了 */
	}
}


/* ================================ 全局宿主（源码内嵌） ================================ */

/**
 * 宠物宿主：一个**不属于任何 pi 进程**的独立进程。整机只允许有一个（mkdir 独占锁），
 * 它自己提供窗要用的 HTTP+WS 与端口（端口写进全局状态文件 = 全局共享），
 * 自己拉 electron（detached+windowsHide：实测这样起的孩子不挂父控制台，关 cmd / Ctrl+C 都碰不到），
 * 并把各 pi 会话从 `WS /feed` 喂来的 agent 事件转给窗的 `WS /ws`。
 *
 * 为什么非得有它：上游把服务挂在 pi 进程里，于是 pi 一死，
 * ① 它自己 `process.on('exit') → taskkill /f /t` 把窗杀掉；
 * ② 就算堵住①，`pet.js` 的 ws 重试 5 次（≈15s）后自己 `closeWindow()` 关窗。
 * 「宠物活得比父进程久」在那个架构下无解，只能把服务搬到 pi 进程外面。
 *
 * 按内容 sha1 门控落盘（`writeHostScript`）：改了才重写，`.cjs` 不是扩展、pi 不会去加载它。
 * 文件顶部的注释是这个文件的说明书（别删，里面记着每一处「为什么」）。
 */
const HOST_SOURCE = `#!/usr/bin/env node
/**
 * pi-pet-host — 全局宠物宿主：独立进程，不属于任何 pi 进程
 *
 * 这个进程存在的唯一理由：**桌面宠物的寿命不能绑在任何一个 pi 进程上**。
 * 上游 \`pi-dsh-pet\` 把 HTTP+WS 服务和 electron 窗都挂在 pi 进程里，于是：
 *   1. pi 退出时上游自己 \`process.on('exit')\` → \`taskkill /f /t\` 把窗杀掉；
 *   2. 就算不杀，服务随 pi 一起没了 → \`pi/assets/pet.js\` 的 ws.onclose 重试
 *      5 次（约 15s）后调 \`closeWindow()\` → \`app.quit()\`，**窗会自己关掉**。
 * 所以「关掉父 cmd 进程后宠物还在」不可能靠「把窗 detach 一下」实现：必须有人
 * 在 pi 进程之外继续提供那个 127.0.0.1 的 HTTP+WS 服务。本进程就是那个人。
 *
 * 它做三件事：
 *   1. 独占锁（mkdir 原子）→ 整机只可能有一个宿主 = 只可能有一扇窗；
 *   2. 提供窗需要的那套 HTTP/WS（/ /pet.js /pet.css /config.jsonc /thumb/* /health），
 *      端口写进全局状态文件，各 pi 会话从这里读——端口是**全局共享**的，不再是
 *      「每个 pi 进程各找一个随机端口」；
 *   3. 自己拉起 electron（detached + windowsHide：实测这样起的孩子**不挂在父控制台上**，
 *      关掉 cmd / Ctrl+C 都碰不到它），并按 ctrl 文件里的意图维持窗。
 *
 * 事件汇聚：各 pi 会话把 agent 事件发到 \`/feed\`，宿主转给窗的 \`/ws\`。于是
 * 「一只宠物」跟着**所有**会话动，而窗和端口只属于本进程。
 *
 * 协议（与上游 pet.js 完全一致，不要自创）：
 *   → 窗：  "agent_start" / "thinking" / "agent_idle" / "add_pet:<size>" / "shutdown"
 *          {"type":"tool_call","tool":"bash"}
 *   ← 会话：同上（\`add_pet*\` 在 maxPets<=1 时被宿主丢掉，机器级单只的最后一道闸）
 *
 * 参数（都给 env 同名兜底，探针靠参数指到临时目录，不会碰真实宠物）：
 *   --port N     期望端口（被占就退一个随机空闲端口，真实端口写进状态文件）
 *   --pkg DIR    pi-dsh-pet 包根目录（含 pi/assets、assets/thumb）
 *   --global F   全局状态文件（宿主写，各会话读）
 *   --ctrl F     意图文件（扩展写，宿主每 2s 读一次）
 *   --lock DIR   独占锁目录
 *   --log F      日志（默认 stderr，反正 stdio 是 ignore）
 *   --no-window  只起服务不起窗（探针用）
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");

/* ============================== 参数 ============================== */

function argOf(flag, envName, fallback) {
	const i = process.argv.indexOf(flag);
	if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
	const env = process.env[envName];
	return env !== undefined && env !== "" ? env : fallback;
}

const OPT = {
	port: Number(argOf("--port", "PI_PET_PORT", "47653")) || 0,
	pkg: argOf("--pkg", "PI_PET_PKG", ""),
	globalFile: argOf("--global", "PI_PET_GLOBAL", ""),
	ctrlFile: argOf("--ctrl", "PI_PET_CTRL", ""),
	lockDir: argOf("--lock", "PI_PET_LOCK", ""),
	logFile: argOf("--log", "PI_PET_HOST_LOG", ""),
	noWindow: process.argv.includes("--no-window"),
};

/** 窗连上以后多久算「连上了」：npx 首次拉 Electron 可能要十几秒。 */
const WINDOW_GRACE_MS = Number(process.env.PI_PET_WINDOW_GRACE_MS || 20_000);
/** 窗断线多久后判死（窗侧 5 次重试 ≈15s 就自己关了，所以 20s 足够）。 */
const WINDOW_LOST_MS = Number(process.env.PI_PET_WINDOW_LOST_MS || 20_000);
/** 重启节流：刚起就崩别疯狂重拉。 */
const RELAUNCH_MIN_GAP_MS = 15_000;

const logLines = [];
function log(...parts) {
	const line = \`[pi-pet-host \${new Date().toISOString()}] \${parts.join(" ")}\`;
	logLines.push(line);
	if (logLines.length > 200) logLines.shift();
	try {
		if (OPT.logFile) fs.appendFileSync(OPT.logFile, \`\${line}\\n\`);
	} catch {
		/* 写不上日志不影响 */
	}
	try {
		if (!OPT.logFile) console.error(line);
	} catch {
		/* stdio 是 ignore，写失败正常 */
	}
}

/* ============================== 独占锁 ============================== */

/**
 * mkdir 跨进程原子：抢到 = 我是唯一宿主。
 * 抢不到时看 owner.json：主人还活着且锁不老 → 别人在干，安静退出（退出码 0，
 * 让「谁先起谁算」这件事对调用方无害）；主人已死/锁太老 → 清掉重抢。
 */
let holdingLock = false;
function acquireLock() {
	if (!OPT.lockDir) return true;
	const tryMkdir = () => {
		try {
			fs.mkdirSync(OPT.lockDir);
			return true;
		} catch {
			return false;
		}
	};
	if (tryMkdir()) {
		holdingLock = true;
	} else {
		let owner = null;
		try {
			owner = JSON.parse(fs.readFileSync(path.join(OPT.lockDir, "owner.json"), "utf8"));
		} catch {
			owner = null;
		}
		const alive = owner && Number.isInteger(owner.pid) && pidAlive(owner.pid);
		const fresh = alive && Date.now() - (Number(owner.at) || 0) < 60_000;
		if (fresh) {
			log(\`已有宿主在跑（pid \${owner.pid}），本进程安静退出\`);
			return false;
		}
		log(\`锁是陈旧的（owner \${owner ? owner.pid : "无"}），接管\`);
		try {
			fs.rmSync(OPT.lockDir, { recursive: true, force: true });
		} catch {
			/* 清不掉就当没抢到 */
		}
		if (!tryMkdir()) return false;
		holdingLock = true;
	}
	// 抢到的**立刻**写 owner：别的宿主只看得到「没有 owner」= 陈旧锁，
	// 写晚一点都可能让对方误判并抢第二次。
	try {
		fs.writeFileSync(
			path.join(OPT.lockDir, "owner.json"),
			\`\${JSON.stringify({ pid: process.pid, at: Date.now(), startedAt: HOST_STARTED_AT }, null, 2)}\\n\`,
			"utf8",
		);
	} catch {
		/* 写不上就认了：最坏是下个宿主等 TTL */
	}
	return true;
}

function releaseLock() {
	if (!holdingLock || !OPT.lockDir) return;
	holdingLock = false;
	try {
		fs.rmSync(OPT.lockDir, { recursive: true, force: true });
	} catch {
		/* 留着等 TTL */
	}
}

function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err.code === "EPERM";
	}
}

const HOST_STARTED_AT = Date.now();

/* ============================== 资产目录 ============================== */

const PKG = OPT.pkg ? path.resolve(OPT.pkg) : "";
const ASSETS = PKG ? path.join(PKG, "pi", "assets") : "";
const THUMB = PKG ? path.join(PKG, "assets", "thumb") : "";
const ELECTRON_SCRIPT = ASSETS ? path.join(ASSETS, "pet-electron.cjs") : "";

if (!PKG || !fs.existsSync(ELECTRON_SCRIPT)) {
	log(\`找不到 pi-dsh-pet 的资产（--pkg \${OPT.pkg || "(空)"}，需要 \${ELECTRON_SCRIPT}）\`);
	process.exit(2);
}

/** ws 从**包自己的位置**起算：pi-dsh-pet 声明了 ws 依赖，而宿主脚本躺在 state 目录里，
 *  直接 require('ws') 命中的是另一份（agent/node_modules 与 npm/node_modules 各有一份）。 */
function loadWs() {
	const bases = [];
	if (PKG) bases.push(path.join(PKG, "package.json"));
	if (OPT.globalFile) bases.push(path.dirname(OPT.globalFile));
	bases.push(__filename);
	for (const base of bases) {
		try {
			return createRequire(base)("ws");
		} catch {
			/* 换下一个 */
		}
	}
	try {
		return require("ws");
	} catch {
		return null;
	}
}

const WS = loadWs();
if (!WS || typeof WS.WebSocketServer !== "function") {
	log("拿不到 ws 依赖（宿主没法喂事件），退出");
	process.exit(3);
}

/* ============================== 意图文件（扩展 → 宿主） ============================== */

const CTRL_DEFAULT = { desired: true, keepAlive: true, maxPets: 1, size: "normal", bridge: true, restartNonce: 0 };

function readCtrl() {
	try {
		const raw = JSON.parse(fs.readFileSync(OPT.ctrlFile, "utf8"));
		return { ...CTRL_DEFAULT, ...(raw && typeof raw === "object" ? raw : {}) };
	} catch {
		return { ...CTRL_DEFAULT };
	}
}

/* ============================== 全局状态（宿主 → 各会话） ============================== */

const state = {
	role: "pi-pet-host",
	version: 1,
	pid: process.pid,
	startedAt: HOST_STARTED_AT,
	heartbeatAt: HOST_STARTED_AT,
	port: 0,
	pkg: PKG,
	size: "normal",
	windowPid: 0,
	windowStartedAt: 0,
	windowState: "none",
	clients: 0,
	feeds: 0,
	restarts: 0,
};

function writeState() {
	if (!OPT.globalFile) return;
	state.heartbeatAt = Date.now();
	state.clients = windowClients.size;
	state.feeds = feedClients.size;
	// 先写临时文件再 rename：读者（各 pi 会话）永远看到完整的一份，不会读到半截 JSON
	const tmp = \`\${OPT.globalFile}.\${process.pid}.tmp\`;
	try {
		fs.writeFileSync(tmp, \`\${JSON.stringify(state, null, 2)}\\n\`, "utf8");
		fs.renameSync(tmp, OPT.globalFile);
	} catch (err) {
		log(\`写状态失败：\${err.message}\`);
	}
}

/* ============================== 事件汇聚 ============================== */

/** 窗的客户端（正常只有 1 个：那只宠物）。 */
const windowClients = new Set();
/** 各 pi 会话喂事件的连接。 */
const feedClients = new Set();

function broadcastToWindow(msg) {
	let sent = 0;
	for (const ws of windowClients) {
		try {
			if (ws.readyState === 1) {
				ws.send(msg);
				sent++;
			}
		} catch {
			/* 单个客户端坏了不影响别人 */
		}
	}
	return sent;
}

/**
 * 机器级单只的最后一道闸：\`add_pet*\` 会让**窗里**再加一只。
 * 上游是在自己的进程里广播的，扩展侧钩子只在本进程有效；这里是全局的，
 * 任何会话（包括手敲 /pet 的那个）想加第二只都得先过这里。
 */
function shouldForward(msg, ctrl) {
	if (msg === "add_pet" || msg.startsWith("add_pet:")) {
		const want = Number(ctrl.maxPets);
		return Number.isInteger(want) && want > 1;
	}
	return true;
}

function onFeedMessage(ws, raw) {
	const msg = typeof raw === "string" ? raw : String(raw);
	if (!msg) return;
	const ctrl = readCtrl();
	if (!shouldForward(msg, ctrl)) {
		log(\`拦下 \${msg}（maxPets=\${ctrl.maxPets}）\`);
		return;
	}
	// 有人明确要关窗（例如 /pet-auto off 之后又有人发 shutdown）也照转
	broadcastToWindow(msg);
}

/* ============================== HTTP 静态资源 ============================== */

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".webm": "video/webm",
	".json": "application/json; charset=utf-8",
	".jsonc": "application/json; charset=utf-8",
};

function safeAsset(root, rel) {
	if (!rel || rel.includes("..")) return undefined;
	const candidate = path.normalize(path.join(root, rel));
	if (!candidate.startsWith(root)) return undefined;
	return candidate;
}

function sendFile(res, filePath) {
	fs.stat(filePath, (err, st) => {
		if (err || !st.isFile()) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("Not found");
			return;
		}
		res.writeHead(200, {
			"content-type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
			"content-length": st.size,
			"cache-control": "public, max-age=3600",
			"access-control-allow-origin": "*",
		});
		fs.createReadStream(filePath).pipe(res);
	});
}

function sendJson(res, body) {
	const text = JSON.stringify(body);
	res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
	res.end(text);
}

function handleRequest(req, res) {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const p = decodeURIComponent(url.pathname);
	// /ws 的 upgrade 在下面处理；这里先放行，免得被当成静态资源 404
	if (p === "/ws" || p === "/feed") {
		res.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
		res.end("upgrade required");
		return;
	}
	if (p === "/health") {
		// 扩展的探针靠这个端点判「这台机器上的宠物服务真的活着，而且它是不是宿主」
		sendJson(res, {
			...state,
			ok: true,
			heartbeatAt: Date.now(),
			windowConnected: windowClients.size > 0,
			maxPets: Number(readCtrl().maxPets) || 1,
		});
		return;
	}
	if (p === "/" || p === "/index.html") return sendFile(res, path.join(ASSETS, "pet.html"));
	if (p === "/pet.js") return sendFile(res, path.join(ASSETS, "pet.js"));
	if (p === "/pet.css") return sendFile(res, path.join(ASSETS, "pet.css"));
	if (p === "/config.jsonc" || p === "/config") {
		return sendFile(res, path.join(PKG, "assets", "config.jsonc"));
	}
	if (p.startsWith("/thumb/")) {
		const file = safeAsset(THUMB, p.slice("/thumb/".length));
		if (!file) {
			res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
			res.end("bad thumb path");
			return;
		}
		return sendFile(res, file);
	}
	res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	res.end("pi-pet-host: not found");
}

/* ============================== 窗 ============================== */

let windowChild = null;
let windowPid = 0;
let windowStartedAt = 0;
let lastWindowSeenAt = 0;
let lastLaunchAt = 0;

/* ============================== electron 可执行文件 ============================== */

/**
 * 找现成的 electron.exe，**绕开 npx**。
 *
 * 为什么：\`npx electron\` 会串出 cmd.exe → node(npx) → cmd.exe → node → electron，
 * 而 npm 自己 spawn 的那一层**不带 CREATE_NO_WINDOW**。我们给孩子的 cmd 是无控制台的
 * （windowsHide → CREATE_NO_WINDOW），npm 的孩子（那个 npx node）就没控制台可继承，
 * Windows 于是给它**新分配一个** —— 屏幕上弹一个黑框，标题「管理员: ...cmd.exe」。
 * 直接 spawn electron.exe：一条进程、零控制台，顺带省掉 npx 每次 1~2s 的解析。
 * 真找不到才退回 npx（能开窗，但会闪一个黑框）。
 */
const ELECTRON_BIN_FILE = OPT.globalFile ? \`\${OPT.globalFile}.electron.json\` : "";
let electronBinMemo;

function electronExe(distDir) {
	return path.join(distDir, process.platform === "win32" ? "electron.exe" : "electron");
}

/** npm 的 cache 目录：环境变量 → 各级 .npmrc 的 cache= → 平台默认值。**刻意不 spawn npm**（问一次就是又一层控制台）。 */
function npmCacheDirs() {
	const dirs = [];
	for (const v of [process.env.NPM_CONFIG_CACHE, process.env.npm_config_cache]) {
		if (v) dirs.push(path.resolve(v));
	}
	const rcs = [path.join(os.homedir(), ".npmrc"), path.join(PKG, ".npmrc"), path.join(process.cwd(), ".npmrc")];
	if (process.env.APPDATA) rcs.push(path.join(process.env.APPDATA, "npm", "etc", "npmrc"));
	for (const rc of rcs) {
		let text = "";
		try {
			text = fs.readFileSync(rc, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split(/\\r?\\n/)) {
			const m = /^\\s*cache\\s*=\\s*(.+?)\\s*$/.exec(line);
			if (m) dirs.push(path.resolve(m[1].replace(/^["']|["']$/g, "")));
		}
	}
	dirs.push(path.join(os.homedir(), ".npm"));
	if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "npm-cache"));
	return [...new Set(dirs)];
}

function resolveElectronBin() {
	if (electronBinMemo !== undefined) return electronBinMemo;
	let found = null;
	// 1. 显式指定（给 dist/ 或直接给 exe 都行）
	if (process.env.PI_PET_ELECTRON) {
		const v = process.env.PI_PET_ELECTRON;
		if (fs.existsSync(v)) found = v;
		else if (fs.existsSync(electronExe(v))) found = electronExe(v);
	}
	// 2. 上次找到的（记在状态文件旁边；缓存被清 / 换机器时自动失效）
	if (!found && ELECTRON_BIN_FILE) {
		try {
			const cached = String(fs.readFileSync(ELECTRON_BIN_FILE, "utf8")).trim();
			if (cached && fs.existsSync(cached)) found = cached;
		} catch {
			/* 没记过 */
		}
	}
	// 3. 包自己带了 electron
	if (!found) {
		const local = electronExe(path.join(PKG, "node_modules", "electron", "dist"));
		if (fs.existsSync(local)) found = local;
	}
	// 4. npx 缓存里那份（\`npx electron\` 装出来的就在这儿）
	if (!found) {
		for (const cache of npmCacheDirs()) {
			const npxDir = path.join(cache, "_npx");
			let names = [];
			try {
				names = fs.readdirSync(npxDir);
			} catch {
				continue;
			}
			for (const name of names) {
				const exe = electronExe(path.join(npxDir, name, "node_modules", "electron", "dist"));
				if (fs.existsSync(exe)) {
					found = exe;
					break;
				}
			}
			if (found) break;
		}
	}
	electronBinMemo = found;
	if (found) {
		log(\`electron 直接用 \${found}（不经 npx，不弹控制台）\`);
		if (ELECTRON_BIN_FILE) {
			try {
				fs.writeFileSync(ELECTRON_BIN_FILE, found);
			} catch {
				/* 写不上就下次重新找 */
			}
		}
	} else {
		log("没找到现成的 electron.exe，退回 npx 拉窗（会闪一个控制台窗口）");
	}
	return found;
}

/**
 * 拉起 electron。**detached + windowsHide 是必须的**，实测：
 *   detached:false + windowsHide:true  →  CREATE_NO_WINDOW，孩子不挂父控制台（已经免疫）
 *   detached:false + 无 windowsHide     →  挂父控制台，关 cmd 时一起死
 * 两个一起给：无论宿主自己怎么被拉起（node / bun / 任何运行时对 detached 的支持程度），
 * 窗都不在父控制台上；同时宿主死了窗也能自己活着（直到 WS 断 15s 后自己关）。
 *
 * 另外：**能直接 spawn electron.exe 就别过 npx**（npx 那层会凭空多出一扇控制台窗口，
 * 见 resolveElectronBin）。直接起还有个附带好处：windowPid 就是 electron 本尊，
 * taskkill /t 精确打到窗 + 它的 GPU/renderer 孩子，不用顺着 npx 的孙进程猜。
 */
function launchWindow(size) {
	const isWin = process.platform === "win32";
	const env = { ...process.env };
	// 跟上游一致：国内机器走 npmmirror（GitHub / S3 不通）
	if (isWin && !env.ELECTRON_MIRROR) {
		env.ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
		env.NPM_CONFIG_REGISTRY = "https://registry.npmmirror.com";
	}
	state.size = size || readCtrl().size || "normal";
	const bin = resolveElectronBin();
	try {
		// 尺寸参数上游压根没传给 electron（窗里几只、每只多大只由 config.jsonc 决定），
		// 这里照样记进状态，别让人以为 size 改的是初始窗口。
		const spec = bin
			? { file: bin, args: [ELECTRON_SCRIPT, String(state.port)], shell: false }
			: { file: isWin ? "npx.cmd" : "npx", args: ["--yes", "electron", ELECTRON_SCRIPT, String(state.port)], shell: isWin };
		windowChild = spawn(spec.file, spec.args, {
			cwd: PKG,
			env,
			stdio: "ignore",
			detached: true,
			windowsHide: true,
			shell: spec.shell,
		});
	} catch (err) {
		log(\`拉起 electron 失败：\${err.message}\`);
		state.windowState = "spawn-failed";
		writeState();
		return;
	}
	windowPid = windowChild.pid ?? 0;
	windowStartedAt = Date.now();
	lastLaunchAt = windowStartedAt;
	lastWindowSeenAt = 0;
	state.windowPid = windowPid;
	state.windowStartedAt = windowStartedAt;
	state.windowState = "starting";
	state.restarts++;
	writeState();
	log(\`拉起窗：pid \${windowPid} → http://127.0.0.1:\${state.port}\`);

	windowChild.on("error", (err) => {
		log(\`electron 启动出错：\${err.message}\`);
		state.windowState = "error";
		writeState();
	});
	windowChild.on("exit", (code) => {
		log(\`electron 退出（code \${code}）\`);
		if (windowChild && windowChild.pid === windowPid) {
			windowPid = 0;
			state.windowPid = 0;
			state.windowState = "exited";
			writeState();
		}
	});
	try {
		windowChild.unref();
	} catch {
		/* 不影响 */
	}
}

function closeWindow() {
	if (!windowPid) return;
	log(\`关掉窗 pid \${windowPid}\`);
	if (process.platform === "win32") {
		try {
			spawn("taskkill", ["/pid", String(windowPid), "/f", "/t"], { stdio: "ignore", windowsHide: true });
		} catch {
			/* 忽略 */
		}
	} else {
		try {
			process.kill(windowPid, "SIGTERM");
		} catch {
			/* 已经没了 */
		}
	}
	windowPid = 0;
	state.windowPid = 0;
	state.windowState = "closed";
	// 把宽限期从此刻重算：不然本拍的「窗没了 → keepAlive 重拉」会和下面 restartNonce
	// 安排的换窗撞车，旧窗刚 taskkill、新窗又叠上来，屏幕上就是两只
	windowStartedAt = Date.now();
	writeState();
}

/* ============================== 起步 ============================== */

if (!acquireLock()) process.exit(0);

function shutdown(code) {
	try {
		releaseLock();
	} catch {
		/* 忽略 */
	}
	process.exit(code);
}
process.on("exit", () => releaseLock());
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (err) => {
	log(\`未捕获异常：\${err && err.stack ? err.stack : err}\`);
	// 服务已经起来了就别自杀，只记一笔（窗还能继续用）
});

const wss = new WS.WebSocketServer({ noServer: true });
wss.on("connection", (ws, req) => {
	const p = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
	if (p === "/ws") {
		windowClients.add(ws);
		lastWindowSeenAt = Date.now();
		state.windowState = "connected";
		log(\`窗接上了（当前 \${windowClients.size} 个客户端）\`);
		ws.on("close", () => {
			windowClients.delete(ws);
			if (windowClients.size === 0) {
				state.windowState = windowPid ? "disconnected" : "none";
				writeState();
			}
			log(\`窗断开（剩 \${windowClients.size} 个）\`);
		});
		ws.on("error", () => windowClients.delete(ws));
		// 窗接上先给它一发配置尺寸的 add_pet？没意义（单只），略。
		writeState();
		return;
	}
	if (p === "/feed") {
		feedClients.add(ws);
		log(\`会话接入事件汇聚（当前 \${feedClients.size} 个会话）\`);
		ws.on("message", (data) => {
			try {
				onFeedMessage(ws, data);
			} catch (err) {
				log(\`转发出错：\${err.message}\`);
			}
		});
		ws.on("close", () => {
			feedClients.delete(ws);
			log(\`会话离开（剩 \${feedClients.size} 个）\`);
			writeState();
		});
		ws.on("error", () => feedClients.delete(ws));
		writeState();
		return;
	}
	ws.close();
});

const server = http.createServer(handleRequest);
server.on("upgrade", (req, socket, head) => {
	const p = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
	if (p === "/ws" || p === "/feed") {
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
	} else {
		socket.destroy();
	}
});

/** 端口：优先期望值（全局共享的固定端口），被占就退一个随机空闲端口并如实写进状态。 */
function listen() {
	return new Promise((resolve) => {
		const tryPort = (port, left) => {
			const onError = (err) => {
				server.removeListener("error", onError);
				if (err && err.code === "EADDRINUSE" && left > 0) {
					tryPort(randomPort(), left - 1);
					return;
				}
				log(\`监听失败：\${err && err.message}\`);
				process.exit(4);
			};
			server.once("error", onError);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", onError);
				resolve();
			});
		};
		tryPort(OPT.port || randomPort(), 20);
	});
}

function randomPort() {
	return 10240 + Math.floor(Math.random() * (49151 - 10240));
}

let lastStateWrite = 0;
/** ctrl.restartNonce 的上次值。null = 还没记（起动那一刻先对齐，免得白补一次换窗）。 */
let lastRestartNonce = null;

/** 每 2s：读意图、维持窗、刷心跳。 */
function tick() {
	const ctrl = readCtrl();
	if (!ctrl.desired) {
		// 意图是「不要宠物」：关窗、放手、走人。下次有人 \`/pet-auto on\` 会重新拉起。
		log("ctrl 说不要宠物了 → 关窗退出");
		broadcastToWindow("shutdown");
		setTimeout(() => {
			closeWindow();
			shutdown(0);
		}, 250);
		return;
	}
	// \`restartNonce\` 变了 = 有人要换一只窗（\`/pet-auto restart\`）：
	// **由宿主自己**关掉旧窗再拉新的；扩展那边不伸手 taskkill —— 那样宿主会以为窗还在，
	// keepAlive 又拉一只，或者留一个没有窗的服务端口。留 1.5s 给 taskkill 真正落地。
	const nonce = Number(ctrl.restartNonce) || 0;
	if (lastRestartNonce === null) {
		lastRestartNonce = nonce;
	} else if (nonce !== lastRestartNonce) {
		lastRestartNonce = nonce;
		log("ctrl.restartNonce 变了 → 换一扇窗");
		closeWindow();
		setTimeout(() => {
			const now = readCtrl();
			if (now.desired) launchWindow(now.size);
		}, 1_500);
		return;
	}
	if (ctrl.size) state.size = ctrl.size;
	if (OPT.noWindow) {
		writeState();
		return;
	}
	// 窗在不在，以「有没有 WS 客户端」为准（比 pid 可靠：pid 在但窗崩了也连不上）
	const connected = windowClients.size > 0;
	if (connected) {
		lastWindowSeenAt = Date.now();
		if (state.windowState !== "connected") {
			state.windowState = "connected";
			writeState();
		}
	} else {
		const sinceSeen = lastWindowSeenAt === 0 ? Infinity : Date.now() - lastWindowSeenAt;
		const childGone = !windowChild || windowChild.exitCode !== null || !pidAlive(windowPid);
		const pastGrace = Date.now() - windowStartedAt > WINDOW_GRACE_MS;
		const pastLost = sinceSeen > WINDOW_LOST_MS;
		if (ctrl.keepAlive && childGone && pastGrace && pastLost && Date.now() - lastLaunchAt > RELAUNCH_MIN_GAP_MS) {
			log("窗没了（keepAlive）→ 重新拉起");
			launchWindow(ctrl.size);
		} else if (state.windowState !== "starting" && pastGrace && !connected) {
			state.windowState = "no-window";
			writeState();
		}
	}
	if (Date.now() - lastStateWrite > 5_000) {
		lastStateWrite = Date.now();
		writeState();
	}
}

server.listen && null;
listen()
	.then(() => {
		const addr = server.address();
		state.port = typeof addr === "object" && addr ? addr.port : 0;
		state.size = readCtrl().size || "normal";
		if (OPT.noWindow) {
			state.windowState = "disabled";
			log(\`宿主已起（仅服务）：127.0.0.1:\${state.port}  pid \${process.pid}\`);
		} else {
			log(\`宿主已起：127.0.0.1:\${state.port}  pid \${process.pid}\`);
			launchWindow(state.size);
		}
		writeState();
		setInterval(tick, 2_000);
	})
	.catch((err) => {
		log(\`起步失败：\${err && err.stack ? err.stack : err}\`);
		process.exit(5);
	});
`;

/* ================================ 全局宿主的控制面 ================================ */

/** 宿主（/health 与全局状态文件）报上来的东西。`role` 用来确认「这台真是宿主」，
 *  别把某个 pi 进程自己那个同端口的宠物服务误当成宿主。 */
interface HostState {
	role?: string;
	version?: number;
	pid?: number;
	port?: number;
	startedAt?: number;
	heartbeatAt?: number;
	windowPid?: number;
	windowStartedAt?: number;
	windowState?: string;
	clients?: number;
	feeds?: number;
	size?: string;
	pkg?: string;
	ok?: boolean;
}

/** 意图文件（扩展写，宿主每 2s 读）。`desired` 是总闸：false = 宿主关窗退出。 */
interface CtrlIntent {
	desired?: boolean;
	keepAlive?: boolean;
	maxPets?: number;
	size?: PetSize;
	bridge?: boolean;
	/** 变了就换一扇窗（`/pet-auto restart`）。 */
	restartNonce?: number;
}

function sha1(text: string): string {
	return createHash("sha1").update(text).digest("hex");
}

/**
 * 按内容 hash 门控写宿主脚本：内容没变就**不碰**文件（省得 mtime 乱跳、也少一个被 AV
 * 反复扫的目标）。写的时候先写临时文件再改名，免得宿主正在被拉起时读到半截源码。
 */
function writeHostScript(): { path: string; changed: boolean } {
	try {
		if (existsSync(HOST_SCRIPT_PATH) && sha1(readFileSync(HOST_SCRIPT_PATH, "utf8")) === sha1(HOST_SOURCE)) {
			return { path: HOST_SCRIPT_PATH, changed: false };
		}
	} catch {
		/* 读不了就重写 */
	}
	writeFileAtomic(HOST_SCRIPT_PATH, HOST_SOURCE);
	return { path: HOST_SCRIPT_PATH, changed: true };
}

/** 先写临时文件再改名：读者（宿主 / 别的会话）永远看到完整的一份。 */
function writeFileAtomic(file: string, text: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, text, "utf8");
	// Windows 的 rename 不能覆盖已存在的目标（EPERM），先删再改名
	try {
		rmSync(file, { force: true });
	} catch {
		/* 删不掉就让下面的 rename 报错 */
	}
	renameSync(tmp, file);
}

function readJsonFile<T>(file: string): T | null {
	try {
		const raw = JSON.parse(readFileSync(file, "utf8")) as T;
		return raw && typeof raw === "object" ? raw : null;
	} catch {
		return null;
	}
}

/** 读全局状态 = 读「端口是多少」的唯一入口：各会话都从这儿拿，所以端口是全局共享的。 */
function readGlobal(): HostState | null {
	return readJsonFile<HostState>(GLOBAL_PATH);
}

function readCtrl(): CtrlIntent {
	return readJsonFile<CtrlIntent>(CTRL_PATH) ?? {};
}

/** 合并写意图（只改给的那几个字段，其余留着——多会话同时写别互相清空）。 */
function writeCtrl(patch: CtrlIntent): void {
	writeFileAtomic(CTRL_PATH, `${JSON.stringify({ ...readCtrl(), ...patch }, null, 2)}\n`);
}

type HostHealth = (port: number, timeoutMs?: number) => Promise<HostState | null>;

/**
 * GET /health。必须核 `role === "pi-pet-host"`：状态文件是**任何**进程都能写的普通
 * 文件，光看它写着「有宠物」就信，等于把「读到了脏数据」当成「宠物在」。
 */
const hostHealth: HostHealth = (port, timeoutMs = 1_500) =>
	((globalThis as { __piPetHostHealth?: HostHealth }).__piPetHostHealth ?? realHostHealth)(port, timeoutMs);

function realHostHealth(port: number, timeoutMs = 1_500): Promise<HostState | null> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (value: HostState | null): void => {
			if (done) return;
			done = true;
			resolve(value);
		};
		const req = httpRequest(
			{ host: "127.0.0.1", port, path: "/health", method: "GET", timeout: timeoutMs },
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					finish(null);
					return;
				}
				let buf = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					buf += chunk;
					if (buf.length > 65_536) req.destroy();
				});
				res.on("end", () => {
					try {
						const parsed = JSON.parse(buf) as HostState;
						finish(parsed?.role === "pi-pet-host" ? parsed : null);
					} catch {
						finish(null);
					}
				});
			},
		);
		req.on("timeout", () => {
			req.destroy();
			finish(null);
		});
		req.on("error", () => finish(null));
		req.end();
	});
}

/** 等某个宿主把端口公布出来并真的应答（多会话同时起时，输的那个等赢的那个）。 */
async function waitForHost(timeoutMs: number, pollMs = 250): Promise<HostState | null> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await sleep(pollMs);
		const global = readGlobal();
		if (global && Number(global.port) > 0) {
			const health = await hostHealth(Number(global.port));
			if (health) return health;
		}
		if (Date.now() >= deadline) return null;
	}
}

/** PATH 上找可执行文件（Windows 要带 PATHEXT；PATH 项可能带引号，要剥掉）。 */
function findOnPath(exe: string): string | null {
	const exts =
		process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(path.delimiter) : [""];
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const base = dir.replace(/^"|"$/g, "");
		for (const ext of exts) {
			const candidate = path.join(base, ext ? `${exe}${ext}` : exe);
			try {
				if (existsSync(candidate)) return candidate;
			} catch {
				/* 无权限目录跳过 */
			}
		}
	}
	return null;
}

/**
 * 宿主拿什么运行时跑。pi 自己是 Bun 打包的单文件，`process.execPath` 指的是 `pi.exe`，
 * **不能**拿来当 node 用（会变成「pi 启动 pi」）。所以另外找 PATH 上的 node；
 * 实在没有就退 bun（宿主是纯 CJS，bun 吃得下 `node:http` / `ws`）。
 *
 * 顺序：配置里的 `hostRuntime` > `PI_PET_NODE` > PATH 上的 node > bun。
 * 前两个就是给「改名」用的：把 node.exe 复制一份叫 `pi-pet-host.exe` 指过来，
 * 任务管理器里那只宠物宿主就不叫 node.exe 了（node.exe 自包含，复制改名能直接跑）。
 */
function resolveRuntime(configured = ""): string | null {
	const explicit = [configured, process.env.PI_PET_NODE ?? ""]
		.map((s) => s.trim())
		.find((s) => s !== "" && existsSync(s));
	if (explicit) return explicit;
	return findOnPath("node") ?? findOnPath("bun");
}

/**
 * 通知里怎么称呼宿主。直接 basename 会在默认配置下变成难看的 `node.EXE`
 * （扩展/宿主都是 CJS 兼容的运行时，node / bun 都行），所以**默认叫「pi-pet 宿主」**；
 * 配了 `hostRuntime` 才显示那个文件名（那本来就是用户特意改过的名字）。
 */
function runtimeLabel(configured: string): string {
	return configured.trim() !== "" ? path.basename(configured) : "pi-pet 宿主";
}

/**
 * pi-dsh-pet 包根目录：扩展入口在 `<pkg>/pi/extensions/index.ts`，往上两级就是 `<pkg>`
 * （里面有 `pi/assets/pet-electron.cjs`、`pi/assets/pet.js`、`assets/thumb`）。
 * 认这个目录而不是猜路径：包版本变了目录结构变了也不会拉错。
 */
function petPackageRoot(pi: ExtensionAPI): string | null {
	const entry = petEntryPath(pi);
	if (!entry) return null;
	const root = path.resolve(path.dirname(entry), "..", "..");
	return existsSync(path.join(root, "pi", "assets", "pet-electron.cjs")) ? root : null;
}

interface HostSpawn {
	command: string;
	args: string[];
}

/**
 * 探针用 `globalThis.__piPetSpawnHost` 顶掉真拉起（免得测试机真冒出窗来）。
 * 返回拉起来的 pid（假货返回 undefined → 通知里显示 `?`）——拉不起来时要能说清
 * 「到底拉起了哪个 pid、它叫什么」，不然又是一桩无头案。
 */
type HostSpawner = (spec: HostSpawn & { detached: boolean; windowsHide: boolean; stdio: "ignore" }) => number | undefined;

function hostSpawner(): HostSpawner {
	const hook = (globalThis as { __piPetSpawnHost?: HostSpawner }).__piPetSpawnHost;
	if (typeof hook === "function") return hook;
	// detached + windowsHide + stdio ignore：宿主不在父进程的控制台事件范围里（Ctrl+C / 关 cmd
	// 都不沾），也没有自己的控制台；`detached` 同时保证父进程被 taskkill /t 时**不**连坐它
	// （taskkill 只跟父子关系走，detached 断了这层关系）。
	return (spec) => {
		const child = spawn(spec.command, spec.args, {
			detached: spec.detached,
			windowsHide: spec.windowsHide,
			stdio: spec.stdio,
		});
		child.on("error", () => {
			/* 拉不起来（比如文件被删了）：等 /health 超时那条通知里会报 pid undefined */
		});
		child.unref();
		return child.pid;
	};
}

/** 关掉宿主（连带它那扇窗）。`restart` / `off` 的兜底路径用。 */
async function killHostProcess(host: HostState): Promise<boolean> {
	const pid = Number(host.pid);
	if (!pid || !pidAlive(pid)) return false;
	if (process.platform === "win32") {
		await capture("taskkill", ["/pid", String(pid), "/f", "/t"]);
	} else {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			/* 已经没了 */
		}
	}
	return true;
}

export default function piPetAutostart(pi: ExtensionAPI): void {
	const { config, broken } = loadConfig();
	let runtime = { ...config };
	let fired = false;
	let addPetBlocked = false;
	/** 上一轮拿到的宿主（null = 走的旧路 / 宿主没起来）。status 与巡检都要用它。 */
	let host: HostState | null = null;
	/** 巡检定时器：`session_start` 与 `/pet-auto status` 之后只跑一次。 */
	let sweepTimer: ReturnType<typeof setInterval> | null = null;
	/** 巡检收掉过的窗 pid：只提醒一次，别每 60s 报同一条。 */
	const swept = new Set<number>();

	/** 上游包是否在（命令表里能查到）。不在就静默跳过——没装宠物的人不该被提醒。 */
	const petInstalled = (): boolean => {
		try {
			return pi.getCommands().some((c) => c.source === "extension" && c.name === PET_COMMAND);
		} catch {
			// action method 在扩展加载期不可用（见 petEntryPath 的注释）：这一瞬间拿不到命令表，
			// 按「在」继续（真没装的话后面 petPackageRoot 会返回 null，走降级而不是抛异常）
			return true;
		}
	};

	/** 桥到**别的进程**的窗。自己开的那扇不用桥（上游已在广播，桥了只是双发）。 */
	const bridgeIfForeign = (port: number): void => {
		if (!runtime.bridge || port <= 0) return;
		if (port === ownWindowPort()) return;
		const stop = bridgeTo(pi, port);
		if (stop) activeBridges.set(port, stop);
	};

	/**
	 * 把本会话的事件喂到宿主的 `/feed`。**所有**会话都走这一条，所以宠物是全局唯一的那一只，
	 * 却跟着所有会话动。与旧路的 `bridgeIfForeign`（接别人进程的 `/ws`）的区别就是路径：
	 * 接 `/ws` 会被宿主当成「第二个窗客户端」，接 `/feed` 才是喂事件。
	 */
	const feedHost = (port: number): void => {
		if (!runtime.bridge || port <= 0) return;
		const stop = bridgeTo(pi, port, "/feed");
		if (stop) activeBridges.set(port, stop);
	};

	/**
	 * 确保全局宿主在跑，返回它的状态（null = 走旧路）。
	 * 顺序很重要：**先探活再拉起**。多开几个 pi 会话时每个都以为自己该起一个，
	 * 靠「状态文件里的端口探得到 /health」认出现有那个，才不会拉起一堆宿主。
	 */
	const ensureHost = async (ctx: Notifier, allowStart = true): Promise<HostState | null> => {
		if (!runtime.host) return null;
		// 1. 已有的：状态文件里的端口探得到 /health 且 role 对 → 直接用
		const known = readGlobal();
		if (known && Number(known.port) > 0) {
			const health = await hostHealth(Number(known.port));
			if (health) {
				host = health;
				writeCtrl(ctrlIntent());
				return health;
			}
		}
		// 不许拉起（`autostart:false` 的会话、`bridge on` 只想接上）→ 到此为止
		if (!allowStart) return null;
		// 2. 拉一个：抢锁 → 写宿主脚本 → detached 拉起 → 等 /health
		const root = petPackageRoot(pi);
		if (!root) {
			notify(ctx, "找不到 pi-dsh-pet 的安装目录（pi/assets/pet-electron.cjs），本会话退回旧路开窗", "warning");
			return null;
		}
		const runtime_bin = resolveRuntime(runtime.hostRuntime);
		if (!runtime_bin) {
			notify(
				ctx,
				`找不到能跑宿主的运行时（配的 hostRuntime=${runtime.hostRuntime || "(空)"} 不存在，PATH 上也没有 node / bun），` +
					"本会话退回旧路开窗（关掉本会话宠物就没了）",
				"warning",
			);
			return null;
		}
		if (!acquireLockAt(HOST_BOOT_LOCK_PATH)) {
			// 别的会话正在拉宿主：等它把端口公布出来（输家不重复拉，否则一堆宿主抢同一个端口）
			const health = await waitForHost(HOST_WAIT_MS);
			if (health) {
				host = health;
				// 认领别人的宿主也要刷一遍意图：不然另一个会话的 `/pet-auto off`
				// 之后，这里还停着一条「我还想要宠物」的旧意图
				writeCtrl(ctrlIntent());
				return health;
			}
			notify(ctx, "别的会话正在拉起宠物宿主，本会话就不重复拉了", "info");
			return null;
		}
		try {
			const script = writeHostScript();
			const args = [
				script.path,
				"--port",
				String(runtime.port),
				"--pkg",
				root,
				"--global",
				GLOBAL_PATH,
				"--ctrl",
				CTRL_PATH,
				"--lock",
				HOST_LOCK_PATH,
			];
			writeCtrl(ctrlIntent());
			const spec = {
				command: runtime_bin,
				args,
				// 探针死盯这两个参数：去掉任何一个，宠物就会重新绑回父 cmd 进程的命
				detached: true,
				windowsHide: true,
				stdio: "ignore" as const,
			};
			// pid 拉起时就拿到：等不到 /health 时那条告警得说清「拉起的是哪个 pid、叫什么」，
			// 否则又是一桩无头案（假 spawner 返回 undefined → 落个 `?`）
			const hostChildPid = hostSpawner()(spec);
			const health = await waitForHost(HOST_WAIT_MS);
			if (!health) {
				notify(
					ctx,
					`拉起了${runtimeLabel(runtime.hostRuntime)}（${path.basename(runtime_bin)}，pid ${hostChildPid ?? "?"}）` +
						`但 ${HOST_WAIT_MS / 1000}s 内没应答，本会话退回旧路开窗。` +
						`排查：/pet-auto status 看锁与端口；宿主抢不到单例锁（${path.basename(HOST_LOCK_PATH)}）就会秒退`,
					"warning",
				);
				return null;
			}
			host = health;
			notify(
				ctx,
					`全局宠物宿主：pid ${health.pid} :${health.port}（${runtimeLabel(runtime.hostRuntime)} / ` +
					`${path.basename(runtime_bin)}，${script.changed ? "已写入新脚本" : "复用已有脚本"}），` +
					`这一只属于整台机器，不随本会话关闭`,
				"info",
			);
			return health;
		} finally {
			// 只还**启动锁**：`--lock` 那把（HOST_LOCK_PATH）已经被宿主接过去了，
			// 这里删它等于把宿主的单例锁抽掉 → 下一个宿主马上抢进来开第二个服务端口。
			releaseLockAt(HOST_BOOT_LOCK_PATH);
		}
	};

	/** 本会话要告诉宿主的意图（也是多会话之间的「合并配置」）。 */
	const ctrlIntent = (): CtrlIntent => {
		const patch: CtrlIntent = {
			keepAlive: runtime.keepAlive,
			maxPets: runtime.maxPets,
			size: runtime.size,
			bridge: runtime.bridge,
		};
		// `desired` 只在**本会话真的要**的时候才声明：要的人说「要」，不要的人不吭声，
		// 否则 autostart:false 的那个会话会把别人正在用的宿主直接关掉。
		// 真要关只能由 `/pet-auto off` 显式写 false（那是用户的动作，理应赢）。
		if (runtime.autostart) patch.desired = true;
		return patch;
	};

	/**
	 * 巡检：让「整机只有一只」从「启动时那一下」变成**持续不变量**。
	 * 宿主那条路：宿主自己那扇（端口 == 宿主端口，或 pid == 宿主报的窗 pid）合法，
	 * 其余**全是多余的**（别人手敲 `/pet` 冒出来的：端口是那个 pi 进程自己的随机端口）。
	 * 旧路：按 `startedAt` 留最老的 maxPets 只，其余收掉。
	 * 扫不动（`ok:false`）就**什么都不做**——扫描失败不是「没有窗」的证据。
	 */
	const sweepWindows = async (ctx: Notifier, force = false): Promise<void> => {
		if (!petInstalled()) return;
		const shot = await scan();
		if (!shot.ok) {
			if (force) notify(ctx, "巡检扫不到全机宠物窗，本轮不动手（保证已降级）", "warning");
			return;
		}
		let doomed: PetWindow[];
		if (host && Number(host.port) > 0) {
			const ownPort = Number(host.port);
			const ownPid = Number(host.windowPid);
			doomed = shot.windows.filter((w) => w.pid !== ownPid && w.port !== ownPort);
		} else {
			const { alive } = await splitByHealth(shot.windows);
			const sorted = alive.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
			doomed = sorted.slice(Math.max(1, runtime.maxPets));
		}
		if (doomed.length === 0) return;
		let closed = 0;
		for (const w of doomed) {
			if (await killer()(w)) {
				closed++;
				if (!swept.has(w.pid)) {
					swept.add(w.pid);
					notify(ctx, `巡检收掉多余的宠物窗 pid ${w.pid}:${w.port}（整机只留一只）`, "warning");
				}
			}
		}
		if (closed === 0) return;
	};

	const startSweep = (ctx: Notifier): void => {
		if (sweepTimer || runtime.sweepMs <= 0) return;
		sweepTimer = setInterval(() => void sweepWindows(ctx), runtime.sweepMs);
		// 巡检只是个兜底，不该拖住 pi 退出
		sweepTimer.unref?.();
	};

	/**
	 * 上游那套 `openWindow` 只在**降级**时用：宿主起不来时（没 node / 宿主不答复）
	 * 至少让本会话有只宠物，代价是它绑在本进程上。
	 */
	const legacyOpen = async (size: PetSize, ctx: Notifier, ignore: ReadonlySet<number> = new Set()): Promise<void> => {
		await openWindow(size, ctx, ignore);
	};

	/**
	 * 入口：宿主优先，失败才降级。
	 * 宿主起来时**不派发 `/pet`**——窗和端口都由宿主管，本进程一个 electron 都不碰。
	 */
	const startPet = async (size: PetSize, ctx: Notifier): Promise<void> => {
		if (runtime.host) {
			const h = await ensureHost(ctx);
			if (h) {
				feedHost(Number(h.port));
				startSweep(ctx);
				return;
			}
		}
		await legacyOpen(size, ctx);
	};

	/** 已经有**活的**窗 → 复用：不派发 `/pet`、不 add_pet，把本会话事件桥过去。 */
	const adopt = (wins: PetWindow[], ctx: Notifier): void => {
		const first = wins[0];
		notify(
			ctx,
			`已有 ${wins.length} 只宠物在跑（pid ${first.pid} :${first.port}），本会话复用，不再新开`,
		);
		markFired({ ...first, reused: true });
		bridgeIfForeign(first.port);
	};

	/**
	 * 端口没人监听 = 主人 pi 进程已死的孤儿。它不占名额也得收掉：
	 * 留着就会把本会话一直吸附上去，桥过去永远发不出东西（只会呼吸）。
	 * 只收 `dead`（连接被拒，确定性），`unknown`（超时等）一律放过，不误杀好窗。
	 * 返回收掉的个数，提示由调用方拼（cleanup 要把它并进自己那条）。
	 */
	const reapOrphans = async (orphans: PetWindow[]): Promise<number> => {
		let closed = 0;
		for (const w of orphans) if (await killer()(w)) closed++;
		return closed;
	};

	/**
	 * 每次 `session_start` 都跑一遍，**不受** `fired` / `alreadyFiredThisProcess()` 限制。
	 * 那两个闸只该管「别重复开窗」，不该管「别重复建桥」：同进程内第二次
	 * session_start（`/reload`、`/clear`、tree 跳转）以前在这里就 return 了，
	 * 复用的窗从此没人喂事件，永久待机。
	 */
	const ensureBridge = async (): Promise<void> => {
		if (!runtime.bridge) return;
		// 宿主模式下桥由 startPet 负责（走 /feed），这里只管旧路那些窗
		if (host && Number(host.port) > 0) return;
		const shot = await scan();
		// 扫不动就维持现状：一次扫描抖动不该把好桥全停掉（同「扫不动 ≠ 没有窗」）
		if (!shot.ok) return;
		const { alive } = await splitByHealth(shot.windows);
		const own = ownWindowPort();
		const foreign = new Map<number, PetWindow>();
		for (const w of alive) if (w.port > 0 && w.port !== own) foreign.set(w.port, w);
		// 窗被关掉 / 换掉（`/pet-auto restart`、崩了重开）之后，旧桥必须停：
		// 否则本会话永远挂在已经不存在的端口上，新窗没人接 = 宠物窗重启了也没人动。
		for (const [port, stop] of [...activeBridges]) {
			if (foreign.has(port)) continue;
			stop();
			activeBridges.delete(port);
		}
		for (const port of foreign.keys()) bridgeIfForeign(port);
	};

	/**
	 * 跨进程的开窗流程（**只在降级时走**）：扫描 → 验活 → 不够就抢锁 → 复核 → 派发 `/pet` →
	 * 等自己的窗冒出来。任何一个「已经有活窗」的分支都走 `adopt`（复用），绝不叠第二扇。
	 */
	const openWindow = async (size: PetSize, ctx: Notifier, ignore: ReadonlySet<number> = new Set()): Promise<void> => {
		// 刚 taskkill 掉的窗可能还在进程表里挂着，先剔掉，别把尸体当活窗复用
		const live = (r: ScanResult): PetWindow[] => r.windows.filter((w) => !ignore.has(w.pid));
		// 「扫不动」≠「真没有窗」。先重试一次；还是不行就照开，但**明说**保证已降级，
		// 否则用户只会看到莫名其妙的两只，还查不出原因。
		let shot = await scan();
		if (!shot.ok) {
			await sleep(POLL_MS);
			shot = await scan();
		}
		if (!shot.ok) {
			notify(ctx, "扫不到全机宠物窗（wmic / PowerShell 都没成功），单只保证已降级，仍按配置开一扇", "warning");
		}
		// 验活：端口没人监听的孤儿不占名额（否则会一直吸附在死窗上）
		const base = await splitByHealth(live(shot));
		const reapedBase = await reapOrphans(base.orphans);
		if (reapedBase > 0) {
			notify(ctx, `清掉 ${reapedBase} 个孤儿宠物窗（主人 pi 进程已死，端口没人监听，收不到任何事件）`);
		}
		if (base.alive.length >= runtime.maxPets) {
			adopt(base.alive, ctx);
			return;
		}

		if (!acquireLock()) {
			// 别的会话正在开：等它开出来复用，别抢着再开一扇
			const born = await waitForNewWindow(new Set(live(shot).map((w) => w.pid)), LAUNCH_WAIT_MS, ignore);
			if (born.length > 0) {
				adopt(born, ctx);
				return;
			}
			if (!acquireLock()) {
				notify(ctx, "别的会话正在开宠物窗，本会话就不重复弹了", "info");
				return;
			}
		}

		try {
			// 拿到锁后再扫一次：抢锁期间可能刚好有人开出来
			const recheckShot = await scan();
			const recheck = await splitByHealth(live(recheckShot));
			const reapedAgain = await reapOrphans(recheck.orphans);
			if (reapedAgain > 0) notify(ctx, `清掉 ${reapedAgain} 个孤儿宠物窗（主人 pi 进程已死）`);
			if (recheck.alive.length >= runtime.maxPets) {
				adopt(recheck.alive, ctx);
				return;
			}
			// 派发扩展命令：pi 认 `/` 开头 + expandPromptTemplates，命令执行完即 return，
			// 不进 prompt、不起 LLM 轮次（agent-session.js 的 _tryExecuteExtensionCommand）
			try {
				pi.sendUserMessage(`/${PET_COMMAND} ${size}`, { expandPromptTemplates: true });
			} catch (err) {
				// 派发失败（极少）：宠物没开出来，不影响会话，但别静默——不然又是一桩无头案
				notify(ctx, `派发 /pet 失败：${String((err as Error)?.message ?? err).slice(0, 60)}`, "warning");
				return;
			}
			const born = await waitForNewWindow(new Set(live(recheckShot).map((w) => w.pid)), WATCH_MS, ignore);
			if (born.length > 0) {
				// 只有**复核扫描可信**时才敢认领「这是我自己开的那扇」：扫挂时 baseline 是空集，
				// 派发前后冒出来的别人的窗会被记成 reused:false → ownWindowPort()>0 →
				// 本会话既不建桥也不再开窗，宠物永远不动。不确定就记成「复用」，照样建桥。
				markFired({ ...born[0], reused: !recheckShot.ok });
				if (!recheckShot.ok) bridgeIfForeign(born[0].port);
			} else {
				notify(ctx, "派发 /pet 后 25s 内没等到新宠物窗（上游可能仍以为窗已开），可用 /pet-auto restart 换一只", "warning");
			}
		} finally {
			releaseLock();
		}
	};

	// 进程被硬杀时别把锁留给下个会话
	releaseLockOnExit(releaseLock);

	pi.on("session_start", (_event, ctx) => {
		if (!petInstalled()) return; // 没装宠物包的人不该被提醒，也不该被挂钩子
		// 拦 add_pet 的钩子与自动启动无关：只要上限是 1 就得拦（bench 沙箱等非 tui 模式除外）
		if (ctx.mode === "tui" && !addPetBlocked) addPetBlocked = installAddPetBlock(pi, () => runtime.maxPets <= 1);

		if (ctx.mode !== "tui") return; // print / json / rpc（bench 沙箱）不弹桌面窗

		// 宿主优先：能拿到全局宿主就**只**喂事件（/feed），一个 electron 都不碰。
		// `ensureHost` 内部自带「探活→复用」，所以这里不必等 fired/记账：每次 session_start
		// 都跑一遍是**故意**的（/reload、切会话、多开 pi 都要重新确认全局状态）。
		if (runtime.host) {
			void (async () => {
				const h = await ensureHost(ctx, runtime.autostart);
				if (h) {
					feedHost(Number(h.port));
					startSweep(ctx);
					return;
				}
				// 宿主起不来：降级，但把「这一只绑在本进程上」说清楚
				await ensureBridge();
				if (!runtime.autostart || fired || alreadyFiredThisProcess()) return;
				fired = true;
				markFired(undefined, true);
				await legacyOpen(runtime.size, ctx);
			})();
			if (broken) notify(ctx, `pi-dsh-pet 配置读坏，按默认启用处理：${CONFIG_PATH}`, "warning");
			return;
		}

		// 建桥**独立于**下面的开窗闸：已经有活窗就接上，没有才考虑开。
		// 放在闸外是修「/reload 或切会话后复用的窗永久待机」的关键。
		void ensureBridge();
		startSweep(ctx);

		if (!runtime.autostart) return;
		if (fired || alreadyFiredThisProcess()) return;
		if (broken) notify(ctx, `pi-dsh-pet 配置读坏，按默认启用处理：${CONFIG_PATH}`, "warning");

		fired = true;
		markFired(undefined, true); // 先记「打算开」，真等到窗（或复用）再转正
		const size = runtime.size;
		const delay = runtime.delayMs;
		// 上游的 session_start 里在起 HTTP 服务；错开一点让它先就绪（它也能自己补起，这里只是稳态）
		// 整段（扫进程 + 等锁 + 等窗）都放后台：wmic 起步 0.4s，不能挡住 session_start
		if (delay > 0) setTimeout(() => void legacyOpen(size, ctx), delay);
		else void legacyOpen(size, ctx);
	});

	pi.registerCommand("pet-auto", {
		description:
			"Toggle pi-dsh-pet autostart (on|off|size <档位>|max <只数>|bridge on|off|host on|off|status|cleanup|restart)",
		getArgumentCompletions: (prefix) =>
			["on", "off", "size", "max", "bridge", "host", "status", "cleanup", "restart"]
				.filter((v) => v.startsWith(prefix))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const [verb, value] = (args || "").trim().split(/\s+/);
			if (verb === "on" || verb === "off") {
				runtime.autostart = verb === "on";
				fired = false; // 本进程内允许立刻重试
				saveConfig(runtime);
				if (runtime.host) {
					// off = 写 `desired:false`，宿主自己会关窗退出（不是我们伸手去关它的窗：
					// 那样会留下一个没主人的服务端口，别的会话的桥全断）
					writeCtrl({ desired: runtime.autostart });
					if (runtime.autostart) {
						const h = await ensureHost(ctx, true);
						if (h) feedHost(Number(h.port));
						startSweep(ctx);
					}
				} else if (!runtime.autostart) {
					// 旧路：上游的窗绑在本进程上，只能伸手关（/pet-stop 同理，但那个走的是上游自己的进程）
					const { windows } = await scan();
					for (const w of windows) if (w.port === ownWindowPort() || windows.length === 1) await killer()(w);
				}
				notify(
					ctx,
					`pi-dsh-pet 自动启动：${runtime.autostart ? "on" : "off"}（${CONFIG_PATH}）` +
						(runtime.host
							? runtime.autostart
								? "｜全局宿主：开着"
								: "｜全局宿主：已要求关窗退出（再 on 会重新拉起）"
							: "｜当前走旧路（宿主 off），宠物绑在本进程上"),
				);
				return;
			}
			if (verb === "host") {
				if (value !== "on" && value !== "off") {
					notify(ctx, "用法：/pet-auto host on|off（off = 退回本进程内开窗，用于排查宿主）", "error");
					return;
				}
				runtime.host = value === "on";
				saveConfig(runtime);
				notify(
					ctx,
					runtime.host
						? "全局宿主：on（下次 session_start 起，或直接 /pet-auto on）"
						: "全局宿主：off（退回旧路：宠物绑在本 pi 进程上，关掉本会话就没了；已有的宿主不动）",
				);
				return;
			}
			if (verb === "size") {
				if (!SIZES.includes(value as PetSize)) {
					notify(ctx, `档位只能是 ${SIZES.join(" / ")}`, "error");
					return;
				}
				runtime.size = value as PetSize;
				saveConfig(runtime);
				writeCtrl({ size: runtime.size });
				notify(ctx, `pi-dsh-pet 默认尺寸：${runtime.size}（宿主换窗时生效）`);
				return;
			}
			if (verb === "max") {
				const want = Number(value);
				if (!Number.isInteger(want) || want < 1 || want > MAX_PETS_CEILING) {
					notify(ctx, `只数只能是 1–${MAX_PETS_CEILING} 的整数`, "error");
					return;
				}
				runtime.maxPets = want;
				saveConfig(runtime);
				// maxPets 是**机器级**的：宿主那层就是按它做最后一道闸的（丢掉 add_pet* 帧）
				writeCtrl({ maxPets: runtime.maxPets });
				notify(ctx, `pi-dsh-pet 同时最多 ${want} 只（现有多余的用 /pet-auto cleanup 收掉）`);
				return;
			}
			if (verb === "bridge") {
				if (value === "off") {
					runtime.bridge = false;
					stopBridges();
					saveConfig(runtime);
					writeCtrl({ bridge: false });
					notify(ctx, "事件桥已关：复用的宠物只跟开它那个会话动");
					return;
				}
				if (value !== "on") {
					notify(ctx, "用法：/pet-auto bridge on|off", "error");
					return;
				}
				runtime.bridge = true;
				saveConfig(runtime);
				writeCtrl({ bridge: true });
				// 宿主模式：接 `/feed`（不拉起宿主，只接已有的）
				if (runtime.host) {
					const h = await ensureHost(ctx, false);
					if (h) {
						feedHost(Number(h.port));
						notify(ctx, `事件桥已开（宿主 :${h.port}，本会话走 /feed）`);
					} else {
						notify(ctx, "事件桥已开，但没找到在跑的宿主（下次 session_start 会拉）", "warning");
					}
					return;
				}
				// 已经开着活窗的，本进程马上补一条桥
				const wins = (await scan()).windows;
				const { alive } = await splitByHealth(wins);
				for (const w of alive) bridgeIfForeign(w.port);
				notify(ctx, `事件桥已开${alive.length > 0 ? `（接到 pid ${alive[0].pid} :${alive[0].port}）` : "（没扫到可接的活窗）"}`);
				return;
			}
			if (verb === "cleanup") {
				const { alive, orphans } = await splitByHealth((await scan()).windows);
				// 拿不到出生时刻的（startedAt=0）当最新的处理 → 优先收掉
				const wins = alive.sort((a, b) => (a.startedAt || Number.MAX_SAFE_INTEGER) - (b.startedAt || Number.MAX_SAFE_INTEGER));
				// 宿主模式下，宿主报的那只（端口匹配）无条件保留：它是全局那一只，
				// 哪怕扫描里它「最年轻」也不能收——收了整机就一只都不剩。
				const ownPort = host ? Number(host.port) : 0;
				const ownPid = host ? Number(host.windowPid) : 0;
				const isHostWindow = (w: PetWindow): boolean => ownPort > 0 && (w.port === ownPort || w.pid === ownPid);
				const keep = [...wins.filter(isHostWindow), ...wins.filter((w) => !isHostWindow(w))].slice(
					0,
					Math.max(runtime.maxPets, wins.filter(isHostWindow).length),
				);
				const drop = wins.filter((w) => !keep.includes(w));
				if (drop.length === 0 && orphans.length === 0) {
					notify(ctx, `现在 ${wins.length} 只，没多余的（上限 ${runtime.maxPets}）`);
					return;
				}
				let closed = 0;
				for (const w of drop) if (await killer()(w)) closed++;
				const reaped = await reapOrphans(orphans, ctx);
				notify(
					ctx,
					`关掉了 ${closed} 只多余的宠物窗，保留最老的 ${keep.length} 只` +
						(keep.length > 0 ? `（${keep.map((w) => `pid ${w.pid}:${w.port}`).join(" / ")}）` : "") +
						(reaped > 0 ? `；另清掉 ${reaped} 个孤儿窗` : "") +
						`｜想换一只大的用 /pet-auto restart`,
				);
				return;
			}
			if (verb === "restart") {
				// 宿主模式：改 nonce 让宿主自己关掉旧窗再拉新窗（不伸手去 taskkill 它的窗：
				// 那样宿主会以为窗还在、keepAlive 又拉一只，或者直接孤零零剩个服务端口）
				if (runtime.host) {
					const h = await ensureHost(ctx, false);
					if (!h) {
						notify(ctx, "没有在跑的宿主，先 /pet-auto on 拉一个", "warning");
						return;
					}
					const before = Number(h.windowPid);
					writeCtrl({ desired: true, restartNonce: (Number(readCtrl().restartNonce) || 0) + 1 });
					// 宿主 2s 一拍，任务 1.5s 后执行 → 等 4.5s 确认换了一只
					for (let waited = 0; waited < 9_000; waited += 500) {
						await sleep(500);
						const now = readGlobal();
						const health = now && Number(now.port) > 0 ? await hostHealth(Number(now.port)) : null;
						if (health && Number(health.windowPid) > 0 && Number(health.windowPid) !== before) {
							stopBridges();
							feedHost(Number(health.port));
							notify(ctx, `换了一只：宿主 pid ${health.pid} 的窗 pid ${before} → ${health.windowPid}（:${health.port}）`);
							return;
						}
					}
					notify(ctx, "10s 内没看到宿主换窗（npx 拉 Electron 可能很慢），用 /pet-auto status 看窗状态", "warning");
					return;
				}
				const { windows } = await scan();
				for (const w of windows) await killer()(w);
				// taskkill 之后进程表还会挂一会儿：把这些 pid 拉黑到本轮开窗结束，
				// 否则复核时会把刚杀的窗当活窗复用 → 桥到尸体上，永远收不到事件
				const ignore = new Set(windows.map((w) => w.pid));
				fired = false;
				stopBridges();
				// 上游要等它自己的 exit 回调把 electronProc 置空，否则再派发 /pet 会被当成
				// 「窗已开」→ 变成 add_pet（钩子在的话就被拦掉，窗就一直不出来了）
				await sleep(RESTART_WAIT_MS);
				await legacyOpen(runtime.size, ctx, ignore);
				return;
			}

			// 默认（无参 / status）：把「限额到底生效了没」「这一只到底归谁」摊开给用户看
			const shot = await scan();
			const { alive, orphans } = await splitByHealth(shot.windows);
			const wins = alive.sort((a, b) => a.startedAt - b.startedAt);
			const state = readState();
			const own = ownWindowPort();
			// 宿主状态：现读一次（可能刚被别人起了 / 刚退了），别只信内存里那份
			const global = readGlobal();
			const live = global && Number(global.port) > 0 ? await hostHealth(Number(global.port)) : null;
			if (live) host = live;
			notify(
				ctx,
				`pi-dsh-pet autostart=${runtime.autostart} size=${runtime.size} delayMs=${runtime.delayMs} ` +
				`maxPets=${runtime.maxPets} bridge=${runtime.bridge ? "on" : "off"} host=${runtime.host ? "on" : "off"} ` +
					// 改名要看这一行：默认是 PATH 上的 node.exe（任务管理器里叫 node.exe），
					// 配了 hostRuntime 才是那个文件名
					`宿主运行时=${runtime.hostRuntime ? path.basename(runtime.hostRuntime) : "(默认) node.exe"}${runtime.hostRuntime ? ` → ${runtime.hostRuntime}` : ""}` +
					// 这两个不是一个东西，分开写：fired 是**本模块实例**开没开过（/reload 会重置），
					// alreadyFiredThisProcess() 是 pid 记账说本进程开没开过（跨 /reload 仍在）。
					// 合成一个「本进程已弹」会自相矛盾：/reload 后 fired=false，而窗明明是本进程开的。
					`本实例已开=${fired} 记账命中=${alreadyFiredThisProcess()}` +
					(live
						? `\n全局宿主：pid ${live.pid} :${live.port}（活着；会话数=${live.feeds ?? 0} 窗连接=${live.clients ?? 0}）` +
						  `窗 pid=${live.windowPid} 状态=${live.windowState} 巡检=${runtime.sweepMs > 0 ? `${Math.round(runtime.sweepMs / 1000)}s` : "关"}` +
						  `｜这一只属于整台机器，关掉本会话 / 父 cmd 都不影响它`
						: global
							? `\n全局宿主：没应答（状态文件说 pid ${global.pid} :${global.port}，探不到 /health）——可能已被硬杀，`
							  + "下次 session_start 会重新拉起"
					: `\n全局宿主：没在跑（${runtime.autostart ? "下次 session_start 会拉起" : "autostart=off"}）`) +
					(live
						? ""
						: `｜启动锁=${existsSync(HOST_BOOT_LOCK_PATH) ? "被占（别的会话在拉）" : "空闲"} ` +
						  `单例锁=${existsSync(HOST_LOCK_PATH) ? "在（宿主活着）" : "空"}`) +
				`\n宠物包=${petInstalled() ? "已装" : "未装"} 扫进程=${shot.ok ? "ok" : "失败(保证降级)"}` +
				` 活窗=${wins.length}/${runtime.maxPets}` +
				(wins.length > 0 ? `（${wins.map((w) => `pid ${w.pid}:${w.port}`).join(" / ")}）` : "") +
				` 孤儿窗=${orphans.length}` +
				(orphans.length > 0 ? `（${orphans.map((w) => `pid ${w.pid}:${w.port}`).join(" / ")}，cleanup 可收）` : "") +
				` add_pet 已拦=${blockedAddPet} 钩子=${addPetBlocked ? "已装" : "没装"}` +
				`\n事件桥：${bridgeReport()}` +
				(own > 0 ? `（:${own} 是本进程自己开的，上游直发不桥）` : "") +
				`\n记账：${STATE_PATH}${state.window ? `（上次落在 pid ${state.window.pid}:${state.window.port}${state.window.reused ? " 复用" : ""}）` : ""}` +
				(live ? `｜宿主：${GLOBAL_PATH}` : "") +
				`｜多的用 cleanup 收，只留一只且要新开窗用 restart`,
			);
		},
	});
}
