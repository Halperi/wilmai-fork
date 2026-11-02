//! Debug-only synthetic notification round trip. Never reads school data or the credential vault.
use tauri::Manager;
use tauri_plugin_notification::{NotificationExt, Schedule};

pub fn run(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let api = app.notification();
            if api.request_permission().map_err(|_| "Permission request failed")? != tauri::plugin::PermissionState::Granted {
                return Err("Notification permission not granted".into());
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
            api.builder().id(2_147_480_001).title("WilmAI Home")
                .body("Ilmoitustesti. Tämä ilmoitus ei sisällä koulutietoja.").show().map_err(|_| "Immediate notification failed")?;
            let schedule: Schedule = serde_json::from_value(serde_json::json!({"at": {
                "date": "2099-01-01T12:00:00Z", "repeating": false, "allowWhileIdle": false
            }})).map_err(|_| "Invalid test schedule")?;
            api.builder().id(2_147_480_002).title("WilmAI Home").body("Synthetic schedule test")
                .schedule(schedule).show().map_err(|_| "Scheduling failed")?;
            std::thread::sleep(std::time::Duration::from_millis(300));
            let pending = tauri_plugin_background_refresh::pending_notification_ids(&app)?;
            if !pending.contains(&2_147_480_002) { return Err("Scheduled notification missing".into()); }
            api.cancel(vec![2_147_480_002]).map_err(|_| "Cancel failed")?;
            if tauri_plugin_background_refresh::pending_notification_ids(&app)?.contains(&2_147_480_002) {
                return Err("Cancellation did not remove the notification".into());
            }
            if !tauri_plugin_background_refresh::protection_verified(&app)? { return Err("Storage protection or background registration not verified".into()); }
            Ok(())
        })();
        let _ = app.notification().cancel(vec![2_147_480_002]);
        if let Ok(dir) = app.path().app_data_dir() {
            let _ = std::fs::create_dir_all(&dir);
            let value = match result { Ok(()) => serde_json::json!({"passed": true}), Err(error) => serde_json::json!({"passed": false, "error": error}) };
            let _ = std::fs::write(dir.join("notification-smoke.json"), value.to_string());
        }
    });
}
