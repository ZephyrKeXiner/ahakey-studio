//! Fixed system-settings destinations; the WebView cannot supply an arbitrary URL or command.
use crate::runtime_client::ClientError;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsPane {
    Bluetooth,
    InputMonitoring,
    Microphone,
    SpeechRecognition,
    Accessibility,
}
impl SettingsPane {
    fn url(&self) -> &'static str {
        match self {
            Self::Bluetooth => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth"
            }
            Self::Microphone => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            }
            Self::SpeechRecognition => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
            }
            Self::Accessibility => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            Self::InputMonitoring => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
            }
        }
    }
}

pub async fn open_settings(pane: SettingsPane) -> Result<(), ClientError> {
    #[cfg(target_os = "macos")]
    {
        let mut command = tokio::process::Command::new("/usr/bin/open");
        command.arg(pane.url()).kill_on_drop(true);
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(5), command.status()).await;
        if matches!(result, Ok(Ok(status)) if status.success()) {
            return Ok(());
        }
        Err(ClientError::new(
            "SETTINGS_UNAVAILABLE",
            "无法打开系统设置，请手动进入“隐私与安全性”中的对应权限页面。",
        ))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pane.url();
        Err(ClientError::new(
            "UNSUPPORTED_PLATFORM",
            "此入口仅适用于 macOS。",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_privacy_panes_are_accepted() {
        for invalid in [
            "file:///tmp/example",
            "https://example.com",
            "unknownPane",
            "bluetooth;open",
        ] {
            assert!(serde_json::from_value::<SettingsPane>(serde_json::json!(invalid)).is_err());
        }
        let pane: SettingsPane = serde_json::from_str("\"inputMonitoring\"").unwrap();
        assert!(pane.url().ends_with("?Privacy_ListenEvent"));
    }
}
