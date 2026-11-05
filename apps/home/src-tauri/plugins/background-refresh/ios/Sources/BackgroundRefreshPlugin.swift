import BackgroundTasks
import Tauri
import UIKit
import WebKit
import UserNotifications

private struct ConfigureArgs: Decodable { let enabled: Bool }
private struct CompleteArgs: Decodable { let token: String; let success: Bool }

/// Retain only a validated internal destination across a cold notification launch.
private final class NotificationRelay: NSObject, UNUserNotificationCenterDelegate {
  let original: UNUserNotificationCenterDelegate?
  init(original: UNUserNotificationCenterDelegate?) { self.original = original }
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completion: @escaping (UNNotificationPresentationOptions) -> Void) {
    if let original, original.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
      original.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completion)
    } else { completion([.banner, .list, .sound]) }
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completion: @escaping () -> Void) {
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
       let extra = response.notification.request.content.userInfo["__EXTRA__"] as? [String: String],
       let scope = extra["scope"], scope.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
       let view = extra["view"], ["today", "inbox", "notes", "grades"].contains(view) {
      let item = extra["item"] ?? ""
      let safe = item.range(of: "^m:[0-9]{1,16}$", options: .regularExpression) != nil ? item : ""
      UserDefaults.standard.set(["scope": scope, "view": view, "item": safe], forKey: "pendingSchoolNotificationTap")
      UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "pendingSchoolNotificationTapTime")
    }
    if let original, original.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
      original.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completion)
    } else { completion() }
  }
}

/// Gives the existing engine a bounded refresh opportunity; no credentials or networking live here.
final class BackgroundRefreshPlugin: Plugin {
  private var identifier: String { (Bundle.main.bundleIdentifier ?? "fi.halperi.wilmai.home") + ".refresh" }
  private let preference = "schoolBackgroundRefreshEnabled"
  private var task: BGAppRefreshTask?
  private var token: String?
  private var timeout: DispatchWorkItem?
  private var observer: NSObjectProtocol?
  private var storageObservers: [NSObjectProtocol] = []
  private var registered = false
  private var relay: NotificationRelay?
  private var privacy: PrivacyGuard?

  override func load(webview: WKWebView) {
    privacy = PrivacyGuard(webview: webview)
    // Visibility can precede protected-data availability. Wake JS when UIKit really unlocks it,
    // and again on activation if the notification arrived before the JS listener was ready.
    for name in [UIApplication.protectedDataDidBecomeAvailableNotification, UIApplication.didBecomeActiveNotification] {
      storageObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        try? self?.trigger("storageAvailable", data: ["available": UIApplication.shared.isProtectedDataAvailable])
      })
    }
    let center = UNUserNotificationCenter.current()
    let relay = NotificationRelay(original: center.delegate)
    self.relay = relay
    center.delegate = relay
    registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] task in
      guard let self, let refresh = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
      self.handle(refresh)
    }
    observer = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.schedule() }
  }

  private func schedule() {
    guard registered, UserDefaults.standard.bool(forKey: preference) else { return }
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
    // Scheduling is discretionary and may be unavailable (e.g. Low Power Mode).
    do { try BGTaskScheduler.shared.submit(request) } catch { }
  }

  private func finish(_ expected: String, success: Bool) {
    guard token == expected, let active = task else { return }
    timeout?.cancel(); timeout = nil; task = nil; token = nil
    active.setTaskCompleted(success: success)
  }

  private func handle(_ refresh: BGAppRefreshTask) {
    schedule()
    guard UserDefaults.standard.bool(forKey: preference), UIApplication.shared.isProtectedDataAvailable, task == nil else {
      refresh.setTaskCompleted(success: false); return
    }
    task = refresh
    let current = UUID().uuidString
    token = current
    refresh.expirationHandler = { [weak self] in DispatchQueue.main.async { self?.finish(current, success: false) } }
    let deadline = DispatchWorkItem { [weak self] in self?.finish(current, success: false) }
    timeout = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: deadline)
    // claim() also covers a cold launch whose JS listener has not registered yet.
    try? trigger("refresh", data: ["pending": true])
  }

  @objc func configure(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ConfigureArgs.self)
    UserDefaults.standard.set(args.enabled, forKey: preference)
    if args.enabled { schedule() } else {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
      if let current = token { finish(current, success: false) }
    }
    invoke.resolve(["registered": registered, "available": UIApplication.shared.backgroundRefreshStatus == .available])
  }
  @objc func privacyStatus(_ invoke: Invoke) {
    invoke.resolve(["backupExcluded": privacy?.backupExcluded ?? false, "protectedFiles": privacy?.protectedFiles ?? false, "backgroundRegistered": registered, "protectedDataAvailable": UIApplication.shared.isProtectedDataAvailable, "active": UIApplication.shared.applicationState == .active])
  }
  @objc func pendingIds(_ invoke: Invoke) {
    UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
      invoke.resolve(requests.compactMap { Int($0.identifier) })
    }
  }
  @objc func takeTap(_ invoke: Invoke) {
    let defaults = UserDefaults.standard
    let fresh = Date().timeIntervalSince1970 - defaults.double(forKey: "pendingSchoolNotificationTapTime") < 86400
    let extra = fresh ? defaults.dictionary(forKey: "pendingSchoolNotificationTap") : nil
    defaults.removeObject(forKey: "pendingSchoolNotificationTap")
    defaults.removeObject(forKey: "pendingSchoolNotificationTapTime")
    invoke.resolve(["extra": extra as Any? ?? NSNull()])
  }
  @objc func claim(_ invoke: Invoke) {
    invoke.resolve(["token": token as Any? ?? NSNull()])
  }
  @objc func complete(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CompleteArgs.self)
    finish(args.token, success: args.success)
    invoke.resolve()
  }
  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    for item in storageObservers { NotificationCenter.default.removeObserver(item) }
  }
}

@_cdecl("init_plugin_background_refresh")
func initPlugin() -> Plugin { BackgroundRefreshPlugin() }
