# Studio 构建与发布

首版交付 macOS 13+ 的 Apple Silicon、Intel 安装包，包含 Runtime、Hook、输入监听、语音组件和 supervisor。Studio 不依赖单独安装的 Runtime。

## CI

推送 `main` 或提交 Pull Request 时运行 [Studio CI](../.github/workflows/ci.yml)：

- 核对 npm、Cargo、Tauri 版本和固定的 Runtime 提交。
- TypeScript 构建、前端单元测试、Playwright 界面测试、Python 发布脚本测试。
- 两种 macOS 架构的 Rust 测试及模拟 Runtime 通信测试。

Runtime 的仓库和完整提交 SHA 保存在 [runtime-source.json](../runtime-source.json)。更新 Runtime 时显式修改此文件；构建不跟随 Runtime 的 main。

## CD

[Studio Release](../.github/workflows/release.yml) 在推送 `v*` 标签时执行。复用同一完整提交 SHA 在 main 上已通过的 CI；没有成功记录时补跑 CI。两种架构的打包与必要的 CI 并行进行，签名、公证后挂载 DMG 验证所有组件、架构、签名团队、公证票据和 Gatekeeper。发布仍须等待 CI 与打包全部通过，再上传草稿 Release 并公开。

Rust 的依赖下载与 target 目录按工具链、架构、依赖锁文件缓存。debug 与 release 的编译产物不同；首次 release 构建仍需编译对应优化版本，缓存未命中不会跳过检查。

手动运行工作流时：选择分支只构建并保存 Actions Artifacts；选择版本标签则发布该标签。不会移动标签或覆盖已有 Release。

仓库 Actions Secrets：

| 名称 | 内容 |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Developer ID Application 证书及私钥的 `.p12` 文件，Base64 编码 |
| `MACOS_CERTIFICATE_PASSWORD` | `.p12` 导出密码 |
| `APPLE_ID` | 公证账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple App 专用密码 |
| `APPLE_TEAM_ID` | Developer Team ID |

签名身份从导入证书中选择，必须属于上述 Team ID。构建期间使用临时钥匙串，结束时清理。密钥仅进入发布 job，PR 测试不接触发布密钥。

## 发布新版本

1. 同步修改 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的应用版本。
2. 如需更新后台，修改 `runtime-source.json` 的固定 SHA。
3. 将改动提交并推送到 `main`，确认 CI 通过。
4. 在该提交创建并推送标签，例如：

   ```sh
   git tag -a v0.1.0 -m "AhaKey Studio v0.1.0"
   git push origin v0.1.0
   ```

标签必须与应用版本完全一致，且属于 `main` 历史。带 `-rc.1` 等后缀的版本标记为预发布，不占用 latest。

安装包名称为 `AhaKey-Studio-v版本-macos-aarch64.dmg` 和 `AhaKey-Studio-v版本-macos-x86_64.dmg`。打开 DMG 后将应用拖到“应用程序”。当前版本尚未接入应用内自动更新。

首次使用仍需在真机上授予蓝牙、麦克风、语音识别和相关输入权限。CI 使用模拟设备，不执行真实键盘写入。
