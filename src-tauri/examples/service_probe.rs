//! Isolated lifecycle test controller; refuses production paths and always starts Mock Runtime.
use ahakey_studio_lib::service::ManagedService;
use std::path::PathBuf;
#[tokio::main]
async fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    assert_eq!(args.len(), 4, "action directory runtime supervisor");
    let directory = PathBuf::from(&args[1]);
    assert!(
        directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("ahakey-service-smoke-")
    );
    let service = ManagedService::new(
        directory.join("service"),
        directory.join("runtime/discovery.json"),
        args[2].clone().into(),
        args[3].clone().into(),
        true,
    );
    if let Some(enabled) = match args[0].to_str().unwrap() {
        "input-on" => Some(true),
        "input-off" => Some(false),
        _ => None,
    } {
        match service.set_input_monitor(enabled).await {
            Ok(settings) => println!("{}", serde_json::to_string(&settings).unwrap()),
            Err(error) => {
                eprintln!("{}: {}", error.code, error.message);
                std::process::exit(1);
            }
        }
        return;
    }
    if args[0] == "input-settings" {
        let settings = service.input_settings().await.unwrap();
        println!("{}", serde_json::to_string(&settings).unwrap());
        return;
    }
    let result = match args[0].to_str().unwrap() {
        "start" => service.start(true).await,
        "open" => service.start(false).await,
        "status" => service.status().await,
        "stop" => service.stop().await,
        _ => panic!("unknown action"),
    };
    match result {
        Ok(status) => println!("{}", serde_json::to_string(&status).unwrap()),
        Err(error) => {
            eprintln!("{}: {}", error.code, error.message);
            std::process::exit(1);
        }
    }
}
