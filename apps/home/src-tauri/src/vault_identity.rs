//! An app-container identity survives WebKit data loss and disappears on uninstall.
//! A mismatch is an error, never permission to delete credentials.
use std::{fs, io::{ErrorKind, Write}, path::Path};

pub fn valid(id: &str) -> bool {
    id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

pub fn load_or_create(path: &Path, legacy: Option<&str>, proposed: &str, vault: Option<&str>) -> Result<String, String> {
    let native = match fs::read_to_string(path) {
        Ok(id) if valid(&id) => Some(id),
        Ok(_) => return Err("Invalid native installation identity; existing vault preserved".into()),
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(_) => return Err("Native installation identity unavailable; unlock the phone and retry".into()),
    };
    // After an upgrade, only the shipped browser identity may enroll the existing Keychain record.
    // With neither identity, enroll a fresh, separately scoped vault; never inherit a leftover record.
    let chosen = native.as_deref().or(legacy).unwrap_or(proposed);
    if !valid(chosen) { return Err("Invalid installation identifier".into()); }
    if native.is_none() && legacy.is_some() && vault.is_some_and(|stored| stored != chosen) {
        return Err("Installation identity mismatch; existing vault preserved".into());
    }
    if native.is_none() {
        let parent = path.parent().ok_or("Invalid installation path")?;
        fs::create_dir_all(parent).map_err(|_| "Cannot open native installation directory")?;
        let pending = path.with_extension("pending");
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&pending).map_err(|_| "Cannot save native installation identity")?;
        file.write_all(chosen.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "Cannot save native installation identity")?;
        fs::rename(&pending, path).map_err(|_| "Cannot commit native installation identity")?;
    }
    Ok(chosen.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    const OLD: &str = "00000000-0000-4000-8000-000000000001";
    const NEW: &str = "00000000-0000-4000-8000-000000000002";
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self { Self(std::env::temp_dir().join(format!("wilmai-identity-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))).join("identity")) }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(self.0.parent().unwrap()); } }
    #[test]
    fn upgrades_pin_the_shipped_identity_and_webkit_loss_keeps_it() {
        let f = Fixture::new();
        assert_eq!(load_or_create(&f.0, Some(OLD), OLD, Some(OLD)).unwrap(), OLD);
        assert_eq!(load_or_create(&f.0, None, NEW, Some(OLD)).unwrap(), OLD);
        assert_eq!(load_or_create(&f.0, Some(NEW), NEW, Some(OLD)).unwrap(), OLD);
        assert_eq!(fs::read_to_string(&f.0).unwrap(), OLD);
    }
    #[test]
    fn fresh_install_does_not_inherit_a_leftover_vault_and_bad_upgrade_identity_is_rejected() {
        let f = Fixture::new();
        assert!(load_or_create(&f.0, Some(NEW), NEW, Some(OLD)).is_err());
        assert!(!f.0.exists());
        assert_eq!(load_or_create(&f.0, None, NEW, Some(OLD)).unwrap(), NEW);
        assert_eq!(load_or_create(&f.0, None, OLD, Some(OLD)).unwrap(), NEW);
    }
    #[test]
    fn unreadable_or_corrupt_native_marker_is_not_replaced() {
        let f = Fixture::new();
        fs::create_dir_all(f.0.parent().unwrap()).unwrap();
        fs::write(&f.0, "corrupt").unwrap();
        assert!(load_or_create(&f.0, Some(OLD), OLD, Some(OLD)).is_err());
        assert_eq!(fs::read_to_string(&f.0).unwrap(), "corrupt");
        fs::remove_file(&f.0).unwrap(); fs::create_dir(&f.0).unwrap();
        assert!(load_or_create(&f.0, Some(OLD), OLD, Some(OLD)).is_err());
        assert!(f.0.is_dir());
    }
}
