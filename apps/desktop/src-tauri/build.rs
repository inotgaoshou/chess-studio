fn main() {
    println!("cargo:rerun-if-env-changed=XIANGQI_BUILD_TIMESTAMP");
    let timestamp = std::env::var("XIANGQI_BUILD_TIMESTAMP")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is before Unix epoch")
                .as_secs()
        });
    println!("cargo:rustc-env=XIANGQI_BUILD_TIMESTAMP={timestamp}");
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new()),
    )
    .expect("failed to build Tauri application permissions")
}
