fn main() {
    tauri_plugin::Builder::new(&["configure", "pending_ids", "privacy_status", "take_tap", "claim", "complete", "register_listener", "remove_listener"])
        .ios_path("ios").build();
}
