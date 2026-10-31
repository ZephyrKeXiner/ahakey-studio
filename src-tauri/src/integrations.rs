//! User-scoped developer tool hooks. Preserve unrelated configuration and exact ownership.
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
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Codex,
    Claude,
    Cursor,
    Kimi,
}
impl Tool {
    pub fn id(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Cursor => "cursor",
            Self::Kimi => "kimi",
        }
    }
    pub fn folder(self) -> &'static str {
        match self {
            Self::Codex => ".codex",
            Self::Claude => ".claude",
            Self::Cursor => ".cursor",
            Self::Kimi => ".kimi-code",
        }
    }
    fn events(self) -> &'static [&'static str] {
        match self {
            Self::Cursor => &[
                "sessionStart",
                "sessionEnd",
                "beforeSubmitPrompt",
                "postToolUse",
                "postToolUseFailure",
                "beforeShellExecution",
                "beforeMCPExecution",
                "stop",
            ],
            Self::Kimi => &[
                "SessionStart",
                "SessionEnd",
                "UserPromptSubmit",
                "PreToolUse",
                "PostToolUse",
                "PostToolUseFailure",
                "PermissionRequest",
                "PermissionResult",
                "Stop",
                "Interrupt",
            ],
            _ => &EVENTS,
        }
    }
}
pub struct Integration {
    pub tool: Tool,
    pub home: PathBuf,
    pub directory: PathBuf,
    pub source: PathBuf,
    pub discovery: PathBuf,
}
fn error(message: &str) -> ClientError {
    ClientError::new("TOOL_INTEGRATION_ERROR", message)
}
fn read(path: &Path) -> Result<Option<Vec<u8>>, ClientError> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(error("配置文件是符号链接，请在开发工具中管理此配置。"));
    }
    match fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(error("无法读取接入配置。")),
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
    fn toml(bytes: Option<&[u8]>) -> Result<toml_edit::DocumentMut, ClientError> {
        std::str::from_utf8(bytes.unwrap_or_default())
            .map_err(|_| error("Kimi 配置不是 UTF-8 文本。"))?
            .parse()
            .map_err(|_| error("现有配置不是有效 TOML，已保留原文件。"))
    }
    fn table_value(table: &toml_edit::Table) -> Result<Value, ClientError> {
        toml_edit::de::from_str(&table.to_string()).map_err(|_| error("Kimi Hook 配置格式不兼容。"))
    }
    fn parse_config(&self, bytes: Option<&[u8]>) -> Result<Value, ClientError> {
        if self.tool != Tool::Kimi {
            return parse(bytes);
        }
        let doc = Self::toml(bytes)?;
        let mut hooks = serde_json::Map::new();
        if let Some(item) = doc.get("hooks") {
            if item.as_array().is_some_and(|a| a.is_empty()) {
                return Ok(json!({"hooks":hooks}));
            }
            let tables = item
                .as_array_of_tables()
                .ok_or_else(|| error("Kimi hooks 必须使用 [[hooks]] 格式。"))?;
            for table in tables {
                let entry = Self::table_value(table)?;
                let event = entry["event"]
                    .as_str()
                    .ok_or_else(|| error("Kimi Hook 缺少 event。"))?;
                hooks
                    .entry(event.to_owned())
                    .or_insert(json!([]))
                    .as_array_mut()
                    .unwrap()
                    .push(entry);
            }
        }
        Ok(json!({"hooks":hooks}))
    }
    fn render_config(
        &self,
        original: Option<&[u8]>,
        config: &Value,
    ) -> Result<Vec<u8>, ClientError> {
        if self.tool != Tool::Kimi {
            return Ok(serde_json::to_vec_pretty(config).unwrap());
        }
        let mut doc = Self::toml(original)?;
        let mut remaining: Vec<Value> = config["hooks"]
            .as_object()
            .unwrap()
            .values()
            .flat_map(|groups| groups.as_array().unwrap().iter().cloned())
            .collect();
        let mut tables = toml_edit::ArrayOfTables::new();
        // Reuse existing tables verbatim, including comments and ordering.
        if let Some(existing) = doc.get("hooks").and_then(|i| i.as_array_of_tables()) {
            for table in existing {
                let entry = Self::table_value(table)?;
                if let Some(index) = remaining.iter().position(|v| v == &entry) {
                    tables.push(table.clone());
                    remaining.remove(index);
                }
            }
        }
        for entry in remaining {
            let mut table = toml_edit::Table::new();
            for field in ["event", "command"] {
                table[field] = toml_edit::value(entry[field].as_str().unwrap());
            }
            table["timeout"] = toml_edit::value(entry["timeout"].as_i64().unwrap());
            tables.push(table);
        }
        if tables.is_empty() {
            doc.remove("hooks");
        } else {
            doc["hooks"] = toml_edit::Item::ArrayOfTables(tables);
        }
        Ok(doc.to_string().into_bytes())
    }
    fn config(&self) -> PathBuf {
        self.home.join(match self.tool {
            Tool::Claude => "settings.json",
            Tool::Kimi => "config.toml",
            _ => "hooks.json",
        })
    }
    fn record(&self) -> PathBuf {
        self.directory.join("installed.json")
    }
    fn binary(&self) -> PathBuf {
        self.directory.join("ahakey-hook")
    }
    fn definition(&self) -> Value {
        let mut hooks = serde_json::Map::new();
        for event in self.tool.events() {
            let command = format!(
                "{} --tool {} --discovery {} --event {event}",
                quote(&self.binary()),
                self.tool.id(),
                quote(&self.discovery)
            );
            let timeout =
                if matches!(*event, "SessionEnd" | "sessionEnd") || self.tool == Tool::Kimi {
                    3
                } else {
                    70
                };
            let groups = match self.tool {
                Tool::Cursor => json!([{"command":command,"timeout":timeout}]),
                Tool::Kimi => json!([{"event":event,"command":command,"timeout":timeout}]),
                _ => json!([{"hooks":[{"type":"command","command":command,"timeout":timeout}]}]),
            };
            hooks.insert((*event).into(), groups);
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
        let mut config = self.parse_config(original.as_deref())?;
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
                        .get("command")
                        .and_then(Value::as_str)
                        .is_some_and(|cmd| cmd.starts_with(&quote(&self.binary())))
                        || group
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
                            "AhaKey Hook 已被手动修改，已保留原内容。请先核对该条目，再修复接入。",
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
            if self.tool == Tool::Cursor {
                if config.get("version").is_some_and(|v| v != 1) {
                    return Err(error("Cursor Hook 配置版本不支持。"));
                }
                config["version"] = json!(1);
            }
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
                !self.tool.events().contains(&event.as_str()) || !v.as_array().unwrap().is_empty()
            });
        }
        if read(&self.config())? != original {
            return Err(error("配置已被其他程序修改，请重新连接。"));
        }
        if let Some(bytes) = original.as_ref() {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            atomic(
                &self.directory.join(format!("hooks-backup-{stamp}.bak")),
                bytes,
                false,
            )?;
        }
        // Removing a nonexistent integration must not create a global config file.
        if original.is_some() || matches!(action, Action::Install) {
            atomic(
                &self.config(),
                &self.render_config(original.as_deref(), &config)?,
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
        let config = self.parse_config(read(&self.config())?.as_deref())?;
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
            detected: self.home.is_dir(),
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
            tool: Tool::Codex,
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

    #[test]
    fn claude_and_cursor_round_trip_preserve_user_settings() {
        for tool in [Tool::Claude, Tool::Cursor] {
            let dir = tempfile::tempdir().unwrap();
            let mut i = setup(dir.path());
            i.tool = tool;
            let user = if tool == Tool::Cursor {
                json!({"version":1,"hooks":{"stop":[{"command":"user-hook","timeout":5}]}})
            } else {
                json!({"model":"user-model","permissions":{"allow":["Read"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"user-hook"}]}]}})
            };
            atomic(&i.config(), &serde_json::to_vec(&user).unwrap(), false).unwrap();
            assert!(i.run(Action::Install).unwrap().installed);
            assert!(!i.run(Action::Install).unwrap().needs_repair);
            let configured = i
                .parse_config(read(&i.config()).unwrap().as_deref())
                .unwrap();
            let name = if tool == Tool::Cursor { "stop" } else { "Stop" };
            assert_eq!(configured["hooks"][name].as_array().unwrap().len(), 2);
            if tool == Tool::Cursor {
                assert!(
                    configured["hooks"]["beforeShellExecution"][0]["command"]
                        .as_str()
                        .unwrap()
                        .contains("--tool cursor")
                );
                assert!(configured["hooks"].get("preToolUse").is_none());
            }
            i.run(Action::Remove).unwrap();
            assert_eq!(
                i.parse_config(read(&i.config()).unwrap().as_deref())
                    .unwrap(),
                user
            );
        }
    }

    #[test]
    fn kimi_round_trip_preserves_comments_settings_and_foreign_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let mut i = setup(dir.path());
        i.tool = Tool::Kimi;
        let original = "# Personal config\ndefault_permission_mode = 'default'\n\n[[hooks]]\n# Keep this hook\nevent = 'Stop'\ncommand = 'user-hook'\ntimeout = 10\n\n[model]\nname = 'my-model'\n";
        atomic(&i.config(), original.as_bytes(), false).unwrap();
        let before: Value = toml_edit::de::from_str(original).unwrap();
        assert!(i.run(Action::Install).unwrap().installed);
        assert!(!i.run(Action::Install).unwrap().needs_repair);
        let configured = i
            .parse_config(read(&i.config()).unwrap().as_deref())
            .unwrap();
        assert_eq!(configured["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert!(
            configured["hooks"]["PermissionRequest"][0]["command"]
                .as_str()
                .unwrap()
                .contains("--tool kimi")
        );
        i.run(Action::Remove).unwrap();
        let after = fs::read_to_string(i.config()).unwrap();
        assert!(after.contains("# Personal config"));
        assert!(after.contains("# Keep this hook"));
        assert_eq!(toml_edit::de::from_str::<Value>(&after).unwrap(), before);
    }

    #[test]
    fn invalid_kimi_and_edited_cursor_hooks_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let mut i = setup(dir.path());
        i.tool = Tool::Kimi;
        atomic(&i.config(), b"[broken", false).unwrap();
        assert!(i.run(Action::Install).is_err());
        assert_eq!(fs::read(i.config()).unwrap(), b"[broken");
        i.tool = Tool::Cursor;
        i.run(Action::Install).unwrap();
        let mut config = parse(read(&i.config()).unwrap().as_deref()).unwrap();
        config["hooks"]["stop"][0]["timeout"] = json!(99);
        atomic(&i.config(), &serde_json::to_vec(&config).unwrap(), false).unwrap();
        let original = fs::read(i.config()).unwrap();
        assert!(i.run(Action::Install).is_err());
        assert_eq!(fs::read(i.config()).unwrap(), original);
        i.run(Action::Remove).unwrap();
        assert_eq!(
            parse(read(&i.config()).unwrap().as_deref()).unwrap()["hooks"]["stop"][0]["timeout"],
            99
        );
    }
}
