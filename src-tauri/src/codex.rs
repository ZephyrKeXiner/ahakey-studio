//! User-scoped Codex integration. Own exact hook entries, never Codex's trust database.
use crate::runtime_client::ClientError;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

const EVENTS: [&str; 7] = [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
];
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Status,
    Install,
    Remove,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    pub needs_repair: bool,
    pub config_path: String,
    pub detected: bool,
    pub installed_at_ms: u64,
}
pub struct Integration {
    pub home: PathBuf,
    pub directory: PathBuf,
    pub source: PathBuf,
    pub discovery: PathBuf,
}
fn error(message: &str) -> ClientError {
    ClientError::new("CODEX_INTEGRATION_ERROR", message)
}
fn read(path: &Path) -> Result<Option<Vec<u8>>, ClientError> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(error("配置文件是符号链接，请在 Codex 中管理此配置。"));
    }
    match fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(error("无法读取 Codex 接入配置。")),
    }
}
fn parse(bytes: Option<&[u8]>) -> Result<Value, ClientError> {
    let value: Value = match bytes {
        Some(b) => {
            serde_json::from_slice(b).map_err(|_| error("现有配置不是有效 JSON，已保留原文件。"))?
        }
        None => json!({}),
    };
    if !value.is_object()
        || value.get("hooks").is_some_and(|h| {
            !h.is_object() || h.as_object().unwrap().values().any(|v| !v.is_array())
        })
    {
        return Err(error("现有 Hook 配置格式不兼容，已保留原文件。"));
    }
    Ok(value)
}
fn atomic(path: &Path, bytes: &[u8], executable: bool) -> Result<(), ClientError> {
    use std::io::Write;
    fs::create_dir_all(path.parent().unwrap()).map_err(|_| error("无法创建接入目录。"))?;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap())
        .map_err(|_| error("无法准备配置文件。"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(fs::Permissions::from_mode(if executable {
                0o700
            } else {
                0o600
            }))
            .map_err(|_| error("无法设置配置权限。"))?;
    }
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| error("无法保存接入配置。"))?;
    temp.persist(path)
        .map_err(|_| error("无法替换接入配置。"))?;
    Ok(())
}
fn quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}
impl Integration {
    fn config(&self) -> PathBuf {
        self.home.join("hooks.json")
    }
    fn record(&self) -> PathBuf {
        self.directory.join("installed.json")
    }
    fn binary(&self) -> PathBuf {
        self.directory.join("ahakey-hook")
    }
    fn definition(&self) -> Value {
        let mut hooks = serde_json::Map::new();
        for event in EVENTS {
            hooks.insert(event.into(), json!([{"hooks":[{"type":"command","command":format!("{} --tool codex --discovery {} --event {event}",quote(&self.binary()),quote(&self.discovery)),"timeout":if event=="SessionEnd" {3} else {70}}]}]));
        }
        json!({"hooks":hooks})
    }
    pub fn run(&self, action: Action) -> Result<Status, ClientError> {
        if matches!(action, Action::Status) {
            return self.status();
        }
        fs::create_dir_all(&self.directory).map_err(|_| error("无法创建接入目录。"))?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.directory.join("install.lock"))
            .map_err(|_| error("无法锁定接入配置。"))?;
        lock.try_lock_exclusive()
            .map_err(|_| error("接入配置正在更新，请稍后重试。"))?;
        let original = read(&self.config())?;
        let mut config = parse(original.as_deref())?;
        let previous = parse(read(&self.record())?.as_deref())?;
        let expected = self.definition();
        // Persisting ownership before the config makes interrupted installs repairable.
        // Only exact entries are removed; independently edited entries remain user-owned.
        if matches!(action, Action::Install)
            && let Some(events) = config.get("hooks").and_then(Value::as_object)
        {
            for (event, groups) in events {
                for group in groups.as_array().unwrap() {
                    let ours = group
                        .get("hooks")
                        .and_then(Value::as_array)
                        .is_some_and(|hooks| {
                            hooks.iter().any(|h| {
                                h.get("command")
                                    .and_then(Value::as_str)
                                    .is_some_and(|cmd| cmd.starts_with(&quote(&self.binary())))
                            })
                        });
                    let known = [&previous, &expected].iter().any(|owned| {
                        owned
                            .get("hooks")
                            .and_then(|h| h.get(event))
                            .and_then(Value::as_array)
                            .is_some_and(|g| g.contains(group))
                    });
                    if ours && !known {
                        return Err(error(
                            "AhaKey Hook 已被手动修改，已保留原内容。请先在 Codex 中核对该条目，再修复接入。",
                        ));
                    }
                }
            }
        }
        let definitions = if matches!(action, Action::Install) {
            vec![&previous, &expected]
        } else {
            vec![&previous]
        };
        for owned in definitions {
            if let Some(events) = owned.get("hooks").and_then(Value::as_object) {
                for (event, groups) in events {
                    if let Some(existing) = config
                        .get_mut("hooks")
                        .and_then(|h| h.get_mut(event))
                        .and_then(Value::as_array_mut)
                    {
                        existing.retain(|g| !groups.as_array().unwrap().contains(g));
                    }
                }
            }
        }
        if matches!(action, Action::Install) {
            let source =
                fs::read(&self.source).map_err(|_| error("未找到随 Studio 安装的 Hook 组件。"))?;
            atomic(&self.binary(), &source, true)?;
            let hooks = config
                .as_object_mut()
                .unwrap()
                .entry("hooks")
                .or_insert(json!({}))
                .as_object_mut()
                .unwrap();
            for (event, groups) in expected["hooks"].as_object().unwrap() {
                hooks
                    .entry(event.clone())
                    .or_insert(json!([]))
                    .as_array_mut()
                    .unwrap()
                    .extend(groups.as_array().unwrap().clone());
            }
            atomic(
                &self.record(),
                &serde_json::to_vec_pretty(&expected).unwrap(),
                false,
            )?;
        }
        if let Some(events) = config.get_mut("hooks").and_then(Value::as_object_mut) {
            events.retain(|event, v| {
                !EVENTS.contains(&event.as_str()) || !v.as_array().unwrap().is_empty()
            });
        }
        if read(&self.config())? != original {
            return Err(error("Codex 配置已被其他程序修改，请重新连接。"));
        }
        if let Some(bytes) = original.as_ref() {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            atomic(
                &self.directory.join(format!("hooks-backup-{stamp}.json")),
                bytes,
                false,
            )?;
        }
        // Removing a nonexistent integration must not create a global config file.
        if original.is_some() || matches!(action, Action::Install) {
            atomic(
                &self.config(),
                &serde_json::to_vec_pretty(&config).unwrap(),
                false,
            )?;
        }
        if matches!(action, Action::Remove) {
            // Keep the binary: a hook already running may still reference it.
            match fs::remove_file(self.record()) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err(error("已移除 Hook，无法清理接入记录。")),
            }
        }
        self.status()
    }
    fn status(&self) -> Result<Status, ClientError> {
        let config = parse(read(&self.config())?.as_deref())?;
        let record = read(&self.record())?;
        let owned = parse(record.as_deref())?;
        let complete = owned
            .get("hooks")
            .and_then(Value::as_object)
            .is_some_and(|events| {
                !events.is_empty()
                    && events.iter().all(|(event, groups)| {
                        groups.as_array().unwrap().iter().all(|g| {
                            config
                                .get("hooks")
                                .and_then(|h| h.get(event))
                                .and_then(Value::as_array)
                                .is_some_and(|a| a.contains(g))
                        })
                    })
            });
        let binary = read(&self.binary())?;
        let outdated = binary
            .as_ref()
            .is_some_and(|b| fs::read(&self.source).is_ok_and(|source| source != *b));
        let installed_at_ms = fs::metadata(self.record())
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|t| t.as_millis() as u64)
            .unwrap_or(0);
        Ok(Status {
            installed_at_ms,
            installed: complete && binary.is_some(),
            needs_repair: record.is_some()
                && (!complete || binary.is_none() || outdated || owned != self.definition()),
            config_path: self.config().to_string_lossy().into(),
            detected: self.home.join("config.toml").exists()
                || self.home.join("auth.json").exists(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup(dir: &Path) -> Integration {
        let source = dir.join("bundle-hook");
        fs::write(&source, b"test binary").unwrap();
        Integration {
            home: dir.join("codex"),
            directory: dir.join("integration"),
            source,
            discovery: dir.join("runtime/discovery.json"),
        }
    }
    #[test]
    fn install_repair_remove_preserve_other_hooks_and_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let i = setup(dir.path());
        let user = json!({"description":"my config","hooks":{"Stop":[{"hooks":[{"type":"command","command":"my-hook"}]}]}});
        atomic(&i.config(), &serde_json::to_vec(&user).unwrap(), false).unwrap();
        assert!(i.run(Action::Install).unwrap().installed);
        i.run(Action::Install).unwrap();
        let config = parse(read(&i.config()).unwrap().as_deref()).unwrap();
        assert_eq!(config["hooks"]["Stop"].as_array().unwrap().len(), 2);
        fs::write(&i.source, b"updated binary").unwrap();
        assert!(i.run(Action::Status).unwrap().needs_repair);
        assert!(!i.run(Action::Install).unwrap().needs_repair);
        assert!(!i.run(Action::Remove).unwrap().installed);
        assert_eq!(parse(read(&i.config()).unwrap().as_deref()).unwrap(), user);
    }
    #[test]
    fn malformed_configs_and_edited_entries_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let i = setup(dir.path());
        atomic(&i.config(), b"not json", false).unwrap();
        assert!(i.run(Action::Install).is_err());
        assert_eq!(fs::read(i.config()).unwrap(), b"not json");
        fs::remove_file(i.config()).unwrap();
        i.run(Action::Install).unwrap();
        let mut config = parse(read(&i.config()).unwrap().as_deref()).unwrap();
        config["hooks"]["Stop"][0]["hooks"][0]["command"] = json!("user-edited-hook");
        atomic(&i.config(), &serde_json::to_vec(&config).unwrap(), false).unwrap();
        assert!(i.run(Action::Status).unwrap().needs_repair);
        i.run(Action::Remove).unwrap();
        assert_eq!(
            parse(read(&i.config()).unwrap().as_deref()).unwrap()["hooks"]["Stop"][0]["hooks"][0]["command"],
            "user-edited-hook"
        );
    }
    #[test]
    fn status_and_remove_do_not_create_global_config() {
        let dir = tempfile::tempdir().unwrap();
        let i = setup(dir.path());
        assert!(!i.run(Action::Status).unwrap().installed);
        assert!(!i.home.exists());
        i.run(Action::Remove).unwrap();
        assert!(!i.config().exists());
    }
}
