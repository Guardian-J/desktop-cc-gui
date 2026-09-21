fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri embeds its resource manifest only in application binaries, so
        // lib tests that link TaskDialogIndirect fail before the harness starts.
        // Let the linker embed the same Common Controls v6 dependency in every
        // MSVC target instead, without a duplicate manifest in Tauri's resources.
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("failed to run Tauri build script");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(concat!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:",
            "type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' ",
            "processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        ));
    } else {
        tauri_build::build();
    }
}
