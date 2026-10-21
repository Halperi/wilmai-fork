//! The app around the window: it lives in the menu bar, so it keeps checking
//! Wilma and can notify while the window is closed. Closing the window hides
//! it (and the Dock icon); the menu bar icon, the Dock or a notification
//! brings it back. Quit is in the menu bar menu (and ⌘Q while the window
//! shows).

use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

/// How often the page is woken to check Wilma, shown or not: a hidden web
/// view's own timers are slowed down by macOS, events from here aren't.
const TICK: Duration = Duration::from_secs(10 * 60);

/// The menu bar menu's items, to put them in the app's language (`tray_labels`).
pub struct Tray {
    open: MenuItem<Wry>,
    check: MenuItem<Wry>,
    update: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open WilmAI Home", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", "Check Wilma now", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Check for app updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit WilmAI Home", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &check, &update, &PredefinedMenuItem::separator(app)?, &quit])?;
    TrayIconBuilder::with_id("main")
        // The mascot's head and antenna, simplified at 44px for an 18pt menu bar mark.
        // Transparent face cutouts let macOS tint the template in either appearance.
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("WilmAI Home")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "check" => {
                let _ = app.emit("wilmai:check", ());
            }
            "update" => { show(app); let _ = app.emit("wilmai:update", ()); }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    app.manage(Tray { open, check, update, quit });

    // Notifications come from this app (the library would otherwise say they're from Finder).
    #[cfg(target_os = "macos")]
    {
        let _ = mac_notification_sys::set_application(&app.config().identifier);
    }

    // WILMAI_NOTIFY_TEST=1: one notification at start, to see that notifications reach this Mac (a test build).
    if std::env::var_os("WILMAI_NOTIFY_TEST").is_some() {
        let _ = notify(app.handle().clone(), "WilmAI Home".into(), "Notifications work.".into(), None);
    }

    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
        let _ = handle.emit("wilmai:tick", ());
    });
    Ok(())
}

/// Bring the window back (and the Dock icon with it).
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Closing the window hides it: the app goes on in the menu bar.
pub fn hide<R: Runtime>(window: &tauri::Window<R>) {
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window.app_handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// The menu bar menu in the app's language.
#[tauri::command]
pub fn tray_labels(tray: tauri::State<'_, Tray>, open: String, check: String, update: String, quit: String) {
    let _ = tray.open.set_text(open);
    let _ = tray.check.set_text(check);
    let _ = tray.update.set_text(update);
    let _ = tray.quit.set_text(quit);
}

/// Beside the menu bar icon: how many things need the parent, "!" when the app needs signing in ("": nothing).
#[tauri::command]
pub fn tray_title(app: AppHandle, title: String) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
}

/// Bring the window up (the menu bar's "Sign in to Wilma…").
#[tauri::command]
pub fn show_main(app: AppHandle) {
    show(&app);
}

/// A notification; clicking it opens the window on `key` (an item of the app).
/// It waits for the click on a thread of its own, so nothing here blocks.
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String, key: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::thread::spawn(move || {
        let response = mac_notification_sys::Notification::new()
            .title(&title)
            .message(&body)
            .default_sound()
            .wait_for_click(true)
            .send();
        if let Ok(mac_notification_sys::NotificationResponse::Click) = response {
            show(&app);
            if let Some(key) = key {
                let _ = app.emit("wilmai:open", key);
            }
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = (app, title, body, key);
    Ok(())
}
