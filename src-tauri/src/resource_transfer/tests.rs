use super::*;
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

#[tokio::test]
async fn waits_for_each_chunk_ack_and_preserves_bytes_amid_events() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("discovery.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    std::fs::write(
        &path,
        json!({"endpoint":format!("ws://{}/",listener.local_addr().unwrap()),"token":"test-token"})
            .to_string(),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let bytes: Vec<u8> = (0..31).collect();
    let expected = bytes.clone();
    let server = tokio::spawn(async move {
        let mut socket = accept_async(listener.accept().await.unwrap().0)
            .await
            .unwrap();
        for result in [
            json!({"protocol":{"major":1,"minor":0},"instanceId":"test-instance","runtimeVersion":"0.1.0","methods":["runtime.subscribe","resource.begin","resource.finish"]}),
            json!({"subscriptionId":"sub","snapshot":{"instanceId":"test-instance","sequence":"0","devices":[],"operations":[]}}),
        ] {
            let request: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            socket
                .send(Message::Text(
                    json!({"jsonrpc":"2.0","id":request["id"],"result":result})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
        }
        let begin: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(
            begin["params"]["sha256"],
            format!("{:x}", Sha256::digest(&expected))
        );
        let uuid = Uuid::parse_str("e8797433-9784-4ee7-b906-751746b7a874").unwrap();
        socket.send(Message::Text(json!({"jsonrpc":"2.0","id":begin["id"],"result":{"uploadId":uuid.to_string(),"chunkBytes":7}}).to_string().into())).await.unwrap();
        let mut received = vec![];
        while received.len() < expected.len() {
            let Message::Binary(chunk) = socket.next().await.unwrap().unwrap() else {
                panic!("expected binary chunk")
            };
            assert_eq!(&chunk[..16], uuid.as_bytes());
            assert_eq!(
                u32::from_le_bytes(chunk[16..20].try_into().unwrap()) as usize,
                received.len()
            );
            received.extend_from_slice(&chunk[20..]);
            assert!(
                tokio::time::timeout(Duration::from_millis(30), socket.next())
                    .await
                    .is_err(),
                "client must wait for ACK"
            );
            socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"runtime.event","params":{"type":"device.changed"}}).to_string().into())).await.unwrap();
            socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"resource.progress","params":{"uploadId":uuid.to_string(),"receivedBytes":received.len()}}).to_string().into())).await.unwrap();
        }
        assert_eq!(received, expected);
        let finish: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(finish["method"], "resource.finish");
        socket.send(Message::Text(json!({"jsonrpc":"2.0","id":finish["id"],"result":{"resourceId":"a".repeat(64),"width":160,"height":80,"frameCount":1,"intervalMs":100,"byteLength":28672,"crc32":1}}).to_string().into())).await.unwrap();
        let _ = socket.next().await;
    });
    assert_eq!(prepare(&path, bytes).await.unwrap().frame_count, 1);
    server.await.unwrap();
}
