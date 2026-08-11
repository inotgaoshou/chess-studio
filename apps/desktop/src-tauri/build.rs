fn main() {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is before Unix epoch")
        .as_secs();
    println!("cargo:rustc-env=XIANGQI_BUILD_TIMESTAMP={timestamp}");
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build()
}
