use super::*;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{WebSocketStream, accept_async};
type ServerSocket = WebSocketStream<TcpStream>;

fn publish(path: &std::path::Path, address: std::net::SocketAddr, token: &str) {
    std::fs::write(
        path,
        json!({"endpoint":format!("ws://{address}/"),"token":token}).to_string(),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            path.parent().unwrap(),
            std::fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
}
async fn receive(socket: &mut ServerSocket) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(3), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(text) = message {
            return serde_json::from_str(&text).unwrap();
        }
    }
}
async fn send_json(socket: &mut ServerSocket, value: Value) {
    socket
        .send(Message::Text(value.to_string().into()))
        .await
        .unwrap();
}
fn operation() -> Value {
    json!({"operationId":"task-a","deviceId":"x1-test","status":"completed","progress":1,"effect":"complete","errorCode":null})
}
async fn bootstrap(
    listener: &TcpListener,
    token: &str,
    instance: &str,
    sequence: u64,
    operations: Vec<Value>,
) -> ServerSocket {
    let (stream, _) = listener.accept().await.unwrap();
    let mut socket = accept_async(stream).await.unwrap();
    let hello = receive(&mut socket).await;
    assert_eq!(hello["method"], "runtime.hello");
    assert_eq!(hello["params"]["token"], token);
    send_json(&mut socket,json!({"jsonrpc":"2.0","id":hello["id"],"result":{"protocol":{"major":1,"minor":0},"instanceId":instance,"runtimeVersion":"0.1.0","methods":["runtime.subscribe","configuration.get","operation.get","keymap.apply"]}})).await;
    let subscribe = receive(&mut socket).await;
    assert_eq!(subscribe["method"], "runtime.subscribe");
    send_json(&mut socket,json!({"jsonrpc":"2.0","id":subscribe["id"],"result":{"subscriptionId":"subscription-a","snapshot":{"instanceId":instance,"sequence":sequence.to_string(),"devices":[],"operations":operations}}})).await;
    socket
}
fn event(instance: &str, sequence: u64, kind: &str, data: Value) -> Value {
    json!({"jsonrpc":"2.0","method":"runtime.event","params":{"instanceId":instance,"subscriptionId":"subscription-a","sequence":sequence.to_string(),"type":kind,"data":data}})
}
async fn until(client: &RuntimeSession, predicate: impl Fn(&ClientView) -> bool) -> ClientView {
    let mut receiver = client.subscribe();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let view = receiver.borrow_and_update().clone();
            if predicate(&view) {
                return view;
            }
            receiver.changed().await.unwrap();
        }
    })
    .await
    .expect("expected session state")
}
fn keymap() -> KeymapRequest {
    KeymapRequest {
        operation_id: "task-a".into(),
        device_id: "x1-test".into(),
        base_token: "baseline-a".into(),
        mode: 0,
        keys: vec![KeyBinding {
            index: 0,
            action: json!({"type":"disabled"}),
        }],
    }
}

#[tokio::test]
async fn correlates_out_of_order_responses_while_applying_events() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("discovery.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    publish(&path, listener.local_addr().unwrap(), "token-a");
    let server = tokio::spawn(async move {
        let mut socket = bootstrap(&listener, "token-a", "instance-a", 0, vec![]).await;
        let first = receive(&mut socket).await;
        let second = receive(&mut socket).await;
        send_json(
            &mut socket,
            event(
                "instance-a",
                1,
                "configuration.changed",
                json!({"deviceId":"x1-test"}),
            ),
        )
        .await;
        send_json(
            &mut socket,
            event("instance-a", 2, "operation.changed", operation()),
        )
        .await;
        for request in [second, first] {
            let result = if request["method"] == "configuration.get" {
                json!({"baseToken":"updated-token","configuration":null,"deviceId":"x1-test"})
            } else {
                operation()
            };
            send_json(
                &mut socket,
                json!({"jsonrpc":"2.0","id":request["id"],"result":result}),
            )
            .await;
        }
        let _ = socket.next().await;
    });
    let (client, driver) = RuntimeSession::new(path);
    let worker = tokio::spawn(driver.run());
    let ready = until(&client, |view| view.status == "connected").await;
    let (configuration, operation) = tokio::join!(
        client.configuration(ready.generation, "x1-test".into()),
        client.operation(ready.generation, "task-a".into())
    );
    assert_eq!(configuration.unwrap()["baseToken"], "updated-token");
    assert_eq!(operation.unwrap()["operationId"], "task-a");
    let view = until(&client, |view| {
        view.inspection
            .as_ref()
            .is_some_and(|i| i.snapshot.operations.len() == 1)
    })
    .await;
    assert_eq!(view.configuration_epochs["x1-test"], "1");
    assert_eq!(view.inspection.unwrap().snapshot.sequence, "2");
    drop(client);
    worker.await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn lost_mutation_reply_is_unknown_and_reconnection_never_replays_it() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("discovery.json");
    let first = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let second = TcpListener::bind("127.0.0.1:0").await.unwrap();
    publish(&path, first.local_addr().unwrap(), "token-a");
    let server_path = path.clone();
    let server = tokio::spawn(async move {
        let mut socket = bootstrap(&first, "token-a", "instance-a", 0, vec![]).await;
        let mutation = receive(&mut socket).await;
        assert_eq!(mutation["method"], "keymap.apply");
        assert_eq!(mutation["params"]["operationId"], "task-a");
        publish(&server_path, second.local_addr().unwrap(), "token-b");
        socket.close(None).await.unwrap();
        let mut socket = bootstrap(&second, "token-b", "instance-b", 8, vec![operation()]).await;
        // The next request is an explicit lookup, never a replay of keymap.apply.
        let query = receive(&mut socket).await;
        assert_eq!(query["method"], "operation.get");
        send_json(
            &mut socket,
            json!({"jsonrpc":"2.0","id":query["id"],"result":operation()}),
        )
        .await;
        let _ = socket.next().await;
    });
    let (client, driver) = RuntimeSession::new(path);
    let worker = tokio::spawn(driver.run());
    let original = until(&client, |view| view.status == "connected").await;
    let error = client
        .keymap(original.generation, keymap())
        .await
        .unwrap_err();
    assert!(error.outcome_unknown);
    let restored = until(&client, |view| {
        view.status == "connected" && view.generation == 2
    })
    .await;
    assert_eq!(restored.inspection.unwrap().instance_id, "instance-b");
    let stale = client
        .keymap(original.generation, keymap())
        .await
        .unwrap_err();
    assert_eq!(stale.code, "STALE_CONNECTION");
    assert!(!stale.outcome_unknown);
    assert_eq!(
        client.operation(2, "task-a".into()).await.unwrap()["status"],
        "completed"
    );
    drop(client);
    worker.await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn unknown_events_advance_sequence_and_a_gap_forces_a_fresh_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("discovery.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    publish(&path, listener.local_addr().unwrap(), "token-a");
    let (advance, wait) = oneshot::channel();
    let server = tokio::spawn(async move {
        let start = 9_007_199_254_740_993;
        let mut socket = bootstrap(&listener, "token-a", "instance-a", start, vec![]).await;
        send_json(
            &mut socket,
            event("instance-a", start + 1, "future.event", json!({})),
        )
        .await;
        send_json(&mut socket,event("instance-a",start+2,"device.changed",json!({"deviceId":"x1-test","name":"Test","connectionState":"ready","workMode":0,"batteryPercent":80,"lever":null}))).await;
        wait.await.unwrap();
        send_json(
            &mut socket,
            event("instance-a", start + 4, "operation.changed", operation()),
        )
        .await;
        let _ = socket.next().await;
        let mut socket = bootstrap(
            &listener,
            "token-a",
            "instance-a",
            start + 5,
            vec![operation()],
        )
        .await;
        let _ = socket.next().await;
    });
    let (client, driver) = RuntimeSession::new(path);
    let worker = tokio::spawn(driver.run());
    let updated = until(&client, |view| {
        view.inspection
            .as_ref()
            .is_some_and(|i| i.snapshot.devices.len() == 1)
    })
    .await;
    assert_eq!(
        updated.inspection.unwrap().snapshot.sequence,
        "9007199254740995"
    );
    advance.send(()).unwrap();
    let restored = until(&client, |view| {
        view.status == "connected" && view.generation == 2
    })
    .await;
    assert_eq!(
        restored.inspection.unwrap().snapshot.sequence,
        "9007199254740998"
    );
    drop(client);
    worker.await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn propagates_helper_permission_changes_without_exposing_key_data() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("discovery.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    publish(&path, listener.local_addr().unwrap(), "token-a");
    let (advance, wait) = oneshot::channel();
    let server = tokio::spawn(async move {
        let mut socket = bootstrap(&listener, "token-a", "instance-a", 0, vec![]).await;
        send_json(
            &mut socket,
            event(
                "instance-a",
                1,
                "input.changed",
                json!({"status":"permissionDenied","permission":"denied","devices":[]}),
            ),
        )
        .await;
        wait.await.unwrap();
        send_json(&mut socket, event("instance-a", 2, "input.changed",
            json!({"status":"listening","permission":"granted","devices":[{"inputDeviceId":"hid-a","name":"AhaKey X1","pressedUsages":[7]}]}))).await;
        let _ = socket.next().await;
    });
    let (client, driver) = RuntimeSession::new(path);
    let worker = tokio::spawn(driver.run());
    let denied = until(&client, |view| {
        view.inspection
            .as_ref()
            .and_then(|i| i.snapshot.input.as_ref())
            .is_some_and(|input| input.permission == "denied")
    })
    .await;
    assert_eq!(
        denied.inspection.unwrap().snapshot.input.unwrap().status,
        "permissionDenied"
    );
    advance.send(()).unwrap();
    let granted = until(&client, |view| {
        view.inspection
            .as_ref()
            .and_then(|i| i.snapshot.input.as_ref())
            .is_some_and(|input| input.permission == "granted")
    })
    .await;
    let input = serde_json::to_value(granted.inspection.unwrap().snapshot.input.unwrap()).unwrap();
    assert_eq!(input["devices"][0]["inputDeviceId"], "hid-a");
    assert!(input["devices"][0].get("pressedUsages").is_none());
    drop(client);
    worker.await.unwrap();
    server.await.unwrap();
}

#[test]
fn accepts_current_and_older_snapshots_without_inventing_permission() {
    use crate::runtime_client::Snapshot;
    let old = json!({"instanceId":"a","sequence":"0","devices":[],"operations":[]});
    let snapshot: Snapshot = serde_json::from_value(old.clone()).unwrap();
    assert!(snapshot.input.is_none());
    let mut current = old;
    current["input"] = json!({"status":"disabled","permission":"unknown","devices":[]});
    let snapshot: Snapshot = serde_json::from_value(current).unwrap();
    assert_eq!(snapshot.input.unwrap().permission, "unknown");
}
