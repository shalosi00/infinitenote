// InfiniteNote desktop entry point. The window loads the Next.js UI that
// `bun run build:desktop` statically exports into `../out` (see tauri.conf.json
// → build.frontendDist), so the desktop app is exactly the PWA running in the
// system webview with all data staying in the user's IndexedDB.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    infinitenote_lib::run()
}
