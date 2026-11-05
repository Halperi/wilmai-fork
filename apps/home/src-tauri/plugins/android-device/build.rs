fn main() {
    tauri_plugin::Builder::new(&["vault_identity", "vault_load", "vault_save", "configure", "claim", "complete", "take_tap", "pending_ids", "cancel_schedules", "register_listener", "remove_listener"])
        .android_path("android").build();
}
