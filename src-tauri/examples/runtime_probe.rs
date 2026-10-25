#[tokio::main]
async fn main() {
    match ahakey_studio_lib::runtime_client::inspect().await {
        Ok(snapshot) => println!("{}", serde_json::to_string_pretty(&snapshot).unwrap()),
        Err(error) => {
            eprintln!("{}: {}", error.code, error.message);
            std::process::exit(1);
        }
    }
}
