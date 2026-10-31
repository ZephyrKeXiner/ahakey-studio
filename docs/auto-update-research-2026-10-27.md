# AhaKey Studio 自动更新调研

日期：2026-10-27。核对基线：Studio `a175f1b`、Runtime `66c9b3b`。本文是实施建议；本次没有接入插件、生成密钥或发布版本。

## 建议方案

采用 Tauri 2 官方 Updater + GitHub Releases 存放更新包 + 分频道静态更新清单。首版自动检查版本，用户点击后下载和安装。Studio、Runtime、语音组件、输入监听组件、Hook 和 supervisor 作为同一个应用版本交付。

检测和安装分开实现：检测只需要版本清单；应用内替换需要发布签名、完整构建产物和后台进程协调。

## 当前项目状态

- `src-tauri/tauri.conf.json`：版本 0.1.0；没有 updater 配置或 `createUpdaterArtifacts`。
- `src-tauri/Cargo.toml`、`package.json`：没有 updater 依赖。`src-tauri/src/lib.rs` 没有插件初始化或检查更新入口。
- Studio 尚无 `.github/workflows` 发布流水线。现有 `.app` 是本地开发包。
- `scripts/prepare-native.py` 将 Runtime、输入 helper、Speech.app、Hook、supervisor 放进应用资源目录；适合整包更新。
- `src-tauri/src/service.rs` 的 `start()` 会复用仍存活的 supervisor；退出 Studio 不会结束 Runtime。仅重新打开 UI 不能保证切到随新包发布的 Runtime。
- `stop()` 持久保存停止意图并等待退出；supervisor 的终止路径有超时强制结束。它是服务管理接口，尚不是“等待工作完成后升级”的协调器。
- Runtime 的 `.github/workflows/release.yml` 与 `scripts/package-runtime.py` 现有安装包只包含 Runtime 和输入 helper，没有 Speech.app 与 ahakey-hook。Studio CI 应固定 Runtime SHA 并自行准备完整组件，不能直接把现有 Runtime 安装包当作完整 Studio 后台载荷。

## 已核实的官方能力

Tauri Updater 支持静态 JSON 和动态更新服务。静态清单包含 SemVer 版本，以及每个平台的下载 URL 与签名内容；清单应填 `.sig` 文件内容，而不是签名文件地址。更新包签名是必需的。下载和安装可分开调用，适合插入 Runtime 协调步骤。[Updater 官方文档](https://v2.tauri.app/plugin/updater/)

macOS 对外分发还需要处理 Developer ID 签名和公证；这是平台分发身份，与 Updater 的更新包签名各司其职。[macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/)

进一步核对固定发布版源码 `updater-v2.14.0`：macOS 安装替换整个 `.app`，没有停止 sidecar、launchd 或 supervisor 的逻辑；下载完成回调先于签名验证，必须等 `download()` 成功返回再进入安装准备。[macOS 安装实现](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.14.0/plugins/updater/src/updater.rs#L1486)、[下载与验签实现](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.14.0/plugins/updater/src/updater.rs#L815)

官方 `tauri-action` 当前正式发布 `action-v1.0.0`，可生成 `latest.json`，相关参数为 `uploadUpdaterJson`；跨仓发行支持 `owner/repo`，但需有目标仓写权限和目标仓存在的 release ref。实施时锁定 Action SHA。[Action 配置](https://github.com/tauri-apps/tauri-action/blob/action-v1.0.0/action.yml)、[发布清单生成器](https://github.com/tauri-apps/tauri-action/blob/action-v1.0.0/src/upload-version-json.ts)

GitHub 的 latest 是整个仓库级别，且排除 prerelease 和 draft。因此测试频道和同仓多产品需要自己的路由，不能仅依赖仓库级 latest。[GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)

以下是实施时新增的配置形状，公钥和 URL 均为占位，不能直接用于发布：

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "替换为更新签名公钥内容",
      "endpoints": ["https://updates.example.com/studio/beta.json"]
    }
  }
}
```

macOS 自动更新资源使用 `.app.tar.gz` 与签名；`.dmg` 留给首次下载安装。第一版可选择兼容项目的 updater 版本并锁定依赖；若采用 2.14 的 `requireSignedVersion`，另行验证 CLI 生成的签名确实绑定版本，不能只添加配置开关。[更新产物](https://v2.tauri.app/plugin/updater/#building)、[版本签名配置](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.14.0/plugins/updater/src/config.rs#L122)

## 用户体验（建议）

1. Studio 启动后延迟检查一次；运行期间每 6 小时检查。这个间隔是产品建议，不是插件默认能力。
2. “关于／设置”中提供“检查更新”，显示当前版本、更新版本、发布说明和最近检查时间。
3. 自动检查失败保持原功能可用；手动检查失败显示原因和重试入口。检查失败不显示成“已是最新版本”。
4. 发现更新后提供“下载并安装”“稍后”“跳过这个版本”。下载显示进度，安装需要用户显式触发。
5. 检查由 Studio 宿主调度。若以后要求完全退出 Studio 后也收到更新提示，再增加独立后台检测职责；不让语音或设备通信承担更新下载任务。

## 本项目的安装流程（建议）

```text
检查版本 → 下载并验签 → 用户确认安装
→ 保存草稿 → Runtime 进入升级准备状态
→ 当前事务结束／明确暂停，录音结束，审批交回工具
→ 停止受管 Runtime、helper 和 supervisor
→ 安装新应用包 → 重启 Studio → 启动配套 Runtime → 核对版本和能力
```

不能只看前端快照“当前空闲”后就停止后台：检查和安装之间仍可能收到按键、Hook 或另一个客户端的写入。应新增 Runtime 升级准备协议（拟定 `runtime.prepareUpdate` / `runtime.cancelUpdate`），在同一状态锁下停止接收新录音、写入和自动审批，再报告可退出；名称和参数尚未实现。

已有 `stopping` 标志只用于退出，不能直接当作可撤销的升级准备状态。旧 Runtime 不支持准备协议时，先提供明确的手动停止流程，不伪造已完成排空。

下载或验签失败不停止 Runtime。停止超时不继续安装。失败恢复应记录升级前服务状态，只恢复本次由更新器停止的受管后台，不能把用户原本关闭的服务打开。成功重启后确认接上的确实是新 Runtime；当前只有版本号不足以区分相同版本的不同构建，建议包内增加 Studio SHA、Runtime SHA、架构和协议版本的构建清单。

连接独立外部 Runtime 时不能按旧 PID 结束它；保留外部所有权，检查协议能力，不兼容时引导从原启动来源升级。更新后语音与 AI 联动按当前产品规则重新启用。

安装入口建议由 Rust 宿主统一封装，前端仅调用检查、下载、请求安装等命令。不要同时向前端开放可绕过 Runtime 协调器的直接安装权限。

## 发布与测试频道（建议）

- 稳定版读取 `stable.json`，测试版读取 `beta.json`。端点可放在 GitHub Pages 或已有 HTTPS 静态托管上；两份清单分别指向 GitHub Releases 的版本化资源。
- 稳定版只发布正式 SemVer，测试版使用例如 `0.1.1-beta.1`。不能只改 Release 标题，应用内版本也要递增。
- 流水线校验 `tauri.conf.json`、Cargo 包版本与 npm 版本一致；Runtime 使用固定 SHA，允许自身版本与 Studio 不同。
- 先构建、签名、公证、上传所有目标架构产物并验证，最后更新频道清单。每次清单更新必须包含频道支持的完整平台集合。
- macOS 首先分别构建 Apple Silicon 和 Intel；每种架构的 Rust 和 Swift helper 必须一致，沿用并扩展现有架构检查。
- 用户切换 beta 到 stable 时不默认强制降级；等待更高正式版，或由单独确认的重装流程处理降级及数据兼容。
- 首版推荐同一安装上的频道切换。若将来同时安装稳定版与测试版，需要进一步划分应用 ID、数据目录、Runtime 所有权与 Hook 路径，单改应用名称不够。

源码仓库和下载仓库可以分离。若继续利用旧 AhaKey desktop 仓库的 Releases，必须给 Studio 单独的频道清单和资源命名，避免旧 macOS 客户端、Runtime 与 Studio 共同竞争一个 latest 地址。

## 实施清单

| 模块 | 需要增加的内容 |
|---|---|
| Studio Rust | updater 插件、状态管理、检查调度、下载进度、受管后台升级协调、失败恢复 |
| Studio React | 更新提示、版本说明、进度、频道与跳过版本设置 |
| Runtime | 可撤销的升级准备状态；新请求准入控制；活动录音、设备任务与审批协调 |
| 构建配置 | 更新产物、公钥、固定 HTTPS 端点；应用与嵌套原生程序签名 |
| 发布 CI | 固定 Runtime 提交、完整组件构建、双架构、测试、签名公证、资源上传、最后发布清单 |
| 发布材料 | updater 私钥的 CI Secret、macOS 证书及公证凭据；不进入仓库或 WebView |

Updater 的安装字节流签名和 macOS 应用签名必须分别配置。首次接入 updater 后，现有没有更新功能的 0.1.0 安装包仍需用户手动安装一次新版，之后才进入自动更新链路。

## 验收范围

- 从真实发布包 N 检查并安装 N+1；支持的两种 macOS 架构分别验证。
- beta 不向稳定频道泄漏；跳过版本、离线、清单缺架构、下载中断和错误签名行为明确。
- 录音中、OLED 上传中、配置写入中和等待审批时请求安装，确认协调完成后才替换。
- 下载失败不影响旧后台；停止或安装失败能恢复原运行意图；退出或重启中断安装后的状态可恢复。
- 外部 Runtime 不被结束；新版 Studio 验证实际运行的 Runtime 构建，而非只看磁盘文件。
- 更新后草稿、任务和偏好保留；现有 Hook 路径仍能调用；语音权限按真实签名安装位置验证。
- 只读挂载的 DMG、应用安装位置不可写等情况，提示移到可更新的位置，不进入反复失败的自动安装循环。

推荐先交付自动检测与提示，再完成发布流水线和协调安装。研究已完成；上述 updater 功能尚未写入应用代码。
