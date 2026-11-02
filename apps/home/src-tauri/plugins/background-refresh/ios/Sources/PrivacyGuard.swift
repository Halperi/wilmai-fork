import Foundation
import UIKit
import WebKit

/// Cache files stay on this device, protected when locked; app-switcher snapshots contain no school data.
final class PrivacyGuard {
  private weak var webview: WKWebView?
  private var observers: [NSObjectProtocol] = []
  private var cover: UIView?
  private(set) var backupExcluded = false
  private(set) var protectedFiles = false
  init(webview: WKWebView) {
    self.webview = webview
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.hide() })
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.cover?.removeFromSuperview(); self?.cover = nil })
    DispatchQueue.global(qos: .utility).async { [weak self] in self?.harden() }
  }
  private func hide() {
    guard cover == nil, let window = webview?.window else { return }
    let view = UIView(frame: window.bounds)
    view.backgroundColor = .systemBackground
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    let label = UILabel(frame: view.bounds)
    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    label.text = "WilmAI Home"; label.textAlignment = .center; label.textColor = .label
    view.addSubview(label); window.addSubview(view); cover = view
  }
  private func harden() {
    let manager = FileManager.default
    guard let library = manager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
    var excluded = true, protected = true
    for name in ["WebKit", "Application Support", "Cookies"] {
      var root = library.appendingPathComponent(name, isDirectory: true)
      do {
        try manager.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try root.setResourceValues(values)
      } catch { excluded = false }
      do {
        try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: root.path)
        if let files = manager.enumerator(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey]) {
          for case let file as URL in files {
            // Do not follow links when changing protection attributes.
            if (try? file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true { continue }
            try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file.path)
          }
        }
      } catch { protected = false }
    }
    DispatchQueue.main.async { [weak self] in self?.backupExcluded = excluded; self?.protectedFiles = protected }
  }
  deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }
}
