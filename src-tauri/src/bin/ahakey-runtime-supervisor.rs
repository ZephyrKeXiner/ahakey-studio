#[allow(dead_code)] // Shared helpers are used by the Studio service controller.
#[path = "../supervisor.rs"]
mod supervisor;
#[tokio::main]
async fn main() {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--config")) {
        eprintln!("Usage: ahakey-runtime-supervisor --config ABSOLUTE_PATH");
        std::process::exit(2);
    }
    let Some(path) = args.next() else {
        std::process::exit(2)
    };
    if args.next().is_some() {
        std::process::exit(2);
    }
    if let Err(error) = supervisor::run(path.into()).await {
        eprintln!("Runtime supervisor: {error}");
        std::process::exit(1);
    }
}
