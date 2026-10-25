//! Invoked by scripts/smoke-runtime.py against an isolated --mock Runtime only.
use ahakey_studio_lib::runtime_session::{
    ClientView, ConfigurationPatch, DescriptionPatch, KeyBinding, KeymapRequest, OledRequest,
    OledTarget, RuntimeSession,
};
use serde_json::json;
use std::{path::PathBuf, time::Duration};
async fn until(client: &RuntimeSession, predicate: impl Fn(&ClientView) -> bool) -> ClientView {
    let mut updates = client.subscribe();
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let view = updates.borrow_and_update().clone();
            if predicate(&view) {
                return view;
            }
            updates.changed().await.unwrap();
        }
    })
    .await
    .expect("Runtime state deadline")
}
#[tokio::main]
async fn main() {
    let path = PathBuf::from(
        std::env::var_os("AHAKEY_RUNTIME_DISCOVERY").expect("isolated discovery required"),
    );
    let (client, driver) = RuntimeSession::new(path.clone());
    let worker = tokio::spawn(driver.run());
    let ready = until(&client, |v| {
        v.status == "connected"
            && v.inspection.as_ref().is_some_and(|i| {
                i.snapshot
                    .devices
                    .iter()
                    .any(|d| d.device_id == "mock-x1" && d.connection_state == "ready")
            })
    })
    .await;
    let devices = &ready.inspection.as_ref().unwrap().snapshot.devices;
    assert_eq!(devices.len(), 1, "mock-only smoke test");
    assert_eq!(devices[0].device_id, "mock-x1");
    let before = client
        .configuration(ready.generation, "mock-x1".into())
        .await
        .unwrap();
    let action = json!({"type":"shortcut","modifiers":["gui"],"keyCode":5});
    let request = KeymapRequest {
        operation_id: "studio-smoke-keymap".into(),
        device_id: "mock-x1".into(),
        base_token: before["baseToken"].as_str().unwrap().into(),
        mode: 0,
        keys: vec![KeyBinding {
            index: 0,
            action: action.clone(),
        }],
    };
    let accepted = client
        .keymap(ready.generation, request.clone())
        .await
        .unwrap();
    assert_eq!(accepted["operationId"], request.operation_id);
    let done = until(&client, |v| {
        v.inspection.as_ref().is_some_and(|i| {
            i.snapshot.operations.iter().any(|o| {
                o.operation_id == "studio-smoke-keymap"
                    && !["accepted", "running"].contains(&o.status.as_str())
            })
        })
    })
    .await;
    let result = &done.inspection.as_ref().unwrap().snapshot.operations[0];
    assert_eq!(result.status, "completed");
    assert_eq!(result.effect, "complete");
    let evidence = result
        .configuration_progress
        .as_ref()
        .expect("native bridge preserves field evidence");
    assert_eq!(evidence.fields_total, 1);
    assert_eq!(evidence.fields_acknowledged, 1);
    assert_eq!(evidence.fields_verified, 0, "Mock has no device readback");
    assert!(evidence.save_acknowledged);

    let after = client
        .configuration(ready.generation, "mock-x1".into())
        .await
        .unwrap();
    let mut expected = before.clone();
    expected["baseToken"] = after["baseToken"].clone();
    if !expected["configuration"].is_null() {
        expected["configuration"]["modes"][0]["keys"][0]["action"] = action.clone();
    }
    if !expected["readback"].is_null() {
        expected["readback"]["modes"][0]["keys"][0]["action"] = action;
    }
    assert_eq!(after, expected, "only submitted key changes");
    client.reconnect().unwrap();
    let restored = until(&client, |v| {
        v.status == "connected" && v.generation > ready.generation
    })
    .await;
    let task = client
        .operation(restored.generation, request.operation_id.clone())
        .await
        .unwrap();
    assert_eq!(task["status"], "completed");
    assert_eq!(
        client
            .keymap(ready.generation, request)
            .await
            .unwrap_err()
            .code,
        "STALE_CONNECTION"
    );
    let bytes =
        std::fs::read(std::env::var_os("AHAKEY_SMOKE_IMAGE").expect("smoke image")).unwrap();
    let resource = ahakey_studio_lib::resource_transfer::prepare(&path, bytes)
        .await
        .unwrap();
    let oled_before = client
        .oled(restored.generation, "mock-x1".into())
        .await
        .unwrap();
    assert_eq!(oled_before["entries"].as_array().unwrap().len(), 19);
    let configuration_before = client
        .configuration(restored.generation, "mock-x1".into())
        .await
        .unwrap();
    let oled_request = OledRequest {
        operation_id: "studio-smoke-oled".into(),
        device_id: "mock-x1".into(),
        base_token: configuration_before["baseToken"].as_str().unwrap().into(),
        resource_id: resource.resource_id,
        target: OledTarget::ModeDefault { mode: 0 },
    };
    client
        .upload_oled(restored.generation, oled_request)
        .await
        .unwrap();
    let done = until(&client, |v| {
        v.inspection.as_ref().is_some_and(|i| {
            i.snapshot.operations.iter().any(|o| {
                o.operation_id == "studio-smoke-oled"
                    && !["accepted", "running"].contains(&o.status.as_str())
            })
        })
    })
    .await;
    let result = done
        .inspection
        .unwrap()
        .snapshot
        .operations
        .into_iter()
        .find(|o| o.operation_id == "studio-smoke-oled")
        .unwrap();
    assert_eq!(result.status, "completed");
    assert_eq!(result.effect, "complete");
    let oled_after = client
        .oled(restored.generation, "mock-x1".into())
        .await
        .unwrap();
    let entries = oled_after["entries"].as_array().unwrap();
    let entry = entries
        .iter()
        .find(|entry| entry["target"] == json!({"kind":"modeDefault","mode":0}))
        .unwrap();
    assert_eq!(entry["valid"], true);
    assert_eq!(entry["crc32"], resource.crc32);
    assert_eq!(entry["frameCount"], resource.frame_count);
    for old in oled_before["entries"].as_array().unwrap() {
        if old["target"] != entry["target"] {
            assert!(entries.contains(old), "other OLED slots untouched");
        }
    }
    let mut configuration_after = client
        .configuration(restored.generation, "mock-x1".into())
        .await
        .unwrap();
    configuration_after["baseToken"] = configuration_before["baseToken"].clone();
    assert_eq!(
        configuration_after, configuration_before,
        "OLED upload leaves key configuration untouched"
    );
    println!(
        "PASS: PNG preparation, OLED upload, metadata CRC verification, other slots and key configuration unchanged"
    );
    let fields_before = client
        .configuration(restored.generation, "mock-x1".into())
        .await
        .unwrap();
    let field_request = ConfigurationPatch {
        operation_id: "studio-smoke-fields".into(),
        device_id: "mock-x1".into(),
        base_token: fields_before["baseToken"].as_str().unwrap().into(),
        brightness_percent: Some(57),
        descriptions: vec![DescriptionPatch {
            mode: 2,
            index: 1,
            description: "Approve".into(),
        }],
    };
    client
        .patch_configuration(restored.generation, field_request.clone())
        .await
        .unwrap();
    until(&client, |view| {
        view.inspection.as_ref().is_some_and(|inspection| {
            inspection
                .snapshot
                .operations
                .iter()
                .any(|op| op.operation_id == "studio-smoke-fields" && op.status == "completed")
        })
    })
    .await;
    let fields_after = client
        .configuration(restored.generation, "mock-x1".into())
        .await
        .unwrap();
    let mut expected = fields_before;
    expected["baseToken"] = fields_after["baseToken"].clone();
    expected["configuration"]["device"]["brightnessPercent"] = json!(57);
    let mode = expected["configuration"]["modes"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|mode| mode["mode"] == 2)
        .unwrap();
    let key = mode["keys"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|key| key["role"] == "approve")
        .unwrap();
    key["description"] = json!("Approve");
    assert_eq!(
        fields_after, expected,
        "field patch preserves all unrelated configuration"
    );
    assert_eq!(
        client
            .oled(restored.generation, "mock-x1".into())
            .await
            .unwrap(),
        oled_after,
        "field patch preserves OLED resources"
    );
    client.reconnect().unwrap();
    let reconnected = until(&client, |view| {
        view.status == "connected" && view.generation > restored.generation
    })
    .await;
    assert_eq!(
        client
            .operation(reconnected.generation, field_request.operation_id.clone())
            .await
            .unwrap()["status"],
        "completed"
    );
    assert_eq!(
        client
            .patch_configuration(restored.generation, field_request)
            .await
            .unwrap_err()
            .code,
        "STALE_CONNECTION"
    );
    println!(
        "PASS: field patch over real IPC, exact brightness/description change, untouched keys/lights/OLED, original task recovery"
    );
    let accepted_read = client
        .read_configuration(reconnected.generation, "mock-x1".into())
        .await
        .unwrap();
    assert_eq!(accepted_read["status"], "reading");
    // MockX1 deliberately has no hardware readback. It must report unsupported, not fabricate observations from journal values.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let document = client
                .configuration(reconnected.generation, "mock-x1".into())
                .await
                .unwrap();
            if document["read"]["status"] != "reading" {
                assert_eq!(document["read"]["status"], "failed");
                assert_eq!(document["read"]["errorCode"], "UNSUPPORTED_CONFIGURATION");
                assert!(document["configuration"].is_null());
                assert!(document["readback"].is_null());
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    println!(
        "PASS: explicit hardware read admission/status over real IPC; unsupported Mock remains unknown"
    );
    drop(client);
    worker.await.unwrap();
    println!(
        "PASS: real Mock Runtime, one-key patch, untouched fields, completion events, reconnect lookup, stale-generation rejection"
    );
}
