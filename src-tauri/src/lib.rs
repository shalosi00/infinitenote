//! InfiniteNote desktop shell (Tauri 2).
//!
//! No custom commands are exposed yet: the renderer is the unmodified web
//! bundle, which persists everything in IndexedDB inside the webview. When
//! desktop-only capabilities are needed later (e.g. native file dialogs for
//! folder sync), register them here via `tauri::Builder::invoke_handler`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running InfiniteNote");
}
