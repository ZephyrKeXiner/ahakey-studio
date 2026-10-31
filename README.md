# AhaKey Studio

AhaKey Runtime 的桌面端，基于 Tauri 2、React 19 和 TypeScript。设备连接与事务执行由独立 Rust Runtime 持有；Studio 负责编辑、确认和任务呈现。

## 开发

需要 Node.js、Rust 和平台的 Tauri 构建依赖；macOS 使用 Xcode Command Line Tools。先构建相邻的 `ahakey-runtime-rust` 仓库，或通过 `AHAKEY_RUNTIME_BINARY` 指定 Runtime，并将匹配的 `ahakey-input-monitor` 放在同目录（也可用 `AHAKEY_INPUT_MONITOR_BINARY` 指定）。默认开发与打包命令从相邻 Runtime 源码构建 macOS 输入 helper，并构建 supervisor、核对架构和准备原生组件；Release 构建需要对应的 Release Runtime。

```sh
npm ci
npm run tauri dev
```

`npm run dev` 提供前端浏览器预览。实际 Runtime IPC 在 Tauri Rust 宿主中执行，认证 token 不进入 WebView。

## 当前实现

- 设备概览：实时显示连接、电量、模式与任务；通过 Runtime 连接或断开键盘。
- 原生会话：私有 discovery、loopback 地址校验、hello 认证、原子快照与持续事件订阅；支持请求关联、心跳、重连、实例切换和事件缺口恢复。
- 键位编辑：四个模式、四个物理键，快捷键、修饰键和宏。读取后直接显示设备键位；未写入的修改保留，未知键位保持未知。
- 独立改键：写入前重新获取 baseToken，确认指定键的动作差异，只提交改动键。写入期间继续编辑时，旧任务完成不会清除新草稿。
- 亮度与描述：独立修改全局亮度与四个模式的按键描述；先确认同步，未知项保持未知，历史草稿可恢复。提交时冻结明确修改的字段，旧任务完成不清除新编辑；任务和草稿随其他配置一起持久保存。
- OLED：PNG/JPEG/GIF 本地预览、原生 SHA-256 与逐块确认传输、19 个目标位置、帧数限制、上传确认、进度、暂停及继续。静态图片支持缩放、移动并确认裁剪为 160×80 PNG；最大 2 MiB。GIF 保留原帧数，须为 160×80、100ms/帧、无限循环。上传后显示进度弹窗，可暂停并核对键盘控制恢复，也可返回编辑让任务继续。
- 系统与权限：展示 Runtime 原生输入组件上报的授权和运行状态，支持打开 macOS 蓝牙、输入监控设置。断开连接后状态显示未知；打开设置不会自行标记已授权。应用包包含蓝牙用途声明。
- 任务恢复：提交前持久保存原任务 ID、请求及素材引用；重连和重新打开后查询原任务。连接失败不会自动重发设备写入。
- 本地草稿和任务记录保存在桌面 WebView 的 localStorage。OLED 已准备素材保存在 Runtime 资源目录；重开 Studio 可继续使用素材引用，本地原图预览需重新选择文件。

macOS 已接入会话级后台管理：打开 Studio 时附着已有 Runtime，未运行时启动随包提供的 Runtime。退出 Studio 后继续运行；界面主动关闭时先持久保存停止意图，再结束 Runtime，当前 Studio 不自动重启它。下次打开 Studio 可重新启动。

后台使用当前 GUI 会话的 launchd job 与独立 supervisor。Runtime 异常退出后以 1、2、4 秒退避，最多自动重启三次；预算用尽后需手动恢复。预算属于本次开机，重启后不会沿用旧故障预算。plist 放在应用数据目录的 `runtime-session` 中，不安装到 `~/Library/LaunchAgents`，电脑重启后不会因登录扫描而自启。

Studio 直接通过 discovery 和认证 WebSocket 对接 Rust Runtime。已运行的外部 Runtime 只附着，不按保存的 PID 关闭；未运行时启动随包 Runtime。启动检查以 Runtime 自身的所有权锁为准。已接入 macOS Apple Speech 语音与 Claude Code／Cursor／Codex Hook。

“系统与权限”中可保存后台输入观察开关，默认关闭。设置在下一次后台启动时生效，保存开关不会重启 Runtime 或中断现有任务；可在同页关闭并重新启动后台来应用。Runtime 通过 `--input-monitor` 启动随包 helper，并管理其生命周期；模拟模式不会启动真实监听。独立启动的 Runtime 仍从原启动来源配置，Studio 不接管它。权限页直接使用 Runtime 的状态，兼容旧版缺少 `snapshot.input` 的情况；不读取 Studio 自身的授权来推断后台是否获准，也不保存按键内容。蓝牙授权尚无 Runtime 查询接口，界面提供系统设置入口，不推断授权结果。

### 设备状态的含义

键位页的“已知”来自 Runtime 当前配置/读回结果，不声称每次都重新读取了物理 Flash。OLED 当前资源区域显示设备元数据，预览区域显示本地文件。完成状态来自 Runtime 的任务确认；真机显示方向和断电保持另需硬件验收。

## 隔离联调

默认 macOS discovery：`~/Library/Application Support/AhaKey/runtime/discovery.json`。`AHAKEY_RUNTIME_DISCOVERY` 可指定测试路径。

先在 Runtime 仓库运行：

```sh
cargo run --locked -- --mock --discovery "$HOME/.ahakey-studio-dev/discovery.json"
```

随后在 Studio 仓库运行：

```sh
AHAKEY_RUNTIME_DISCOVERY="$HOME/.ahakey-studio-dev/discovery.json" npm run tauri dev
```

命令行只读检查：

```sh
AHAKEY_RUNTIME_DISCOVERY="$HOME/.ahakey-studio-dev/discovery.json" \
  cargo run --manifest-path src-tauri/Cargo.toml --example runtime_probe
```

自动真实 IPC 联调：

```sh
npm run test:runtime
```

脚本启动一个私有临时目录中的 `--mock` Runtime，验证单键修改、其他配置不变、事件完成、重连核对、亮度/描述字段补丁、PNG 素材准备、OLED 上传与 CRC 读回，然后关闭测试进程。默认使用相邻仓库 `../ahakey-runtime-rust/target/debug/ahakey-runtime-rust`；可设置 `AHAKEY_RUNTIME_BINARY`。不会连接真实键盘。

## 检查与构建

```sh
npm run check
npm test
npm run test:ui
npm run test:service
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
npm run tauri build -- --debug --bundles app
```

首次运行界面测试需要 `npx playwright install chromium`。也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 使用已有 Chrome。界面测试使用测试专用 Tauri bridge fixture；原生测试与 `test:runtime` 分别覆盖 socket 故障和实际 Runtime 协议。

`npm run test:service` 在临时目录中注册唯一的 Mock launchd job，验证控制端退出后存活、单实例、崩溃恢复、主动停止、重新打开、输入观察偏好持久化与启动参数、恢复预算。`npm run test:bundle` 在构建开发包后启动真实 Studio 窗口，使用独立 Mock Runtime 验证随包组件与退出后后台存活；测试结束清理会话任务。它们不会连接真实键盘。

本地开发包位于 `src-tauri/target/debug/bundle/macos/AhaKey Studio.app`。签名身份通过 `APPLE_SIGNING_IDENTITY` 或本机 `signing-identity.local` 配置，详见下文；公开分发仍需公证。

原生通信层已接入新增的 `configuration.patch`，支持独立亮度和指定键描述，联调覆盖原任务恢复及其他键位、灯效、OLED 不变。“亮度与描述”编辑页通过该接口提交修改。此方法依赖相邻 Runtime 仓库本次增量；旧 Runtime 不支持时不可退回整组覆盖写入。契约见 [字段级接口](../ahakey-runtime-rust/docs/configuration-patch-api.md)。

## 后续实现

1. 更完整的素材编辑与动图制作。
2. 继续补齐灯效字段补丁和真机故障恢复验收；键位、亮度与描述补丁、显式完整读回及按字段暂停/核验/续写已接入。
3. 完成 macOS 语音与 AI Hook 的真人／真机验收，扩展 Claude Code／Cursor 一键接入。
4. 保留配置的固件升级、性能稳定性验收及签名分发。

2026-10-23 范围更新：按用户决定，旧 macOS Agent 的兼容、迁移、接管与回退不在本项目范围内。Studio 只对接 Rust Runtime。

产品依据：[macOS Runtime 集成决策](https://github.com/AhakeyAI/desktop/blob/runtime/docs/macos-runtime-integration-decisions.md)。Runtime API：[接口参考](https://github.com/AhakeyAI/ahakey-runtime-rust/blob/main/docs/websocket-api.md)、[OLED 上传](https://github.com/AhakeyAI/ahakey-runtime-rust/blob/main/docs/oled-api.md)。

Apache-2.0，见 [LICENSE](LICENSE)。

### 显式设备读回

键位和亮度/描述页面新增“从设备完整读取”，调用配套 Runtime 的 `configuration.read`。这是异步设备任务；原有缓存刷新改名为“刷新已知键位/设置”。读取最多三次，界面显示当前尝试和失败原因，支持手动重试。读取期间写入禁用，本地编辑继续；键位读取完成后直接更新未修改的键，保留未写入草稿。亮度与描述仍通过同步设置导入。

读取进度通过 `configuration.get` 的 `read` 与配置事件恢复。刷新或退出 Studio 不取消 Runtime 的读取；Runtime 重启后重新建立基线。完整读回覆盖四模式键位/描述/灯效和亮度，无法表示的字段保持未知。配套 Runtime 必须包含 `configuration.read` 扩展，旧版本会禁用入口。MockX1 没有硬件读回，明确显示“不支持”；成功路径由真实 X1 读回协议捕获数据和 WebSocket 测试覆盖，仍待真机验收。

### 配置任务暂停与续写

任务记录中，支持字段事务的配置任务提供“暂停配置写入”和“核验并继续配置”。暂停完成当前字段（键位的清除/设置帧一起完成），继续使用原任务 ID，先读取设备并跳过已一致项目。新编辑的草稿不加入旧任务；外部修改冲突或字段不可读取时保留暂停并提示处理。

进度分别显示字段 ACK、读回核验和保存命令 ACK。Runtime 重启后保留暂停任务，不自动重发。没有读回能力的固件与 Mock 不伪造验证结果；首次写入可显示 ACK 完成，续写需可用的读回。真机断电保持及设备输入恢复仍需验证。协议细节见相邻 Runtime 的 `docs/configuration-transactions.md`。

### 原生 macOS 参考设计

2026-10-25 根据旧客户端 v0.2.0 (87) 的 57 张截图目录重做界面：顶部设备状态栏、四模式分段控件、可点击键盘画布、右侧配置面板与底部草稿状态栏。参考位于相邻 `AhakeyAI-desktop/design-reference/native-macos-2026-10-25/index.html`，截图仅用于设计对照，不随应用打包。

点击按键、灯条或 LCD 可进入已有的键位、亮度/描述与素材编辑；连接设备及硬件切换模式时，画布与配置面板自动跟随；点击标签可查看其他模式，未写入草稿按模式保留，查看操作不会修改键盘运行模式。设备信息、任务记录、权限诊断、帮助中心与新手引导使用弹窗展示。AhaType、云端账号、灯效映射、虚拟拨杆与固件升级仍未接入，界面不模拟这些能力或沿用旧 Agent 接管流程。

默认窗口 1280 × 820，最小 900 × 640。界面测试覆盖画布与编辑器模式一致性、仅确认后提交、断线草稿恢复、弹窗与键盘操作、最小窗口宽度。

### 语音输入与 AI 编程联动

AI 联动页默认只显示审批方式（关闭／手动确认／跟随拨杆）、Codex 接入状态和待处理请求。设备绑定、按键录入、手动 Hook 配置及历史记录收进「高级设置与记录」；已安装的 Codex 接入维护操作默认折叠。打开页面不会更改联动设置。

先在相邻 Runtime 仓库运行 `cargo build --bins --locked`，再启动或打包 Studio。原生准备脚本会构建并包含 `AhaKey Speech.app` 和 `ahakey-hook`。

- 语音输入：Apple Speech 实时转写、按住／点击 F18 录音、原生悬浮窗、复制与原输入框自动粘贴。先启用后台输入观察并重启 Runtime，再请求麦克风／语音识别权限，选择当前输入设备并保存。自动粘贴另需辅助功能授权。试录只预览，不自动粘贴。
- AI 编程联动：生成并手动合并 Claude Code、Cursor 或 Codex 项目 Hook 配置，关联在线键盘后启用。支持工作状态、单次批准／拒绝和实体按键确认；明确开启自动审批后，每次重新查询实体拨杆才决定是否批准。Codex 的 Hook 定义需在工具内审查信任。
- Runtime 重启或设备重连后，根据稳定 HID 身份恢复语音，根据原 BLE 设备及模式恢复手动 AI 联动；无稳定身份的旧输入组件仍需重新选择。自动批准、会话和待审批不恢复。退出 Studio 后 Runtime 继续处理已启用的功能。
- AhaType 云端整理、云账号、状态驱动硬件灯光、Hook 一键安装／卸载尚未接入。原生真人录音、输入输出、真实工具会话与实体拨杆仍需验收；UI 测试使用模拟数据。

详细契约与验收清单见 [语音与 Hook](../ahakey-runtime-rust/docs/voice-and-hooks.md)。


## 首次启动与 Codex 一键接入（2026-10-30）

首次打开显示「连接键盘 → 语音与权限 → 连接 Codex → 完成」。可以跳过并在底部「新手引导」重新打开；完成页分别显示功能状态，不把跳过当成已授权。

「AI 编程联动」中的「连接 Codex」会先显示范围、事件及上报内容。确认后由原生端合并当前用户的 `CODEX_HOME/hooks.json`（默认 `~/.codex/hooks.json`），备份原内容、保留其他 Hook。组件复制到应用数据目录 `integrations/codex/ahakey-hook`，配置不引用开发构建路径，也不包含认证 token。更新组件后通过「修复接入」更新该固定路径。

安装记录仅用于识别 Studio 自己的条目；移除只删除精确匹配的条目，用户修改过的条目保留。无效 JSON 或符号链接配置会显示错误并保留原文件。安装、修复和移除均不修改 Codex 的权限策略或信任记录。

安装成功显示「配置已安装」，在 Codex CLI `/hooks` 信任当前定义后，开始新会话。只有安装后收到的 Codex 事件才显示「已收到 Codex 事件」，这表示收到过事件，不代表持续探测工具存活。恢复 AI 联动后自动批准始终关闭。

本地调试包支持 Developer ID 证书签名；公开分发仍需带时间戳的发布构建及公证。登录启动尚未实现，电脑重启后打开 Studio 会启动后台。


## macOS 本机签名与权限保持

`npm run tauri` 与原生组件准备脚本共用签名身份：优先读取 `APPLE_SIGNING_IDENTITY`，其次读取仓库根目录的 `signing-identity.local`（单行证书名称，已被 Git 忽略）。两者都未配置时使用临时签名；临时签名的哈希随重建变化，可能导致输入监控等已有授权不再匹配。

使用钥匙串内同一证书签名，并固定 Studio、Runtime、supervisor、input-monitor 和 Hook 的签名标识，避免用编译产物文件名或每次变化的哈希作为组件身份。Studio、Runtime 和 supervisor 作为语音进程的权限责任方也声明 `com.apple.security.device.audio-input`；只给 Speech 子进程声明会被 hardened runtime 拒绝。首次从临时签名切换到证书签名，需要在系统设置重新授权输入监控，并通过语音页面请求麦克风、语音识别权限。自动粘贴还需要辅助功能权限。

本地 `npm run tauri build -- --debug --bundles app` 在组装后签名并执行严格验证，不请求 Apple 时间戳服务；仅用于本机验证。发布构建保留时间戳流程，分发前另行公证。`npm run test:signing` 验证证书选择、组件标识和签名失败处理。

重建前先通过 Studio 停止后台并退出应用；重建后重新打开。覆盖运行中的 bundle 不会自动替换已启动的 Runtime 进程。权限恢复后检查输入状态为 listening、语音权限为 granted，再按住 Voice 说话并松开，确认录音、结束和转写完成事件。

2026-10-30 本机验收：补齐权限责任进程的麦克风 entitlement 后，保持同一证书重签并重启，输入监控与语音识别授权保留；用户允许麦克风后 Voice 绑定自动恢复。真机 F18 按下进入 recording，松开进入 finalizing，随后 completed、转写长度 4、无错误。自动粘贴未在此轮验收。


### 界面规范

所有页面使用系统字体，字号限定为 12、13、16、20px。普通状态用文字呈现，分组使用留白，结构分隔使用 0.5px 细线。仅弹窗保留一层阴影；不使用渐变、背景模糊、装饰眉标或中圆点分隔。下拉框保留原生键盘操作，隐藏箭头；审批方式使用单选项。维护操作和诊断标识按需展开。

`tests/ui/design.spec.ts` 与各功能页的视觉检查覆盖主界面、设备、权限、任务、帮助、语音、AI 联动、新手引导及上传/裁剪弹窗；检查字号、横向溢出，并生成截图供复核。
