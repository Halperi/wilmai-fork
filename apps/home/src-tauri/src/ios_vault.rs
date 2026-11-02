//! A private, device-only iOS Keychain record. No arbitrary service/account names cross IPC.
use security_framework::{
    access_control::{ProtectionMode, SecAccessControl},
    passwords::{delete_generic_password_options, generic_password, set_generic_password_options, PasswordOptions},
};
use serde::{Deserialize, Serialize};
use tauri::Manager;

const ACCOUNT: &str = "vault.v1";
const MAX_BYTES: usize = 1024 * 1024;
const NOT_FOUND: i32 = -25300;
#[derive(Serialize, Deserialize)]
struct Envelope { version: u8, installation: String, data: String }
fn valid_installation(id: &str) -> bool {
    id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}
fn options(service: &str) -> PasswordOptions {
    let mut options = PasswordOptions::new_generic_password(service, ACCOUNT);
    options.set_access_synchronized(Some(false));
    options
}
fn error(e: security_framework::base::Error) -> String {
    format!("iOS Keychain unavailable ({})", e.code())
}
fn read(service: &str) -> Result<Option<Vec<u8>>, String> {
    match generic_password(options(service)) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.code() == NOT_FOUND => Ok(None),
        Err(e) => Err(error(e)),
    }
}
fn remove(service: &str) -> Result<(), String> {
    match delete_generic_password_options(options(service)) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == NOT_FOUND => Ok(()),
        Err(e) => Err(error(e)),
    }
}
fn write(service: &str, value: &[u8]) -> Result<(), String> {
    let mut options = options(service);
    let access = SecAccessControl::create_with_protection(Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly), 0).map_err(error)?;
    options.set_access_control(access);
    set_generic_password_options(value, options).map_err(error)
}
fn service(app: &tauri::AppHandle) -> String { format!("{}.ios-vault", app.config().identifier) }

#[tauri::command]
pub async fn ios_vault_load(app: tauri::AppHandle, installation: String) -> Result<Option<String>, String> {
    if !valid_installation(&installation) { return Err("Invalid installation identifier".into()); }
    let service = service(&app);
    let Some(value) = read(&service)? else { return Ok(None); };
    if value.len() > MAX_BYTES { return Err("Secure storage is too large".into()); }
    let envelope: Envelope = serde_json::from_slice(&value).map_err(|_| "Invalid secure storage format")?;
    if envelope.version != 1 { return Err("Unsupported secure storage version".into()); }
    if envelope.installation != installation {
        remove(&service)?; // Keychain can survive uninstall; a new installation cannot recover the old logins.
        return Ok(None);
    }
    Ok(Some(envelope.data))
}
#[tauri::command]
pub async fn ios_vault_save(app: tauri::AppHandle, installation: String, data: String) -> Result<(), String> {
    if !valid_installation(&installation) { return Err("Invalid installation identifier".into()); }
    if data.len() > MAX_BYTES { return Err("Secure storage is too large".into()); }
    let parsed: serde_json::Value = serde_json::from_str(&data).map_err(|_| "Invalid secure storage format")?;
    if parsed.get("version").and_then(|v| v.as_u64()) != Some(1) { return Err("Unsupported secure storage version".into()); }
    let value = serde_json::to_vec(&Envelope { version: 1, installation, data }).map_err(|_| "Cannot encode secure storage")?;
    if value.len() > MAX_BYTES { return Err("Secure storage is too large".into()); }
    write(&service(&app), &value)
}

/// Real SecItem round trip with synthetic data, isolated from the user's vault. Debug builds only.
#[cfg(debug_assertions)]
pub fn smoke_test(app: &tauri::AppHandle) {
    let service = format!("{}.smoke", service(app));
    let result = (|| -> Result<(), String> {
        write(&service, b"synthetic-first")?;
        if read(&service)?.as_deref() != Some(b"synthetic-first") { return Err("Keychain read mismatch".into()); }
        write(&service, b"synthetic-second")?;
        if read(&service)?.as_deref() != Some(b"synthetic-second") { return Err("Keychain update mismatch".into()); }
        remove(&service)?;
        if read(&service)?.is_some() { return Err("Keychain delete mismatch".into()); }
        Ok(())
    })();
    let _ = remove(&service);
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let value = match result { Ok(()) => serde_json::json!({"passed": true}), Err(error) => serde_json::json!({"passed": false, "error": error}) };
        let _ = std::fs::write(dir.join("keychain-smoke.json"), value.to_string());
    }
}
