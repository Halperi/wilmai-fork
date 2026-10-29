//! Cross-process protocol shared with wilma-cli/src/session-lock.ts.
//! A lock covers read/modify/rename, not just the final atomic rename.
use std::{path::{Path, PathBuf}, time::{Duration, Instant}};

pub struct SessionLock(PathBuf);
impl SessionLock {
    pub fn acquire(path: &Path) -> Result<Self, String> {
        Self::acquire_for(path, Duration::from_secs(5))
    }
    fn acquire_for(path: &Path, timeout: Duration) -> Result<Self, String> {
        let lock = PathBuf::from(format!("{}.lock", path.display()));
        let deadline = Instant::now() + timeout;
        loop {
            let mut builder = std::fs::DirBuilder::new();
            #[cfg(unix)] {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&lock) {
                Ok(()) => return Ok(Self(lock)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    if Instant::now() >= deadline {
                        return Err("The shared Wilma session store is locked. Close all WilmAI programs before removing its wilmai-sessions.json.lock directory after an interrupted write.".into());
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }
}
impl Drop for SessionLock {
    fn drop(&mut self) { let _ = std::fs::remove_dir(&self.0); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serializes_updates_and_releases_after_failure() {
        let root = std::env::temp_dir().join(format!("wilmai-session-lock-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("counter");
        std::fs::write(&path, "0").unwrap();
        let threads: Vec<_> = (0..8).map(|_| {
            let path = path.clone();
            std::thread::spawn(move || for _ in 0..15 {
                let _lock = SessionLock::acquire(&path).unwrap();
                let value: u32 = std::fs::read_to_string(&path).unwrap().parse().unwrap();
                std::fs::write(&path, (value + 1).to_string()).unwrap();
            })
        }).collect();
        for thread in threads { thread.join().unwrap(); }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "120");
        let lock = SessionLock::acquire(&path).unwrap();
        assert!(SessionLock::acquire_for(&path, Duration::from_millis(30)).is_err());
        drop(lock);
        assert!(SessionLock::acquire(&path).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
}
