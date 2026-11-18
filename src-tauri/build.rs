fn main() {
    // A Databento key given at build time (CI secret DATABENTO_API_KEY -> env UTOPIA_DATABENTO_KEY) is
    // compiled in, lightly scrambled so it is not a plain string in the binary. Settings can override it.
    println!("cargo:rerun-if-env-changed=UTOPIA_DATABENTO_KEY");
    if let Ok(key) = std::env::var("UTOPIA_DATABENTO_KEY") {
        let key = key.trim();
        if !key.is_empty() {
            let mask = b"utopia-apostles-seal";
            let hex: String = key
                .bytes()
                .enumerate()
                .map(|(i, b)| format!("{:02x}", b ^ mask[i % mask.len()]))
                .collect();
            println!("cargo:rustc-env=UTOPIA_DB_KEY_OBF={hex}");
        }
    }
    tauri_build::build()
}
