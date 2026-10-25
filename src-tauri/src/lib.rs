pub mod resource_transfer;
pub mod runtime_client;
pub mod runtime_session;
pub mod service;
pub mod supervisor;
pub mod system;

use runtime_client::{ClientError, Inspection};
use runtime_session::{ClientView, KeymapRequest, OledRequest, RuntimeSession};
use serde_json::Value;
use std::{collections::HashMap, sync::Mutex};
use tauri::{Manager, State, ipc::Channel};

struct RuntimeBridge {
    client: RuntimeSession,
    service: service::ManagedService,
    service_error: Mutex<Option<ClientError>>,
    listeners: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

#[tauri::command]
async fn runtime_snapshot() -> Result<Inspection, ClientError> {
    runtime_client::inspect().await
}

#[tauri::command]
fn runtime_watch(
    listener_id: String,
    channel: Channel<ClientView>,
    bridge: State<'_, RuntimeBridge>,
) -> Result<(), ClientError> {
    let mut listeners = bridge.listeners.lock().unwrap();
    // Only the main window is authorized; replacing its observer also handles reloads.
    for (_, previous) in listeners.drain() {
        previous.abort();
    }
    let mut updates = bridge.client.subscribe();
    let task = tauri::async_runtime::spawn(async move {
        loop {
            let view = updates.borrow_and_update().clone();
            if channel.send(view).is_err() {
                break;
            }
            if updates.changed().await.is_err() {
                break;
            }
        }
    });
    listeners.insert(listener_id, task);
    Ok(())
}

#[tauri::command]
fn runtime_unwatch(listener_id: String, bridge: State<'_, RuntimeBridge>) {
    if let Some(task) = bridge.listeners.lock().unwrap().remove(&listener_id) {
        task.abort();
    }
}

#[tauri::command]
fn runtime_reconnect(bridge: State<'_, RuntimeBridge>) -> Result<(), ClientError> {
    bridge.client.reconnect()
}

#[tauri::command]
async fn runtime_configuration(
    generation: u64,
    device_id: String,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge.client.configuration(generation, device_id).await
}

#[tauri::command]
async fn runtime_read_configuration(
    generation: u64,
    device_id: String,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge
        .client
        .read_configuration(generation, device_id)
        .await
}
#[tauri::command]
async fn runtime_patch_configuration(
    generation: u64,
    request: runtime_session::ConfigurationPatch,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge.client.patch_configuration(generation, request).await
}

#[tauri::command]
async fn runtime_keymap(
    generation: u64,
    request: KeymapRequest,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge.client.keymap(generation, request).await
}

#[tauri::command]
async fn runtime_operation(
    generation: u64,
    operation_id: String,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge.client.operation(generation, operation_id).await
}

#[tauri::command]
async fn runtime_device_connection(
    generation: u64,
    device_id: String,
    connected: bool,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge
        .client
        .device_connection(generation, device_id, connected)
        .await
}

#[tauri::command]
async fn runtime_prepare_resource(
    bytes: Vec<u8>,
) -> Result<resource_transfer::PreparedResource, ClientError> {
    let path = runtime_client::default_discovery_path()?;
    resource_transfer::prepare(&path, bytes).await
}
#[tauri::command]
async fn runtime_oled(
    generation: u64,
    device_id: String,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge.client.oled(generation, device_id).await
}
#[tauri::command]
async fn runtime_upload_oled(
    generation: u64,
    request: OledRequest,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge.client.upload_oled(generation, request).await
}
#[tauri::command]
async fn runtime_control_operation(
    generation: u64,
    operation_id: String,
    resume: bool,
    bridge: State<'_, RuntimeBridge>,
) -> Result<Value, ClientError> {
    bridge
        .client
        .control_operation(generation, operation_id, resume)
        .await
}

#[tauri::command]
async fn runtime_service_status(
    bridge: State<'_, RuntimeBridge>,
) -> Result<supervisor::Status, ClientError> {
    let status = bridge.service.status().await?;
    if !matches!(
        status.phase.as_str(),
        "running" | "starting" | "backoff" | "stopping" | "external"
    ) && let Some(error) = bridge.service_error.lock().unwrap().clone()
    {
        return Err(error);
    }
    Ok(status)
}
#[tauri::command]
async fn runtime_service_start(
    bridge: State<'_, RuntimeBridge>,
) -> Result<supervisor::Status, ClientError> {
    let result = bridge.service.start(true).await;
    *bridge.service_error.lock().unwrap() = result.as_ref().err().cloned();
    result
}
#[tauri::command]
async fn runtime_service_stop(
    bridge: State<'_, RuntimeBridge>,
) -> Result<supervisor::Status, ClientError> {
    let result = bridge.service.stop().await;
    *bridge.service_error.lock().unwrap() = result.as_ref().err().cloned();
    result
}

#[tauri::command]
async fn runtime_input_settings(
    bridge: State<'_, RuntimeBridge>,
) -> Result<service::InputSettings, ClientError> {
    bridge.service.input_settings().await
}
#[tauri::command]
async fn runtime_set_input_monitor(
    enabled: bool,
    bridge: State<'_, RuntimeBridge>,
) -> Result<service::InputSettings, ClientError> {
    bridge.service.set_input_monitor(enabled).await
}

#[tauri::command]
async fn system_open_settings(pane: system::SettingsPane) -> Result<(), ClientError> {
    system::open_settings(pane).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = runtime_client::default_discovery_path()
                .map_err(|error| std::io::Error::other(error.message))?;
            let (client, driver) = RuntimeSession::new(path.clone());
            let resources = app.path().resource_dir()?.join("bin");
            let runtime = std::env::var_os("AHAKEY_RUNTIME_BINARY")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| resources.join("ahakey-runtime-rust"));
            let supervisor = resources.join("ahakey-runtime-supervisor");
            let directory = std::env::var_os("AHAKEY_STUDIO_SERVICE_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_local_data_dir()?.join("runtime-session"));
            let service = service::ManagedService::new(
                directory,
                path,
                runtime,
                supervisor,
                std::env::var("AHAKEY_RUNTIME_MOCK").as_deref() == Ok("1"),
            );
            app.manage(RuntimeBridge {
                client,
                service,
                service_error: Mutex::new(None),
                listeners: Mutex::new(HashMap::new()),
            });
            tauri::async_runtime::spawn(driver.run());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let bridge = handle.state::<RuntimeBridge>();
                let result = bridge.service.start(false).await;
                *bridge.service_error.lock().unwrap() = result.err();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_snapshot,
            runtime_watch,
            runtime_unwatch,
            runtime_reconnect,
            runtime_configuration,
            runtime_read_configuration,
            runtime_keymap,
            runtime_patch_configuration,
            runtime_operation,
            runtime_device_connection,
            runtime_prepare_resource,
            runtime_oled,
            runtime_upload_oled,
            runtime_control_operation,
            runtime_service_status,
            runtime_service_start,
            runtime_service_stop,
            system_open_settings,
            runtime_input_settings,
            runtime_set_input_monitor
        ])
        .run(tauri::generate_context!())
        .expect("failed to run AhaKey Studio");
}
