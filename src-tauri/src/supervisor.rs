//! Session-scoped Runtime owner. launchd starts this supervisor once; it owns the retry budget.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    process::{Child, Command},
    time::Instant,
};

pub const MAX_RESTARTS: u32 = 3;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub runtime_binary: PathBuf,
    pub discovery_path: PathBuf,
    pub mock: bool,
    #[serde(default)]
    pub input_monitor: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(default)]
    pub boot_id: String,
    pub phase: String,
    pub restarts: u32,
    pub child_pid: Option<u32>,
    pub updated_at_ms: u64,
    pub message: String,
}
impl Status {
    pub fn new(phase: &str, restarts: u32, pid: Option<u32>, message: &str) -> Self {
        Self {
            boot_id: boot_id(),
            phase: phase.into(),
            restarts,
            child_pid: pid,
            updated_at_ms: now_ms(),
            message: message.into(),
        }
    }
}
pub fn boot_id() -> String {
    #[cfg(target_os = "macos")]
    {
        let mut value: libc::timeval = unsafe { std::mem::zeroed() };
        let mut length = std::mem::size_of::<libc::timeval>();
        let result = unsafe {
            libc::sysctlbyname(
                c"kern.boottime".as_ptr(),
                (&mut value as *mut libc::timeval).cast(),
                &mut length,
                std::ptr::null_mut(),
                0,
            )
        };
        if result == 0 {
            return format!("{}-{}", value.tv_sec, value.tv_usec);
        }
    }
    "unknown".into()
}
#[cfg(not(unix))]
pub async fn run(_config_path: PathBuf) -> io::Result<()> {
    Err(io::Error::other(
        "background supervision is currently available on macOS",
    ))
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn private_directory(path: &Path) -> io::Result<()> {
    if !path.exists() {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(path)?;
    }
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() {
        return Err(io::Error::other("service directory must not be a symlink"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if meta.permissions().mode() & 0o077 != 0 || meta.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::other(
                "service directory must be private and owned by this user",
            ));
        }
    }
    Ok(())
}
pub fn private_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}
pub fn atomic_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("missing parent"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(&mut temporary, value)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|e| e.error)?;
    File::open(parent)?.sync_all()?;
    Ok(())
}
pub fn load_config(path: &Path) -> io::Result<Config> {
    private_directory(
        path.parent()
            .ok_or_else(|| io::Error::other("missing service directory"))?,
    )?;
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() || meta.len() > 16384 {
        return Err(io::Error::other("invalid service configuration"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if meta.permissions().mode() & 0o077 != 0 || meta.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::other("configuration must be private"));
        }
    }
    let config: Config = serde_json::from_slice(&fs::read(path)?)?;
    if !config.runtime_binary.is_absolute()
        || !config.discovery_path.is_absolute()
        || !config.runtime_binary.is_file()
    {
        return Err(io::Error::other(
            "absolute Runtime and discovery paths are required",
        ));
    }
    Ok(config)
}
pub fn read_status(directory: &Path) -> io::Result<Status> {
    Ok(serde_json::from_slice(&fs::read(
        directory.join("status.json"),
    )?)?)
}
pub fn supervisor_alive(directory: &Path) -> io::Result<bool> {
    let lock = private_file(&directory.join("supervisor.lock"))?;
    match lock.try_lock_exclusive() {
        Ok(()) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(true),
        Err(error) => Err(error),
    }
}
pub fn request_stop(directory: &Path) -> io::Result<()> {
    atomic_json(
        &directory.join("stop.json"),
        &serde_json::json!({"requestedAtMs":now_ms()}),
    )
}
pub fn backoff(restarts: u32) -> Duration {
    Duration::from_secs(1 << restarts.saturating_sub(1).min(3))
}
fn publish(directory: &Path, status: &Status) -> io::Result<()> {
    atomic_json(&directory.join("status.json"), status)
}

#[cfg(unix)]
async fn terminate(child: &mut Child) -> io::Result<()> {
    if let Some(pid) = child.id() {
        // This PID comes from our still-owned, unreaped Child, never from a persisted status file.
        let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
        if result != 0 && io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
            return Err(io::Error::last_os_error());
        }
    }
    match tokio::time::timeout(Duration::from_secs(40), child.wait()).await {
        Ok(result) => {
            result?;
        }
        Err(_) => {
            child.kill().await?;
            child.wait().await?;
        }
    }
    Ok(())
}
#[cfg(not(unix))]
async fn terminate(child: &mut Child) -> io::Result<()> {
    child.kill().await?;
    child.wait().await?;
    Ok(())
}

#[cfg(unix)]
pub async fn run(config_path: PathBuf) -> io::Result<()> {
    let config = load_config(&config_path)?;
    let directory = config_path.parent().unwrap();
    let lock = private_file(&directory.join("supervisor.lock"))?;
    lock.try_lock_exclusive()?;
    #[cfg(unix)]
    let mut signal = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut restarts = 0;
    loop {
        if directory.join("stop.json").exists() {
            publish(
                directory,
                &Status::new("stopped", restarts, None, "Runtime 已关闭。"),
            )?;
            return Ok(());
        }
        publish(
            directory,
            &Status::new("starting", restarts, None, "正在启动 Runtime。"),
        )?;
        let log_path = directory.join("runtime.log");
        if fs::metadata(&log_path).is_ok_and(|m| m.len() > 1024 * 1024) {
            fs::rename(&log_path, directory.join("runtime.previous.log"))?;
        }
        let mut log = private_file(&log_path)?;
        std::io::Seek::seek(&mut log, std::io::SeekFrom::End(0))?;
        let mut command = Command::new(&config.runtime_binary);
        command
            .arg("--discovery")
            .arg(&config.discovery_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log)
            .kill_on_drop(true);
        if config.mock {
            command.arg("--mock");
        }
        if config.input_monitor {
            command.arg("--input-monitor");
        }
        // Explicit discovery overrides inherited overrides; no --parent-stdin in the background owner.
        command.env_remove("AHAKEY_RUNTIME_DISCOVERY");
        let spawned = command.spawn();
        let outcome = match spawned {
            Ok(mut child) => {
                publish(
                    directory,
                    &Status::new(
                        "running",
                        restarts,
                        child.id(),
                        "Runtime 后台进程正在运行。",
                    ),
                )?;
                loop {
                    tokio::select! {
                        exit=child.wait()=>break exit.map(|status|status.success()),
                        _=tokio::time::sleep(Duration::from_millis(200))=>{
                            if directory.join("stop.json").exists(){
                                publish(directory,&Status::new("stopping",restarts,child.id(),"正在结束 Runtime 事务。"))?;
                                terminate(&mut child).await?;
                                publish(directory,&Status::new("stopped",restarts,None,"Runtime 已关闭。"))?;
                                return Ok(());
                            }
                        }
                        _=signal.recv()=>{
                            request_stop(directory)?;
                            publish(directory,&Status::new("stopping",restarts,child.id(),"正在结束登录会话。"))?;
                            terminate(&mut child).await?;
                            publish(directory,&Status::new("stopped",restarts,None,"Runtime 已关闭。"))?;
                            return Ok(());
                        }
                    }
                }
            }
            Err(error) => Err(error),
        };
        if directory.join("stop.json").exists() || matches!(outcome, Ok(true)) {
            publish(
                directory,
                &Status::new("stopped", restarts, None, "Runtime 已正常退出。"),
            )?;
            return Ok(());
        }
        if restarts >= MAX_RESTARTS {
            publish(
                directory,
                &Status::new(
                    "faulted",
                    restarts,
                    None,
                    "Runtime 连续退出，自动恢复已停止。请检查后手动恢复。",
                ),
            )?;
            return Ok(());
        }
        restarts += 1;
        publish(
            directory,
            &Status::new(
                "backoff",
                restarts,
                None,
                "Runtime 意外退出，正在等待自动恢复。",
            ),
        )?;
        let deadline = Instant::now() + backoff(restarts);
        while Instant::now() < deadline {
            if directory.join("stop.json").exists() {
                break;
            }
            tokio::select! {
                _=tokio::time::sleep(Duration::from_millis(100))=>{},
                _=signal.recv()=>{request_stop(directory)?;break;}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_backoff() {
        assert_eq!(backoff(1).as_secs(), 1);
        assert_eq!(backoff(2).as_secs(), 2);
        assert_eq!(backoff(3).as_secs(), 4);
        assert_eq!(MAX_RESTARTS, 3);
    }
    #[test]
    fn locks_prove_liveness_not_old_status() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!supervisor_alive(dir.path()).unwrap());
        let lock = private_file(&dir.path().join("supervisor.lock")).unwrap();
        lock.lock_exclusive().unwrap();
        assert!(supervisor_alive(dir.path()).unwrap());
        drop(lock);
        assert!(!supervisor_alive(dir.path()).unwrap());
    }
    #[test]
    fn stop_intent_survives_status_updates() {
        let dir = tempfile::tempdir().unwrap();
        request_stop(dir.path()).unwrap();
        publish(dir.path(), &Status::new("running", 0, Some(123), "running")).unwrap();
        assert!(dir.path().join("stop.json").exists());
        assert!(!supervisor_alive(dir.path()).unwrap());
    }
    #[test]
    fn older_service_configuration_keeps_input_observation_disabled() {
        let config: Config = serde_json::from_value(serde_json::json!({"runtimeBinary":"/tmp/runtime", "discoveryPath":"/tmp/discovery.json", "mock":true})).unwrap();
        assert!(!config.input_monitor);
    }
}
