# Next target: OnePlus Nord 2T 5G / Android 14

Start from the existing shared React UI, Wilma engine, account-scoped cache,
notification planner and cached AI tomorrow summary. Do not create another UI
or copy business rules into Kotlin.

1. **Secure storage first:** implement an Android Keystore-backed encrypted
   vault behind the same JS storage contract as iOS. Account isolation,
   migration, failed writes, logout/reset and reinstall behavior must pass the
   existing storage regression scenarios. Do not ship the current scrambled
   browser-secret fallback on Android.
2. **Generate and package:** Android Studio/SDK and the Rust arm64 Android target,
   Tauri Android init, a separate package ID and the existing desktop mascot as
   the adaptive app icon. Produce an APK for the owner's phone.
3. **Notifications and background work:** reuse the existing pure planner and
   official notification transport. Add Android notification permission and
   channels, and a WorkManager adapter in place of the iOS BGAppRefresh plugin.
   Keep local-only privacy defaults, stale-plan cancellation and account-bound
   taps. Android 14 denies exact-alarm permission by default for most new
   installs; prefer an approximate evening window instead of adding special
   alarm privileges. Verify Android 14 / OxygenOS battery restrictions on the physical
   phone; do not promise real-time delivery.
4. **Phone verification:** portrait/landscape, keyboard, larger system text,
   multiple accounts, offline/restart, notification taps while closed,
   lock-screen privacy, background/battery behavior and storage protection.

Security release gates are in security-review-2026-11-02.md. This document is a
plan; Android has not been generated, built or tested yet.

Platform references: [notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission), [Android 14 exact alarms](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms), [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
