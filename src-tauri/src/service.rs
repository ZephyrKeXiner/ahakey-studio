//! The Studio controls only the session job it created. External Runtime processes are attached, never killed.
use crate::{
    runtime_client::{self, ClientError},
    supervisor::{self, Config, Status},
};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;

#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preferences {
    #[serde(default)]
    input_monitor: bool,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSettings {
    pub enabled: bool,
    pub active: Option<bool>,
    pub available: bool,
    pub editable: bool,
    pub mock: bool,
}

pub struct ManagedService {
    directory: PathBuf,
    discovery: PathBuf,
    runtime: PathBuf,
    supervisor: PathBuf,
    mock: bool,
    label: String,
}
fn failure(message: &str) -> ClientError {
    ClientError::new("SERVICE_ERROR", message)
}
impl ManagedService {
    pub fn new(
        directory: PathBuf,
        discovery: PathBuf,
        runtime: PathBuf,
        supervisor: PathBuf,
        mock: bool,
    ) -> Self {
        let digest = format!(
            "{:x}",
            Sha256::digest(discovery.to_string_lossy().as_bytes())
        );
        Self {
            directory,
            discovery,
            runtime,
            supervisor,
            mock,
            label: format!("ai.ahakey.runtime.{}", &digest[..12]),
        }
    }
    #[cfg(target_os = "macos")]
    fn domain(&self) -> String {
        format!("gui/{}", unsafe { libc::geteuid() })
    }
    #[cfg(target_os = "macos")]
    fn target(&self) -> String {
        format!("{}/{}", self.domain(), self.label)
    }
    fn preferences(&self) -> Result<Preferences, ClientError> {
        let path = self.directory.join("preferences.json");
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| failure("后台偏好文件无效，请检查后重试。")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(Preferences::default())
            }
            Err(_) => Err(failure("无法读取后台偏好。")),
        }
    }
    pub async fn input_settings(&self) -> Result<InputSettings, ClientError> {
        let status = self.status().await?;
        let preferences = self.preferences()?;
        let alive = self.directory.exists()
            && supervisor::supervisor_alive(&self.directory)
                .map_err(|_| failure("无法核对后台管理进程。"))?;
        let active = if alive {
            Some(
                supervisor::load_config(&self.directory.join("config.json"))
                    .map_err(|_| failure("无法读取当前后台启动配置。"))?
                    .input_monitor,
            )
        } else {
            None
        };
        Ok(InputSettings {
            enabled: preferences.input_monitor,
            active,
            available: self
                .runtime
                .with_file_name("ahakey-input-monitor")
                .is_file(),
            editable: status.phase != "external",
            mock: self.mock,
        })
    }
    pub async fn set_input_monitor(&self, enabled: bool) -> Result<InputSettings, ClientError> {
        supervisor::private_directory(&self.directory)
            .map_err(|_| failure("无法访问后台偏好目录。"))?;
        let lock = supervisor::private_file(&self.directory.join("manager.lock"))
            .map_err(|_| failure("无法锁定服务操作。"))?;
        lock.try_lock_exclusive()
            .map_err(|_| failure("另一项后台服务操作正在进行。"))?;
        let current = self.input_settings().await?;
        if !current.editable {
            return Err(ClientError::new(
                "NOT_MANAGED",
                "当前连接的是独立 Runtime，请从它的启动来源调整输入观察。",
            ));
        }
        if enabled && !current.available {
            return Err(ClientError::new(
                "INPUT_HELPER_MISSING",
                "未找到配套输入组件，请安装完整 Studio 或准备原生组件。",
            ));
        }
        supervisor::atomic_json(
            &self.directory.join("preferences.json"),
            &Preferences {
                input_monitor: enabled,
            },
        )
        .map_err(|_| failure("无法保存输入观察设置，本次设置未应用。"))?;
        self.input_settings().await
    }
    pub async fn status(&self) -> Result<Status, ClientError> {
        let mut previous = None;
        if self.directory.exists() {
            supervisor::private_directory(&self.directory)
                .map_err(|_| failure("后台服务目录无法访问。"))?;
            let alive = supervisor::supervisor_alive(&self.directory)
                .map_err(|_| failure("无法核对后台管理进程。"))?;
            if let Ok(mut status) = supervisor::read_status(&self.directory) {
                if alive {
                    return Ok(status);
                }
                if !matches!(status.phase.as_str(), "stopped" | "faulted") {
                    status.phase = "faulted".into();
                    status.child_pid = None;
                    status.message = "后台管理进程已退出，请检查后手动恢复。".into();
                }
                if status.boot_id == supervisor::boot_id() {
                    previous = Some(status);
                }
            }
            if alive {
                return Ok(Status::new("starting", 0, None, "正在启动后台管理进程。"));
            }
        }
        if runtime_client::inspect_path(&self.discovery).await.is_ok() {
            return Ok(Status::new(
                "external",
                0,
                None,
                "已连接独立启动的 Runtime。",
            ));
        }
        Ok(previous.unwrap_or_else(|| Status::new("unmanaged", 0, None, "Runtime 尚未运行。")))
    }
    #[cfg(target_os = "macos")]
    pub async fn start(&self, recover: bool) -> Result<Status, ClientError> {
        supervisor::private_directory(&self.directory)
            .map_err(|_| failure("无法创建私有后台服务目录。"))?;
        let lock = supervisor::private_file(&self.directory.join("manager.lock"))
            .map_err(|_| failure("无法锁定服务操作。"))?;
        lock.try_lock_exclusive()
            .map_err(|_| failure("另一项后台服务操作正在进行。"))?;
        if supervisor::supervisor_alive(&self.directory)
            .map_err(|_| failure("无法核对后台管理进程。"))?
        {
            return self.status().await;
        }
        match runtime_client::inspect_path(&self.discovery).await {
            Ok(_) => {
                return Ok(Status::new(
                    "external",
                    0,
                    None,
                    "已连接独立启动的 Runtime。",
                ));
            }
            Err(error)
                if ["NOT_RUNNING", "UNREACHABLE", "TIMEOUT"].contains(&error.code.as_str()) => {}
            Err(error) => return Err(error),
        }
        if !recover
            && supervisor::read_status(&self.directory)
                .is_ok_and(|s| s.boot_id == supervisor::boot_id() && s.phase != "stopped")
        {
            return Err(ClientError::new(
                "RECOVERY_REQUIRED",
                "上次后台服务异常退出，请手动恢复 Runtime。",
            ));
        }
        let preferences = self.preferences()?;
        if preferences.input_monitor
            && !self
                .runtime
                .with_file_name("ahakey-input-monitor")
                .is_file()
        {
            return Err(ClientError::new(
                "INPUT_HELPER_MISSING",
                "已开启输入观察，但配套组件缺失。请安装完整应用，或在系统与权限中关闭输入观察。",
            ));
        }
        if !self.runtime.is_file() || !self.supervisor.is_file() {
            return Err(ClientError::new(
                "RUNTIME_NOT_PACKAGED",
                "未找到配套 Runtime，请先准备原生组件或安装完整 Studio。",
            ));
        }
        let parent = self
            .discovery
            .parent()
            .ok_or_else(|| failure("Runtime discovery 路径无效。"))?;
        supervisor::private_directory(parent)
            .map_err(|_| failure("Runtime 目录不是当前用户的私有目录。"))?;
        // Probe the Runtime's actual ownership lock; never remove or replace this lock inode.
        let owner = supervisor::private_file(&self.discovery.with_extension("lock"))
            .map_err(|_| failure("无法检查 Runtime 所有权。"))?;
        owner.try_lock_exclusive().map_err(|_| {
            ClientError::new(
                "RUNTIME_OWNER_BUSY",
                "已有 Runtime 持有设备所有权，等待它恢复连接。",
            )
        })?;
        drop(owner);
        if launchctl(&["print", &self.target()]).await?
            && !launchctl(&["bootout", &self.target()]).await?
        {
            return Err(failure("无法移除上次已退出的会话服务。"));
        }
        match std::fs::remove_file(self.directory.join("stop.json")) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(failure("无法更新 Runtime 启动意图。")),
        }
        let config = Config {
            runtime_binary: self.runtime.clone(),
            discovery_path: self.discovery.clone(),
            mock: self.mock,
            input_monitor: preferences.input_monitor,
        };
        let config_path = self.directory.join("config.json");
        supervisor::atomic_json(&config_path, &config)
            .map_err(|_| failure("无法保存 Runtime 服务配置。"))?;
        let plist_path = self.directory.join("session.plist");
        std::fs::write(
            &plist_path,
            session_plist(&self.label, &self.supervisor, &config_path),
        )
        .map_err(|_| failure("无法保存当前会话启动配置。"))?;
        supervisor::atomic_json(
            &self.directory.join("status.json"),
            &Status::new("starting", 0, None, "正在注册当前登录会话的 Runtime。"),
        )
        .map_err(|_| failure("无法保存服务状态。"))?;
        if !launchctl(&[
            "bootstrap",
            &self.domain(),
            plist_path
                .to_str()
                .ok_or_else(|| failure("服务目录编码无效。"))?,
        ])
        .await?
        {
            let _ = supervisor::atomic_json(
                &self.directory.join("status.json"),
                &Status::new("faulted", 0, None, "当前会话服务启动失败。"),
            );
            return Err(failure(
                "launchd 未能启动 Runtime，请检查服务组件路径与权限。",
            ));
        }
        for _ in 0..50 {
            if supervisor::supervisor_alive(&self.directory).unwrap_or(false) {
                return self.status().await;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err(failure("后台管理进程未能启动，请手动恢复。"))
    }
    #[cfg(target_os = "macos")]
    pub async fn stop(&self) -> Result<Status, ClientError> {
        supervisor::private_directory(&self.directory)
            .map_err(|_| failure("后台服务目录无法访问。"))?;
        let lock = supervisor::private_file(&self.directory.join("manager.lock"))
            .map_err(|_| failure("无法锁定服务操作。"))?;
        lock.try_lock_exclusive()
            .map_err(|_| failure("另一项后台服务操作正在进行。"))?;
        let alive = supervisor::supervisor_alive(&self.directory)
            .map_err(|_| failure("无法核对后台管理进程。"))?;
        if !alive {
            return Err(ClientError::new(
                "NOT_MANAGED",
                "这个 Runtime 未由当前后台管理进程持有，请从其启动来源关闭。",
            ));
        }
        // Persist the no-restart intent before requesting any child shutdown.
        supervisor::request_stop(&self.directory)
            .map_err(|_| failure("无法保存关闭意图，本次尚未关闭 Runtime。"))?;
        for _ in 0..450 {
            if !supervisor::supervisor_alive(&self.directory)
                .map_err(|_| failure("无法核对关闭状态。"))?
            {
                if launchctl(&["print", &self.target()]).await?
                    && !launchctl(&["bootout", &self.target()]).await?
                {
                    return Err(failure("Runtime 已结束，会话注册项尚未移除。"));
                }
                return self.status().await;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err(failure(
            "Runtime 正在结束事务，关闭意图已保存，请稍后核对。",
        ))
    }
    #[cfg(not(target_os = "macos"))]
    pub async fn start(&self, _recover: bool) -> Result<Status, ClientError> {
        Err(failure("当前后台管理仅支持 macOS。"))
    }
    #[cfg(not(target_os = "macos"))]
    pub async fn stop(&self) -> Result<Status, ClientError> {
        Err(failure("当前后台管理仅支持 macOS。"))
    }
}
#[cfg(target_os = "macos")]
async fn launchctl(args: &[&str]) -> Result<bool, ClientError> {
    let mut command = Command::new("/bin/launchctl");
    command.args(args).kill_on_drop(true);
    let result = tokio::time::timeout(Duration::from_secs(10), command.output())
        .await
        .map_err(|_| failure("launchd 操作超时，请重新核对服务状态。"))?
        .map_err(|_| failure("无法执行 launchctl。"))?;
    Ok(result.status.success())
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
pub fn session_plist(label: &str, binary: &Path, config: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>{}</string><key>ProgramArguments</key><array><string>{}</string><string>--config</string><string>{}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>ExitTimeOut</key><integer>45</integer><key>ProcessType</key><string>Background</string></dict></plist>"#,
        xml(label),
        xml(&binary.to_string_lossy()),
        xml(&config.to_string_lossy())
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_job_is_one_shot_and_escapes_paths() {
        let text = session_plist(
            "test",
            "/tmp/A&B/helper".as_ref(),
            "/tmp/A&B/config".as_ref(),
        );
        assert!(text.contains("A&amp;B"));
        assert!(text.contains("<key>KeepAlive</key><false/>"));
        assert!(!text.contains("SuccessfulExit"));
        assert!(!text.contains("LaunchAgents"));
    }
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn same_boot_fault_requires_recovery_but_old_boot_does_not() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("service");
        supervisor::private_directory(&directory).unwrap();
        let service = ManagedService::new(
            directory.clone(),
            root.path().join("runtime/discovery.json"),
            root.path().join("missing-runtime"),
            root.path().join("missing-supervisor"),
            true,
        );
        let mut status = Status::new("faulted", 3, None, "failed");
        supervisor::atomic_json(&directory.join("status.json"), &status).unwrap();
        assert_eq!(
            service.start(false).await.unwrap_err().code,
            "RECOVERY_REQUIRED"
        );
        status.boot_id = "previous-boot".into();
        supervisor::atomic_json(&directory.join("status.json"), &status).unwrap();
        assert_eq!(
            service.start(false).await.unwrap_err().code,
            "RUNTIME_NOT_PACKAGED"
        );
    }
    #[tokio::test]
    async fn input_preferences_require_helper_and_preserve_existing_choice_on_failure() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("service");
        let runtime = root.path().join("runtime-binary");
        let service = ManagedService::new(
            directory.clone(),
            root.path().join("runtime/discovery.json"),
            runtime.clone(),
            root.path().join("supervisor"),
            true,
        );
        assert!(!service.input_settings().await.unwrap().enabled);
        assert_eq!(
            service.set_input_monitor(true).await.unwrap_err().code,
            "INPUT_HELPER_MISSING"
        );
        assert!(!directory.join("preferences.json").exists());
        std::fs::write(
            runtime.with_file_name("ahakey-input-monitor"),
            b"test helper",
        )
        .unwrap();
        let saved = service.set_input_monitor(true).await.unwrap();
        assert!(saved.enabled);
        assert_eq!(saved.active, None);
        assert!(!directory.join("config.json").exists());
        let lock = supervisor::private_file(&directory.join("manager.lock")).unwrap();
        lock.lock_exclusive().unwrap();
        assert!(service.set_input_monitor(false).await.is_err());
        assert!(service.preferences().unwrap().input_monitor);
        drop(lock);
        service.set_input_monitor(false).await.unwrap();
        assert!(!service.preferences().unwrap().input_monitor);
        std::fs::write(directory.join("preferences.json"), b"invalid").unwrap();
        assert!(service.set_input_monitor(true).await.is_err());
        assert_eq!(
            std::fs::read(directory.join("preferences.json")).unwrap(),
            b"invalid"
        );
    }
}
