//! File preparation uses its own authenticated socket; no command here writes a device.
use crate::runtime_client::{ClientError, Connection, connect_path};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tokio::time::{Instant, timeout_at};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

const MAX_BYTES: usize = 2 * 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(30);
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedResource {
    pub resource_id: String,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub interval_ms: u32,
    pub byte_length: u32,
    pub crc32: u32,
}

pub async fn prepare(path: &Path, bytes: Vec<u8>) -> Result<PreparedResource, ClientError> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(ClientError::new(
            "RESOURCE_SIZE",
            "请选择不超过 2 MiB 的 PNG、JPEG 或 GIF 图片。",
        ));
    }
    let mut connection = connect_path(path).await?;
    for method in ["resource.begin", "resource.finish"] {
        if !connection
            .inspection
            .methods
            .iter()
            .any(|item| item == method)
        {
            return Err(ClientError::new(
                "UNSUPPORTED_CAPABILITY",
                "当前 Runtime 不支持 OLED 素材上传。",
            ));
        }
    }
    let result = transfer(&mut connection, &bytes).await;
    // Closing discards an unfinished transfer, while a finished resource remains reusable.
    let _ = tokio::time::timeout(Duration::from_millis(250), connection.socket.close(None)).await;
    result
}
async fn transfer(
    connection: &mut Connection,
    bytes: &[u8],
) -> Result<PreparedResource, ClientError> {
    let digest = format!("{:x}", Sha256::digest(bytes));
    let begin = rpc(
        connection,
        "prepare-begin",
        "resource.begin",
        json!({"byteLength":bytes.len(),"sha256":digest}),
    )
    .await?;
    let upload_id = begin["uploadId"]
        .as_str()
        .ok_or_else(ClientError::protocol)?;
    let uuid = Uuid::parse_str(upload_id).map_err(|_| ClientError::protocol())?;
    let chunk_bytes = begin["chunkBytes"]
        .as_u64()
        .filter(|size| *size > 0 && *size <= 65536)
        .ok_or_else(ClientError::protocol)? as usize;
    for (index, chunk) in bytes.chunks(chunk_bytes).enumerate() {
        let offset = index * chunk_bytes;
        let mut message = Vec::with_capacity(20 + chunk.len());
        message.extend_from_slice(uuid.as_bytes());
        message.extend_from_slice(&(offset as u32).to_le_bytes());
        message.extend_from_slice(chunk);
        let deadline = Instant::now() + DEADLINE;
        send(connection, Message::Binary(message.into()), deadline).await?;
        loop {
            let response = receive(connection, deadline).await?;
            if response["method"] == "resource.error" {
                return Err(resource_error(
                    response["params"]["code"]
                        .as_str()
                        .unwrap_or("RESOURCE_ERROR"),
                ));
            }
            if response["method"] == "resource.progress" {
                if response["params"]["uploadId"] != upload_id
                    || response["params"]["receivedBytes"].as_u64()
                        != Some((offset + chunk.len()) as u64)
                {
                    return Err(ClientError::protocol());
                }
                break;
            }
        }
    }
    let result = rpc(
        connection,
        "prepare-finish",
        "resource.finish",
        json!({"uploadId":upload_id}),
    )
    .await?;
    let resource: PreparedResource =
        serde_json::from_value(result).map_err(|_| ClientError::protocol())?;
    if resource.width != 160
        || resource.height != 80
        || resource.interval_ms != 100
        || resource.frame_count == 0
        || resource.frame_count > 12
        || resource.resource_id.len() != 64
        || !resource.resource_id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(ClientError::protocol());
    }
    Ok(resource)
}
async fn rpc(
    connection: &mut Connection,
    id: &str,
    method: &str,
    params: Value,
) -> Result<Value, ClientError> {
    let deadline = Instant::now() + DEADLINE;
    send(
        connection,
        Message::Text(
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
                .to_string()
                .into(),
        ),
        deadline,
    )
    .await?;
    loop {
        let value = receive(connection, deadline).await?;
        if value["id"] != id {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(resource_error(
                error["data"]["code"].as_str().unwrap_or("RESOURCE_ERROR"),
            ));
        }
        return value
            .get("result")
            .cloned()
            .ok_or_else(ClientError::protocol);
    }
}
async fn send(
    connection: &mut Connection,
    message: Message,
    deadline: Instant,
) -> Result<(), ClientError> {
    timeout_at(deadline, connection.socket.send(message))
        .await
        .map_err(|_| ClientError::new("RESOURCE_TIMEOUT", "素材传输超时，请重新准备图片。"))?
        .map_err(|_| ClientError::disconnected())
}
async fn receive(connection: &mut Connection, deadline: Instant) -> Result<Value, ClientError> {
    loop {
        let message = timeout_at(deadline, connection.socket.next())
            .await
            .map_err(|_| ClientError::new("RESOURCE_TIMEOUT", "素材传输超时，请重新准备图片。"))?;
        match message {
            Some(Ok(Message::Text(text))) => {
                let value: Value =
                    serde_json::from_str(&text).map_err(|_| ClientError::protocol())?;
                if value["jsonrpc"] != "2.0" {
                    return Err(ClientError::protocol());
                }
                return Ok(value);
            }
            Some(Ok(Message::Ping(_))) => {
                timeout_at(deadline, connection.socket.flush())
                    .await
                    .map_err(|_| ClientError::disconnected())?
                    .map_err(|_| ClientError::disconnected())?;
            }
            Some(Ok(Message::Pong(_))) => {}
            _ => return Err(ClientError::disconnected()),
        }
    }
}
fn resource_error(code: &str) -> ClientError {
    let message = match code {
        "IMAGE_DIMENSIONS" => "图片每帧需要为 160 × 80 像素，请先调整尺寸。",
        "TOO_MANY_FRAMES" => "图片帧数超过上限，默认动画最多 8 帧，状态动画最多 12 帧。",
        "INCOMPATIBLE_FRAME_INTERVAL" => "动图需要固定为每帧 100 毫秒，请调整后重新选择。",
        "INCOMPATIBLE_LOOP_COUNT" => "动图需要设置为无限循环。",
        "UNSUPPORTED_IMAGE_FORMAT" => "请选择 PNG、JPEG 或 GIF；暂不支持 APNG。",
        "INVALID_IMAGE" => "图片无法解码，请检查文件后重新选择。",
        "RESOURCE_STORE_FULL" => "Runtime 素材空间已满，请维护资源目录后重试。",
        _ => "素材准备失败，请重新选择图片。",
    };
    let safe_code = if code.len() <= 64 && code.bytes().all(|b| b.is_ascii_uppercase() || b == b'_')
    {
        code
    } else {
        "RESOURCE_ERROR"
    };
    ClientError::new(safe_code, message)
}

#[cfg(test)]
mod tests;
