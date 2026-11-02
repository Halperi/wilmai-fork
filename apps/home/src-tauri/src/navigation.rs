//! Block external documents in the privileged app webview, including redirects and scripted navigation.
pub fn allowed(url: &reqwest::Url, dev_origin: Option<&reqwest::Url>) -> bool {
    if !url.username().is_empty() || url.password().is_some() { return false; }
    let local = match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) => true,
        ("https" | "http", Some("tauri.localhost"), None) => true,
        _ => false,
    };
    local || dev_origin.is_some_and(|dev| url.origin() == dev.origin())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_documents_and_dangerous_schemes_cannot_enter_app_webview() {
        for value in ["https://evil.invalid/", "http://school.inschool.fi/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,test", "tauri://evil/", "tauri://localhost:99/", "tauri://user@localhost/"] {
            assert!(!allowed(&reqwest::Url::parse(value).unwrap(), None), "{value}");
        }
        for value in ["tauri://localhost/index.html#/inbox", "http://tauri.localhost/", "https://tauri.localhost/"] {
            assert!(allowed(&reqwest::Url::parse(value).unwrap(), None), "{value}");
        }
        let dev = reqwest::Url::parse("http://127.0.0.1:5197/").unwrap();
        assert!(allowed(&dev, Some(&dev)));
        assert!(!allowed(&reqwest::Url::parse("http://127.0.0.1:5198/").unwrap(), Some(&dev)));
    }
}
