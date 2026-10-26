//! Native Runtime discovery and authenticated session bootstrap. Discovery credentials never cross the WebView boundary.
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{Message, protocol::WebSocketConfig},
};
use url::Url;

pub(super) type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
const DEADLINE: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientError {
    pub code: String,
    pub message: String,
    pub outcome_unknown: bool,
}
impl ClientError {
    pub(super) fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            outcome_unknown: false,
        }
    }
    pub(super) fn unknown(mut self, mutation: bool) -> Self {
        self.outcome_unknown = mutation;
        self
    }
    pub(super) fn protocol() -> Self {
        Self::new("INVALID_RESPONSE", "Runtime 返回的数据不符合当前协议。")
    }
    pub(super) fn disconnected() -> Self {
        Self::new("UNREACHABLE", "无法连接 Runtime，请确认它正在运行后重试。")
    }
}

#[derive(Deserialize)]
struct Discovery {
    endpoint: String,
    token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Protocol {
    pub major: u32,
    pub minor: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Hello {
    protocol: Protocol,
    instance_id: String,
    runtime_version: String,
    methods: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub device_id: String,
    pub name: String,
    pub connection_state: String,
    pub battery_percent: Option<u8>,
    pub work_mode: Option<u8>,
    pub lever: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub operation_id: String,
    pub device_id: String,
    pub status: String,
    pub progress: f64,
    pub effect: String,
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configuration_progress: Option<ConfigurationProgress>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationProgress {
    pub fields_total: usize,
    pub fields_acknowledged: usize,
    pub fields_verified: usize,
    pub phase: String,
    pub save_acknowledged: bool,
}

// Permission state comes from the Runtime's actual helper. Do not query the Studio process's TCC identity.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    pub input_device_id: String,
    pub name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputState {
    pub status: String,
    pub permission: String,
    // Only connection metadata crosses this UI boundary; no key history or held usages.
    pub devices: Vec<InputDevice>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub instance_id: String,
    pub sequence: String,
    pub devices: Vec<Device>,
    pub operations: Vec<Operation>,
    #[serde(default)]
    pub input: Option<InputState>,
    #[serde(default)]
    pub voice: Option<Value>,
    #[serde(default)]
    pub hooks: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub protocol: Protocol,
    pub instance_id: String,
    pub runtime_version: String,
    pub methods: Vec<String>,
    pub snapshot: Snapshot,
}

pub(super) fn default_discovery_path() -> Result<PathBuf, ClientError> {
    if let Some(path) = std::env::var_os("AHAKEY_RUNTIME_DISCOVERY") {
        let path = PathBuf::from(path);
        return if path.is_absolute() {
            Ok(path)
        } else {
            Err(ClientError::new(
                "INVALID_DISCOVERY",
                "Runtime discovery 路径必须是绝对路径。",
            ))
        };
    }
    #[cfg(target_os = "macos")]
    let path = std::env::var_os("HOME").map(|home| {
        PathBuf::from(home).join("Library/Application Support/AhaKey/runtime/discovery.json")
    });
    #[cfg(target_os = "windows")]
    let path = std::env::var_os("LOCALAPPDATA")
        .map(|home| PathBuf::from(home).join("AhaKey/runtime/discovery.json"));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let path = std::env::var_os("XDG_RUNTIME_DIR")
        .map(|dir| PathBuf::from(dir).join("ahakey/discovery.json"))
        .or_else(|| {
            std::env::var_os("HOME")
                .map(|home| PathBuf::from(home).join(".local/state/ahakey/discovery.json"))
        });
    path.ok_or(ClientError::new(
        "HOME_UNAVAILABLE",
        "无法定位当前用户的 Runtime 配置目录。",
    ))
}

fn validate_endpoint(endpoint: &str) -> Result<(), ClientError> {
    let uri = Url::parse(endpoint)
        .map_err(|_| ClientError::new("INVALID_DISCOVERY", "Runtime discovery 地址无效。"))?;
    if uri.scheme() != "ws"
        || uri.host_str() != Some("127.0.0.1")
        || uri.port().is_none_or(|port| port == 0)
        || !uri.username().is_empty()
        || uri.password().is_some()
        || uri.path() != "/"
        || uri.query().is_some()
        || uri.fragment().is_some()
    {
        return Err(ClientError::new(
            "INVALID_DISCOVERY",
            "Runtime discovery 必须指向本机的私有服务地址。",
        ));
    }
    Ok(())
}

pub async fn inspect() -> Result<Inspection, ClientError> {
    inspect_path(&default_discovery_path()?).await
}

pub async fn inspect_path(path: &Path) -> Result<Inspection, ClientError> {
    tokio::time::timeout(DEADLINE, inspect_inner(path))
        .await
        .map_err(|_| ClientError::new("TIMEOUT", "读取 Runtime 状态超时，请重试。"))?
}

async fn inspect_inner(path: &Path) -> Result<Inspection, ClientError> {
    let mut connection = connect_path(path).await?;
    let _ = connection.socket.close(None).await;
    Ok(connection.inspection)
}

pub(super) struct Connection {
    pub socket: Socket,
    pub inspection: Inspection,
    pub subscription_id: String,
}

pub(super) async fn connect_path(path: &Path) -> Result<Connection, ClientError> {
    tokio::time::timeout(DEADLINE, connect_inner(path))
        .await
        .map_err(|_| ClientError::new("TIMEOUT", "连接 Runtime 超时。"))?
}

async fn connect_inner(path: &Path) -> Result<Connection, ClientError> {
    let metadata = tokio::fs::symlink_metadata(path).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ClientError::new(
                "NOT_RUNNING",
                "尚未找到 Runtime，启动后 Studio 会自动连接。",
            )
        } else {
            ClientError::new("DISCOVERY_UNREADABLE", "无法读取 Runtime 发现文件。")
        }
    })?;
    if !metadata.is_file() || metadata.len() > 16_384 {
        return Err(ClientError::new(
            "INVALID_DISCOVERY",
            "Runtime 发现文件无效。",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let parent = path.parent().ok_or_else(ClientError::protocol)?;
        let directory = tokio::fs::metadata(parent)
            .await
            .map_err(|_| ClientError::protocol())?;
        if metadata.permissions().mode() & 0o077 != 0 || directory.permissions().mode() & 0o077 != 0
        {
            return Err(ClientError::new(
                "DISCOVERY_PERMISSIONS",
                "Runtime 发现文件和目录需要仅当前用户可访问。",
            ));
        }
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_| ClientError::new("DISCOVERY_UNREADABLE", "无法读取 Runtime 发现文件。"))?;
    let discovery: Discovery = serde_json::from_slice(&bytes)
        .map_err(|_| ClientError::new("INVALID_DISCOVERY", "Runtime 发现文件格式无效。"))?;
    validate_endpoint(&discovery.endpoint)?;
    if discovery.token.is_empty() || discovery.token.len() > 1024 {
        return Err(ClientError::protocol());
    }
    let config = WebSocketConfig::default()
        .max_message_size(Some(4 * 1024 * 1024))
        .max_frame_size(Some(4 * 1024 * 1024));
    // A native handshake intentionally omits Origin, as required by Runtime.
    let (mut socket, _) = connect_async_with_config(&discovery.endpoint, Some(config), false)
        .await
        .map_err(|_| ClientError::disconnected())?;
    let hello: Hello = serde_json::from_value(call(&mut socket, "hello", "runtime.hello", json!({
        "protocol":{"major":1,"minor":0},
        "client":{"name":"AhaKey Studio","version":env!("CARGO_PKG_VERSION"),"kind":"desktop"},
        "token":discovery.token
    })).await?).map_err(|_| ClientError::protocol())?;
    if hello.protocol.major != 1 {
        return Err(ClientError::new(
            "PROTOCOL_MISMATCH",
            "当前 Runtime 协议版本与 Studio 不兼容。",
        ));
    }
    if !hello
        .methods
        .iter()
        .any(|method| method == "runtime.subscribe")
    {
        return Err(ClientError::new(
            "UNSUPPORTED_CAPABILITY",
            "当前 Runtime 不支持状态订阅，请更新 Runtime。",
        ));
    }
    let subscription = call(
        &mut socket,
        "snapshot",
        "runtime.subscribe",
        json!({"topics":["state"],"cursor":null}),
    )
    .await?;
    let snapshot: Snapshot = serde_json::from_value(subscription["snapshot"].clone())
        .map_err(|_| ClientError::protocol())?;
    if snapshot.instance_id != hello.instance_id || snapshot.sequence.parse::<u64>().is_err() {
        return Err(ClientError::protocol());
    }
    let subscription_id = subscription["subscriptionId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(ClientError::protocol)?
        .to_owned();
    Ok(Connection {
        socket,
        inspection: Inspection {
            protocol: hello.protocol,
            instance_id: hello.instance_id,
            runtime_version: hello.runtime_version,
            methods: hello.methods,
            snapshot,
        },
        subscription_id,
    })
}

async fn call(
    socket: &mut Socket,
    id: &str,
    method: &str,
    params: Value,
) -> Result<Value, ClientError> {
    socket
        .send(Message::Text(
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
                .to_string()
                .into(),
        ))
        .await
        .map_err(|_| ClientError::disconnected())?;
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                let response: Value =
                    serde_json::from_str(&text).map_err(|_| ClientError::protocol())?;
                if response["id"].as_str() != Some(id) {
                    continue;
                }
                if response["jsonrpc"] != "2.0" {
                    return Err(ClientError::protocol());
                }
                if response.get("error").is_some() {
                    return Err(match response["error"]["data"]["code"].as_str() {
                        Some("PERMISSION_DENIED") => {
                            ClientError::new("AUTH_FAILED", "Runtime 认证失败，请重新读取状态。")
                        }
                        Some("PROTOCOL_MISMATCH") => ClientError::new(
                            "PROTOCOL_MISMATCH",
                            "当前 Runtime 协议版本与 Studio 不兼容。",
                        ),
                        _ => ClientError::new("RPC_FAILED", "Runtime 未能返回状态，请重试。"),
                    });
                }
                return response
                    .get("result")
                    .cloned()
                    .ok_or_else(ClientError::protocol);
            }
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => {
                socket
                    .flush()
                    .await
                    .map_err(|_| ClientError::disconnected())?;
            }
            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                return Err(ClientError::disconnected());
            }
            _ => return Err(ClientError::protocol()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::{
        accept_hdr_async,
        tungstenite::handshake::server::{Request, Response},
    };

    // Tungstenite's callback requires the concrete HTTP error response type.
    #[allow(clippy::result_large_err)]
    fn native_upgrade(
        request: &Request,
        response: Response,
    ) -> Result<Response, tokio_tungstenite::tungstenite::handshake::server::ErrorResponse> {
        assert!(!request.headers().contains_key("origin"));
        Ok(response)
    }

    #[test]
    fn only_runtime_loopback_endpoints_are_accepted() {
        assert!(validate_endpoint("ws://127.0.0.1:54321/").is_ok());
        for endpoint in [
            "ws://example.com:123/",
            "wss://127.0.0.1:123/",
            "ws://127.0.0.1:123/?token=x",
            "ws://user@127.0.0.1:123/",
            "ws://127.0.0.1:0/",
            "ws://127.0.0.1:123/other",
            "ws://127.0.0.1:123/#fragment",
        ] {
            assert!(validate_endpoint(endpoint).is_err(), "accepted {endpoint}");
        }
    }

    #[tokio::test]
    async fn absent_discovery_is_not_running() {
        let directory = tempfile::tempdir().unwrap();
        let error = inspect_path(&directory.path().join("missing.json"))
            .await
            .unwrap_err();
        assert_eq!(error.code, "NOT_RUNNING");
    }

    #[tokio::test]
    async fn authenticates_without_origin_and_returns_only_typed_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let discovery = directory.path().join("discovery.json");
        std::fs::write(&discovery, json!({"endpoint":format!("ws://{}/",listener.local_addr().unwrap()),"token":"private-token"}).to_string()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))
                .unwrap();
            std::fs::set_permissions(&discovery, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_hdr_async(stream, native_upgrade).await.unwrap();
            let hello: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            assert_eq!(hello["params"]["token"], "private-token");
            socket.send(Message::Text(json!({"jsonrpc":"2.0","id":hello["id"],"result":{"protocol":{"major":1,"minor":0},"instanceId":"runtime-a","runtimeVersion":"0.1.0","methods":["runtime.subscribe"],"extraSecret":"must-not-cross"}}).to_string().into())).await.unwrap();
            let request: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            assert_eq!(request["method"], "runtime.subscribe");
            socket
                .send(Message::Text(
                    json!({"jsonrpc":"2.0","method":"runtime.event","params":{"sequence":"1"}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            socket.send(Message::Text(json!({"jsonrpc":"2.0","id":request["id"],"result":{"subscriptionId":"sub-a","snapshot":{"instanceId":"runtime-a","sequence":"9007199254740993","devices":[],"operations":[]}}}).to_string().into())).await.unwrap();
            let _ = socket.next().await;
        });
        let result = inspect_path(&discovery).await.unwrap();
        assert_eq!(result.snapshot.sequence, "9007199254740993");
        let exposed = serde_json::to_string(&result).unwrap();
        assert!(!exposed.contains("private-token"));
        assert!(!exposed.contains("must-not-cross"));
        server.await.unwrap();
    }
}
