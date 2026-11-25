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
// Serializes enrollment, reads and writes, including the app-container marker.
static VAULT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[derive(Serialize, Deserialize)]
struct Envelope { version: u8, installation: String, data: String }
fn valid_installation(id: &str) -> bool {
    crate::vault_identity::valid(id)
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

fn envelope(service: &str) -> Result<Option<Envelope>, String> {
    let Some(value) = read(service)? else { return Ok(None); };
    if value.len() > MAX_BYTES { return Err("Secure storage is too large".into()); }
    let envelope: Envelope = serde_json::from_slice(&value).map_err(|_| "Invalid secure storage format")?;
    if envelope.version != 1 { return Err("Unsupported secure storage version".into()); }
    Ok(Some(envelope))
}
fn check_identity(stored: &Envelope, installation: &str) -> Result<(), String> {
    if stored.installation != installation { return Err("Installation identity mismatch; existing vault preserved".into()); }
    Ok(())
}

/// Resolve the shipped browser identity against a durable marker in this app's container.
/// Read Keychain first: while protected data is locked we must not enroll a new identity.
#[tauri::command]
pub async fn ios_vault_identity(app: tauri::AppHandle, legacy: Option<String>, proposed: String) -> Result<String, String> {
    let _lock = VAULT_LOCK.lock().map_err(|_| "Secure storage is busy")?;
    let stored = envelope(&service(&app))?;
    let path = app.path().app_data_dir().map_err(|_| "Native app directory unavailable")?.join("ios-installation.v1");
    crate::vault_identity::load_or_create(&path, legacy.as_deref(), &proposed, stored.as_ref().map(|v| v.installation.as_str()))
}

fn scoped_service(service: &str, installation: &str) -> String { format!("{service}.{installation}") }
fn load_vault(service: &str, installation: &str) -> Result<Option<String>, String> {
    if !valid_installation(installation) { return Err("Invalid installation identifier".into()); }
    if let Some(stored) = envelope(&scoped_service(service, installation))? {
        check_identity(&stored, installation)?;
        return Ok(Some(stored.data));
    }
    // The shipped fixed record belongs only to its original identity. A reinstall starts
    // a separate vault without reading, overwriting or deleting that installation's record.
    Ok(envelope(service)?.filter(|v| v.installation == installation).map(|v| v.data))
}
fn save_vault(service: &str, installation: String, data: String) -> Result<(), String> {
    if !valid_installation(&installation) { return Err("Invalid installation identifier".into()); }
    if data.len() > MAX_BYTES { return Err("Secure storage is too large".into()); }
    let parsed: serde_json::Value = serde_json::from_str(&data).map_err(|_| "Invalid secure storage format")?;
    if parsed.get("version").and_then(|v| v.as_u64()) != Some(1) { return Err("Unsupported secure storage version".into()); }
    let scoped = scoped_service(service, &installation);
    let current = envelope(&scoped)?;
    if let Some(stored) = &current { check_identity(stored, &installation)?; }
    let legacy = envelope(service)?;
    // Keep the shipped record in place for a matching upgrade (including older native builds).
    // Fresh installations use their own service, leaving a nonmatching old record untouched.
    let target = if current.is_none() && legacy.as_ref().is_some_and(|v| v.installation == installation) { service } else { &scoped };
    let value = serde_json::to_vec(&Envelope { version: 1, installation, data }).map_err(|_| "Cannot encode secure storage")?;
    if value.len() > MAX_BYTES { return Err("Secure storage is too large".into()); }
    write(target, &value)
}

#[tauri::command]
pub async fn ios_vault_load(app: tauri::AppHandle, installation: String) -> Result<Option<String>, String> {
    let _lock = VAULT_LOCK.lock().map_err(|_| "Secure storage is busy")?;
    load_vault(&service(&app), &installation)
}
#[tauri::command]
pub async fn ios_vault_save(app: tauri::AppHandle, installation: String, data: String) -> Result<(), String> {
    let _lock = VAULT_LOCK.lock().map_err(|_| "Secure storage is busy")?;
    save_vault(&service(&app), installation, data)
}

/// Real SecItem round trip with synthetic data, isolated from the user's vault. Debug builds only.
#[cfg(debug_assertions)]
pub fn smoke_test(app: &tauri::AppHandle) {
    let service = format!("{}.smoke", service(app));
    let original_id = "00000000-0000-4000-8000-000000000001";
    let fresh_id = "00000000-0000-4000-8000-000000000002";
    let result = (|| -> Result<(), String> {
        write(&service, b"synthetic-first")?;
        if read(&service)?.as_deref() != Some(b"synthetic-first") { return Err("Keychain read mismatch".into()); }
        write(&service, b"synthetic-second")?;
        if read(&service)?.as_deref() != Some(b"synthetic-second") { return Err("Keychain update mismatch".into()); }
        remove(&service)?;
        if read(&service)?.is_some() { return Err("Keychain delete mismatch".into()); }
        let data = r#"{"version":1,"synthetic":true}"#;
        let legacy = serde_json::to_vec(&Envelope { version: 1, installation: original_id.into(), data: data.into() }).map_err(|_| "Cannot encode smoke fixture")?;
        write(&service, &legacy)?;
        if load_vault(&service, fresh_id)?.is_some() { return Err("Reinstall inherited old credentials".into()); }
        if read(&service)?.as_deref() != Some(legacy.as_slice()) { return Err("Mismatched read changed old record".into()); }
        save_vault(&service, fresh_id.into(), data.into())?;
        if read(&service)?.as_deref() != Some(legacy.as_slice()) { return Err("Fresh save changed old record".into()); }
        if load_vault(&service, original_id)?.as_deref() != Some(data) { return Err("Legacy migration read failed".into()); }
        save_vault(&service, original_id.into(), data.into())?;
        if read(&service)?.is_none() || load_vault(&service, original_id)?.as_deref() != Some(data) { return Err("Legacy identity preservation failed".into()); }
        let empty = r#"{"version":1,"reset":true}"#;
        save_vault(&service, original_id.into(), empty.into())?;
        if load_vault(&service, original_id)?.as_deref() != Some(empty) { return Err("Vault reset failed".into()); }
        Ok(())
    })();
    let _ = remove(&service);
    let _ = remove(&scoped_service(&service, original_id));
    let _ = remove(&scoped_service(&service, fresh_id));
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let value = match result { Ok(()) => serde_json::json!({"passed": true}), Err(error) => serde_json::json!({"passed": false, "error": error}) };
        let _ = std::fs::write(dir.join("keychain-smoke.json"), value.to_string());
    }
}
