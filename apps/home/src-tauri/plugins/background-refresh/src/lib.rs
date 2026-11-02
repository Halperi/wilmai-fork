use tauri::{plugin::{Builder, TauriPlugin}, Runtime};
#[cfg(target_os = "ios")]
use tauri::{Manager, plugin::PluginHandle};
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_background_refresh);
#[cfg(target_os = "ios")]
struct Native<R: Runtime>(PluginHandle<R>);
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("background-refresh").setup(|app, api| {
        #[cfg(target_os = "ios")]
        app.manage(Native(api.register_ios_plugin(init_plugin_background_refresh)?));
        #[cfg(not(target_os = "ios"))]
        let _ = (app, api);
        Ok(())
    }).build()
}
/// Only IDs cross this bridge: the notification plugin's Rust pending DTO requires a schedule that iOS omits.
#[cfg(target_os = "ios")]
pub fn pending_notification_ids<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Vec<i32>, String> {
    app.state::<Native<R>>().0.run_mobile_plugin("pendingIds", ()).map_err(|_| "Cannot inspect pending notification IDs".into())
}

#[cfg(target_os = "ios")]
pub fn protection_verified<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<bool, String> {
    let flags: std::collections::HashMap<String, bool> = app.state::<Native<R>>().0.run_mobile_plugin("privacyStatus", ()).map_err(|_| "Cannot inspect privacy status")?;
    Ok(["backupExcluded", "protectedFiles", "backgroundRegistered"].iter().all(|key| flags.get(*key) == Some(&true)))
}
