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
- 键位编辑：四个模式、四个物理键，快捷键、修饰键和宏。读取后确认同步，未知键位保持未知；同步前保留最近五份草稿。
- 独立改键：写入前重新获取 baseToken，确认指定键的动作差异，只提交改动键。写入期间继续编辑时，旧任务完成不会清除新草稿。
- 亮度与描述：独立修改全局亮度与四个模式的按键描述；先确认同步，未知项保持未知，历史草稿可恢复。提交时冻结明确修改的字段，旧任务完成不清除新编辑；任务和草稿随其他配置一起持久保存。
- OLED：PNG/JPEG/GIF 本地预览、原生 SHA-256 与逐块确认传输、19 个目标位置、帧数限制、上传确认、进度、暂停及继续。静态图片支持缩放、移动并确认裁剪为 160×80 PNG；最大 2 MiB。GIF 保留原帧数，须为 160×80、100ms/帧、无限循环。上传后显示进度弹窗，可暂停并核对键盘控制恢复，也可返回编辑让任务继续。
- 系统与权限：展示 Runtime 原生输入组件上报的授权和运行状态，支持打开 macOS 蓝牙、输入监控设置。断开连接后状态显示未知；打开设置不会自行标记已授权。应用包包含蓝牙用途声明。
- 任务恢复：提交前持久保存原任务 ID、请求及素材引用；重连和重新打开后查询原任务。连接失败不会自动重发设备写入。
- 本地草稿和任务记录保存在桌面 WebView 的 localStorage。OLED 已准备素材保存在 Runtime 资源目录；重开 Studio 可继续使用素材引用，本地原图预览需重新选择文件。

macOS 已接入会话级后台管理：打开 Studio 时附着已有 Runtime，未运行时启动随包提供的 Runtime。退出 Studio 后继续运行；界面主动关闭时先持久保存停止意图，再结束 Runtime，当前 Studio 不自动重启它。下次打开 Studio 可重新启动。

后台使用当前 GUI 会话的 launchd job 与独立 supervisor。Runtime 异常退出后以 1、2、4 秒退避，最多自动重启三次；预算用尽后需手动恢复。预算属于本次开机，重启后不会沿用旧故障预算。plist 放在应用数据目录的 `runtime-session` 中，不安装到 `~/Library/LaunchAgents`，电脑重启后不会因登录扫描而自启。

Studio 直接通过 discovery 和认证 WebSocket 对接 Rust Runtime。已运行的外部 Runtime 只附着，不按保存的 PID 关闭；未运行时启动随包 Runtime。启动检查以 Runtime 自身的所有权锁为准。系统语音与 Hook 仍在后续范围。

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

本地开发包位于 `src-tauri/target/debug/bundle/macos/AhaKey Studio.app`，尚未配置 Developer ID 签名与公证。

原生通信层已接入新增的 `configuration.patch`，支持独立亮度和指定键描述，联调覆盖原任务恢复及其他键位、灯效、OLED 不变。“亮度与描述”编辑页通过该接口提交修改。此方法依赖相邻 Runtime 仓库本次增量；旧 Runtime 不支持时不可退回整组覆盖写入。契约见 [字段级接口](../ahakey-runtime-rust/docs/configuration-patch-api.md)。

## 后续实现

1. 更完整的素材编辑与动图制作。
2. 继续补齐灯效字段补丁和真机故障恢复验收；键位、亮度与描述补丁、显式完整读回及按字段暂停/核验/续写已接入。
3. macOS 后台语音、权限引导、原生反馈窗口和 Hook。
4. 保留配置的固件升级、性能稳定性验收及签名分发。

2026-10-23 范围更新：按用户决定，旧 macOS Agent 的兼容、迁移、接管与回退不在本项目范围内。Studio 只对接 Rust Runtime。

产品依据：[macOS Runtime 集成决策](https://github.com/AhakeyAI/desktop/blob/runtime/docs/macos-runtime-integration-decisions.md)。Runtime API：[接口参考](https://github.com/AhakeyAI/ahakey-runtime-rust/blob/main/docs/websocket-api.md)、[OLED 上传](https://github.com/AhakeyAI/ahakey-runtime-rust/blob/main/docs/oled-api.md)。

Apache-2.0，见 [LICENSE](LICENSE)。

### 显式设备读回

键位和亮度/描述页面新增“从设备完整读取”，调用配套 Runtime 的 `configuration.read`。这是异步设备任务；原有缓存刷新改名为“刷新已知键位/设置”。读取最多三次，界面显示当前尝试和失败原因，支持手动重试。读取期间写入与同步禁用，本地编辑继续；读取完成不会自动替换草稿。

读取进度通过 `configuration.get` 的 `read` 与配置事件恢复。刷新或退出 Studio 不取消 Runtime 的读取；Runtime 重启后重新建立基线。完整读回覆盖四模式键位/描述/灯效和亮度，无法表示的字段保持未知。配套 Runtime 必须包含 `configuration.read` 扩展，旧版本会禁用入口。MockX1 没有硬件读回，明确显示“不支持”；成功路径由真实 X1 读回协议捕获数据和 WebSocket 测试覆盖，仍待真机验收。

### 配置任务暂停与续写

任务记录中，支持字段事务的配置任务提供“暂停配置写入”和“核验并继续配置”。暂停完成当前字段（键位的清除/设置帧一起完成），继续使用原任务 ID，先读取设备并跳过已一致项目。新编辑的草稿不加入旧任务；外部修改冲突或字段不可读取时保留暂停并提示处理。

进度分别显示字段 ACK、读回核验和保存命令 ACK。Runtime 重启后保留暂停任务，不自动重发。没有读回能力的固件与 Mock 不伪造验证结果；首次写入可显示 ACK 完成，续写需可用的读回。真机断电保持及设备输入恢复仍需验证。协议细节见相邻 Runtime 的 `docs/configuration-transactions.md`。
