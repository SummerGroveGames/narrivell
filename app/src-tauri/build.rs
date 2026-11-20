fn main() {
    // Cloud sign-in IDs (Google "Desktop app" client etc.) come from a
    // git-ignored cloud-keys.json next to this file, so they never end up in
    // the public repository. Without it the app builds fine; cloud sign-in
    // just explains that this copy isn't registered.
    // Release builds on GitHub Actions skip the file and set the two
    // NARRIVELL_GOOGLE_* environment variables from encrypted repository
    // secrets instead; cloud.rs reads them with option_env! either way.
    println!("cargo:rerun-if-changed=cloud-keys.json");
    println!("cargo:rerun-if-env-changed=NARRIVELL_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=NARRIVELL_GOOGLE_CLIENT_SECRET");
    if let Ok(text) = std::fs::read_to_string("cloud-keys.json") {
        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(v) => {
                for (key, var) in [
                    ("googleClientId", "NARRIVELL_GOOGLE_CLIENT_ID"),
                    ("googleClientSecret", "NARRIVELL_GOOGLE_CLIENT_SECRET"),
                ] {
                    if let Some(value) = v.get(key).and_then(|x| x.as_str()) {
                        println!("cargo:rustc-env={var}={value}");
                    }
                }
            }
            Err(e) => println!("cargo:warning=cloud-keys.json is not valid JSON: {e}"),
        }
    }
    tauri_build::build()
}
