//! One persistent native socket owns RPC correlation, ordered events and reconnection.
//! Requests are never replayed across connections; mutations retain their operation IDs in Studio.
use crate::runtime_client::{ClientError, Connection, Device, Inspection, Operation, connect_path};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    time::Duration,
};
use tokio::{
    sync::{mpsc, oneshot, watch},
    time::Instant,
};
use tokio_tungstenite::tungstenite::Message;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const HEARTBEAT: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientView {
    pub status: &'static str,
    pub generation: u64,
    pub inspection: Option<Inspection>,
    pub error: Option<ClientError>,
    pub configuration_epochs: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeymapRequest {
    pub operation_id: String,
    pub device_id: String,
    pub base_token: String,
    pub mode: u8,
    pub keys: Vec<KeyBinding>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct KeyBinding {
    pub index: u8,
    pub action: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigurationPatch {
    pub operation_id: String,
    pub device_id: String,
    pub base_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brightness_percent: Option<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub descriptions: Vec<DescriptionPatch>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DescriptionPatch {
    pub mode: u8,
    pub index: u8,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum OledTarget {
    ModeDefault { mode: u8 },
    ModeState { mode: u8, state: OledState },
    MultiState { state: OledState },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OledState {
    Working,
    Waiting,
    Done,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OledRequest {
    pub operation_id: String,
    pub device_id: String,
    pub base_token: String,
    pub resource_id: String,
    pub target: OledTarget,
}

#[derive(Clone)]
pub struct RuntimeSession {
    sender: mpsc::Sender<Command>,
    view: watch::Receiver<ClientView>,
}
pub struct Driver {
    path: PathBuf,
    commands: mpsc::Receiver<Command>,
    updates: watch::Sender<ClientView>,
    view: ClientView,
    serial: u64,
}
struct Request {
    method: &'static str,
    params: Value,
    generation: u64,
    mutation: bool,
    deadline: Instant,
    reply: oneshot::Sender<Result<Value, ClientError>>,
}
enum Command {
    Request(Request),
    Reconnect,
}
struct Pending {
    mutation: bool,
    deadline: Instant,
    reply: oneshot::Sender<Result<Value, ClientError>>,
}

impl RuntimeSession {
    pub fn new(path: PathBuf) -> (Self, Driver) {
        let initial = ClientView {
            status: "connecting",
            generation: 0,
            inspection: None,
            error: None,
            configuration_epochs: BTreeMap::new(),
        };
        let (sender, commands) = mpsc::channel(32);
        let (updates, view) = watch::channel(initial.clone());
        (
            Self { sender, view },
            Driver {
                path,
                commands,
                updates,
                view: initial,
                serial: 0,
            },
        )
    }
    pub fn subscribe(&self) -> watch::Receiver<ClientView> {
        self.view.clone()
    }
    pub fn reconnect(&self) -> Result<(), ClientError> {
        self.sender
            .try_send(Command::Reconnect)
            .map_err(|_| ClientError::new("CLIENT_BUSY", "连接正在恢复，请稍后重试。"))
    }
    pub async fn voice(
        &self,
        generation: u64,
        method: &str,
        params: Value,
    ) -> Result<Value, ClientError> {
        let method = match method {
            "voice.get" => "voice.get",
            "voice.configure" => "voice.configure",
            "voice.control" => "voice.control",
            _ => return Err(ClientError::new("INVALID_PARAMS", "未知语音操作。")),
        };
        self.request(generation, method, params, method != "voice.get")
            .await
    }
    pub async fn configuration(
        &self,
        generation: u64,
        device_id: String,
    ) -> Result<Value, ClientError> {
        self.request(
            generation,
            "configuration.get",
            json!({"deviceId":device_id}),
            false,
        )
        .await
    }
    pub async fn read_configuration(
        &self,
        generation: u64,
        device_id: String,
    ) -> Result<Value, ClientError> {
        self.request(
            generation,
            "configuration.read",
            json!({"deviceId": device_id}),
            false,
        )
        .await
    }
    pub async fn patch_configuration(
        &self,
        generation: u64,
        request: ConfigurationPatch,
    ) -> Result<Value, ClientError> {
        self.request(generation, "configuration.patch", json!(request), true)
            .await
    }
    pub async fn keymap(
        &self,
        generation: u64,
        request: KeymapRequest,
    ) -> Result<Value, ClientError> {
        self.request(generation, "keymap.apply", json!(request), true)
            .await
    }
    pub async fn operation(
        &self,
        generation: u64,
        operation_id: String,
    ) -> Result<Value, ClientError> {
        self.request(
            generation,
            "operation.get",
            json!({"operationId":operation_id}),
            false,
        )
        .await
    }
    pub async fn device_connection(
        &self,
        generation: u64,
        device_id: String,
        connected: bool,
    ) -> Result<Value, ClientError> {
        self.request(
            generation,
            if connected {
                "device.connect"
            } else {
                "device.disconnect"
            },
            json!({"deviceId":device_id}),
            false,
        )
        .await
    }
    pub async fn oled(&self, generation: u64, device_id: String) -> Result<Value, ClientError> {
        self.request(generation, "oled.get", json!({"deviceId":device_id}), false)
            .await
    }
    pub async fn upload_oled(
        &self,
        generation: u64,
        request: OledRequest,
    ) -> Result<Value, ClientError> {
        self.request(generation, "oled.upload", json!(request), true)
            .await
    }
    pub async fn control_operation(
        &self,
        generation: u64,
        operation_id: String,
        resume: bool,
    ) -> Result<Value, ClientError> {
        self.request(
            generation,
            if resume {
                "operation.resume"
            } else {
                "operation.pause"
            },
            json!({"operationId":operation_id}),
            true,
        )
        .await
    }
    async fn request(
        &self,
        generation: u64,
        method: &'static str,
        params: Value,
        mutation: bool,
    ) -> Result<Value, ClientError> {
        let (reply, result) = oneshot::channel();
        self.sender
            .try_send(Command::Request(Request {
                method,
                params,
                generation,
                mutation,
                deadline: Instant::now() + REQUEST_TIMEOUT,
                reply,
            }))
            .map_err(|_| ClientError::new("CLIENT_BUSY", "请求队列已满，请稍后重试。"))?;
        result
            .await
            .map_err(|_| ClientError::disconnected().unknown(mutation))?
    }
}

impl Driver {
    fn publish(&self) {
        self.updates.send_replace(self.view.clone());
    }
    fn unavailable(&mut self, error: ClientError) {
        self.view.status = "reconnecting";
        self.view.error = Some(error);
        self.publish();
    }
    fn reject_disconnected(request: Request) {
        let _ = request.reply.send(Err(ClientError::new(
            "NOT_CONNECTED",
            "尚未连接 Runtime，本次操作未发送。",
        )));
    }
    pub async fn run(mut self) {
        let mut delay_ms = 500;
        loop {
            self.view.status = if self.view.inspection.is_some() {
                "reconnecting"
            } else {
                "connecting"
            };
            self.publish();
            let path = self.path.clone();
            let connecting = connect_path(&path);
            tokio::pin!(connecting);
            let connected = loop {
                tokio::select! {
                    result = &mut connecting => break result,
                    command = self.commands.recv() => match command {
                        Some(Command::Request(request)) => Self::reject_disconnected(request),
                        Some(Command::Reconnect) => {},
                        None => return,
                    }
                }
            };
            // Drop the bootstrap future before mutably serving this driver.
            let result = match connected {
                Ok(mut connection) => {
                    delay_ms = 500;
                    self.view.status = "connected";
                    self.view.generation += 1;
                    self.view.inspection = Some(connection.inspection.clone());
                    self.view.configuration_epochs.clear();
                    self.view.error = None;
                    self.publish();
                    match self.serve(&mut connection).await {
                        None => return,
                        Some(error) => error,
                    }
                }
                Err(error) => error,
            };
            self.unavailable(result);
            let delay = tokio::time::sleep(Duration::from_millis(delay_ms));
            tokio::pin!(delay);
            loop {
                tokio::select! {
                    _ = &mut delay => break,
                    command = self.commands.recv() => match command {
                        Some(Command::Request(request)) => Self::reject_disconnected(request),
                        Some(Command::Reconnect) => { delay_ms = 500; break; },
                        None => return,
                    }
                }
            }
            delay_ms = (delay_ms * 2).min(5_000);
        }
    }

    async fn serve(&mut self, connection: &mut Connection) -> Option<ClientError> {
        let mut pending: HashMap<String, Pending> = HashMap::new();
        let mut heartbeat = Instant::now() + HEARTBEAT;
        let mut received = Instant::now();
        let result = loop {
            let deadline = pending
                .values()
                .map(|request| request.deadline)
                .min()
                .unwrap_or(heartbeat)
                .min(heartbeat);
            tokio::select! {
                command = self.commands.recv() => match command {
                    Some(Command::Reconnect) => break Some(ClientError::new("RECONNECTING", "正在重新连接 Runtime。")),
                    None => break None,
                    Some(Command::Request(request)) => {
                        if request.reply.is_closed() { continue; }
                        if request.generation != self.view.generation {
                            let _ = request.reply.send(Err(ClientError::new("STALE_CONNECTION", "Runtime 连接已更新，请核对设备状态后重新操作。")));
                            continue;
                        }
                        if request.deadline <= Instant::now() {
                            let _ = request.reply.send(Err(ClientError::new("QUEUE_TIMEOUT", "请求等待超时，本次操作未发送。")));
                            continue;
                        }
                        if !connection.inspection.methods.iter().any(|method| method == request.method) {
                            let _ = request.reply.send(Err(ClientError::new("UNSUPPORTED_CAPABILITY", "当前 Runtime 不支持这项操作。")));
                            continue;
                        }
                        self.serial += 1;
                        let id = format!("studio-{}", self.serial);
                        let message = json!({"jsonrpc":"2.0","id":id,"method":request.method,"params":request.params});
                        pending.insert(id, Pending { mutation: request.mutation, deadline: request.deadline, reply: request.reply });
                        if send(connection, Message::Text(message.to_string().into())).await.is_err() {
                            break Some(ClientError::disconnected());
                        }
                    }
                },
                message = connection.socket.next() => {
                    received = Instant::now();
                    match message {
                        Some(Ok(Message::Text(text))) => {
                            let value: Value = match serde_json::from_str(&text) { Ok(value) => value, Err(_) => break Some(ClientError::protocol()) };
                            if value["jsonrpc"] != "2.0" { break Some(ClientError::protocol()); }
                            if let Some(id) = value["id"].as_str() {
                                if let Some(request) = pending.remove(id) {
                                    let result = rpc_result(&value).map_err(|error| if error.code == "INVALID_RESPONSE" { error.unknown(request.mutation) } else { error });
                                    let _ = request.reply.send(result);
                                }
                            } else if value["method"] == "runtime.event"
                                && let Err(error) = self.apply_event(connection, &value["params"]) { break Some(error); }
                        }
                        Some(Ok(Message::Ping(_))) => {
                            if !matches!(tokio::time::timeout(WRITE_TIMEOUT, connection.socket.flush()).await, Ok(Ok(()))) { break Some(ClientError::disconnected()); }
                        }
                        Some(Ok(Message::Pong(_))) => {},
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break Some(ClientError::disconnected()),
                        _ => break Some(ClientError::protocol()),
                    }
                },
                _ = tokio::time::sleep_until(deadline) => {
                    let now = Instant::now();
                    let expired: Vec<_> = pending.iter().filter(|(_, request)| request.deadline <= now).map(|(id, _)| id.clone()).collect();
                    for id in expired {
                        let request = pending.remove(&id).unwrap();
                        let _ = request.reply.send(Err(ClientError::new("REQUEST_TIMEOUT", "Runtime 响应超时。写入任务请查询原任务结果。").unknown(request.mutation)));
                    }
                    if now >= heartbeat {
                        if now.duration_since(received) >= HEARTBEAT * 3 { break Some(ClientError::disconnected()); }
                        if send(connection, Message::Ping(Vec::new().into())).await.is_err() { break Some(ClientError::disconnected()); }
                        heartbeat = now + HEARTBEAT;
                    }
                }
            }
        };
        for (_, request) in pending {
            let _ = request.reply.send(Err(ClientError::new(
                "CONNECTION_LOST",
                "Runtime 连接中断。写入任务将按原任务 ID 核对结果。",
            )
            .unknown(request.mutation)));
        }
        // Bounded close; losing Studio's socket never stops or replays a Runtime operation.
        let _ =
            tokio::time::timeout(Duration::from_millis(250), connection.socket.close(None)).await;
        result
    }

    fn apply_event(&mut self, connection: &Connection, event: &Value) -> Result<(), ClientError> {
        let inspection = self
            .view
            .inspection
            .as_mut()
            .ok_or_else(ClientError::protocol)?;
        if event["instanceId"] != inspection.instance_id
            || event["subscriptionId"] != connection.subscription_id
        {
            return Err(ClientError::new(
                "STALE_EVENT",
                "Runtime 状态会话已变化，正在重新同步。",
            ));
        }
        let sequence = event["sequence"]
            .as_str()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(ClientError::protocol)?;
        let previous = inspection
            .snapshot
            .sequence
            .parse::<u64>()
            .map_err(|_| ClientError::protocol())?;
        if sequence <= previous {
            return Ok(());
        }
        if previous.checked_add(1) != Some(sequence) {
            return Err(ClientError::new(
                "EVENT_GAP",
                "Runtime 状态发生缺口，正在重新获取完整快照。",
            ));
        }
        inspection.snapshot.sequence = sequence.to_string();
        let kind = event["type"].as_str().ok_or_else(ClientError::protocol)?;
        match kind {
            "voice.changed" => {
                inspection.snapshot.voice = Some(event["data"].clone());
            }

            "input.changed" => {
                inspection.snapshot.input = Some(
                    serde_json::from_value(event["data"].clone())
                        .map_err(|_| ClientError::protocol())?,
                );
            }
            "device.changed" => {
                let device: Device = serde_json::from_value(event["data"].clone())
                    .map_err(|_| ClientError::protocol())?;
                if let Some(current) = inspection
                    .snapshot
                    .devices
                    .iter_mut()
                    .find(|current| current.device_id == device.device_id)
                {
                    *current = device;
                } else {
                    inspection.snapshot.devices.push(device);
                }
            }
            "operation.changed" => {
                let operation: Operation = serde_json::from_value(event["data"].clone())
                    .map_err(|_| ClientError::protocol())?;
                if let Some(current) = inspection
                    .snapshot
                    .operations
                    .iter_mut()
                    .find(|current| current.operation_id == operation.operation_id)
                {
                    *current = operation;
                } else {
                    inspection.snapshot.operations.push(operation);
                }
            }
            "configuration.changed" | "configuration.invalidated" | "oled.changed" => {
                let id = event["data"]["deviceId"]
                    .as_str()
                    .ok_or_else(ClientError::protocol)?;
                self.view
                    .configuration_epochs
                    .insert(id.to_owned(), sequence.to_string());
            }
            _ => return Ok(()), // Unknown events still advance the cursor.
        }
        self.publish();
        Ok(())
    }
}

async fn send(connection: &mut Connection, message: Message) -> Result<(), ClientError> {
    tokio::time::timeout(WRITE_TIMEOUT, connection.socket.send(message))
        .await
        .map_err(|_| ClientError::disconnected())?
        .map_err(|_| ClientError::disconnected())
}

fn rpc_result(value: &Value) -> Result<Value, ClientError> {
    if let Some(error) = value.get("error") {
        let code = error["data"]["code"]
            .as_str()
            .filter(|code| {
                code.len() <= 64 && code.bytes().all(|b| b.is_ascii_uppercase() || b == b'_')
            })
            .unwrap_or("RPC_FAILED");
        let message = match code {
            "BASE_CONFLICT" => "键盘配置已变化，请重新读取并核对本次修改。",
            "BUSY" => "设备正在执行其他任务，请等待任务结束。",
            "DEVICE_NOT_READY" => "键盘尚未就绪，请等待设备连接。",
            "OPERATION_NOT_FOUND" => "Runtime 中没有找到这个任务，请保留原记录并核对。",
            "INVALID_PARAMS" => "提交的键位设置无效，请检查键码和宏步骤。",
            "UNSUPPORTED_CAPABILITY" => "当前 Runtime 或固件不支持这项操作。",
            _ => "Runtime 未能执行这项操作。",
        };
        return Err(ClientError::new(code, message));
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(ClientError::protocol)
}

#[cfg(test)]
mod tests;
