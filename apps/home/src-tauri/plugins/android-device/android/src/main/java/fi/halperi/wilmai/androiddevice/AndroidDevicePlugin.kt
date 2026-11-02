package fi.halperi.wilmai.androiddevice

import android.app.AlarmManager
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.ApplicationInfo
import android.content.Context
import android.content.Intent
import android.webkit.WebView
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.OnBackPressedCallback
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@TauriPlugin
class AndroidDevicePlugin(private val activity: Activity): Plugin(activity) {
    private val vault = SecureVault(activity.applicationContext)
    private val io = Executors.newSingleThreadExecutor()
    private var tap: JSObject? = null
    override fun load(webView: WebView) {
        super.load(webView)
        // Some userdebug system images expose WebViews by default even for release APKs.
        // Respect the APK's own flag instead of inheriting that system-wide default.
        WebView.setWebContentsDebuggingEnabled((activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        (activity as AppCompatActivity).onBackPressedDispatcher.addCallback(activity, object: OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.__wilmaiAndroidBack ? window.__wilmaiAndroidBack() : false") { handled ->
                    if (handled != "true") activity.moveTaskToBack(true)
                }
            }
        })
        val channel = NotificationChannel("wilmai-school", "WilmAI Home", NotificationManager.IMPORTANCE_DEFAULT)
        channel.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        (activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        RefreshBridge.plugin = WeakReference(this)
        captureTap(activity.intent)
    }
    override fun onNewIntent(intent: Intent) { captureTap(intent) }
    override fun onDestroy(activity: AppCompatActivity) {
        if (RefreshBridge.plugin.get() === this) { RefreshBridge.plugin.clear(); RefreshBridge.finish() }
        io.shutdown()
    }
    private fun captureTap(intent: Intent?) {
        if (intent?.action != Intent.ACTION_MAIN) return
        val raw = intent.getStringExtra("LocalNotficationObject") ?: return // upstream's public intent key (including typo)
        if (raw.length > 32768 || intent.getStringExtra("NotificationUserAction") != "tap") return
        try {
            val extra = JSONObject(raw).optJSONObject("extra") ?: return
            val scope = extra.optString("scope"); val view = extra.optString("view"); val item = extra.optString("item")
            if (!Regex("[a-f0-9]{32}").matches(scope) || view !in setOf("today", "inbox", "notes", "grades")) return
            if (item.isNotEmpty() && !Regex("m:[0-9]{1,16}").matches(item)) return
            tap = JSObject().put("scope", scope).put("view", view).put("item", item) as JSObject
        } catch (_: Exception) { /* Untrusted launch intents cannot become routes or URLs. */ }
    }
    private fun secure(invoke: Invoke, action: () -> Unit) {
        io.execute { try { action() } catch (_: Exception) { invoke.reject("Android secure storage is unavailable") } }
    }
    @Command fun vaultLoad(invoke: Invoke) = secure(invoke) {
        val data = vault.load(invoke.getArgs().getString("installation"))
        if (data == null) invoke.resolve() else invoke.resolveObject(data)
    }
    @Command fun vaultSave(invoke: Invoke) = secure(invoke) {
        val args = invoke.getArgs(); vault.save(args.getString("installation"), args.getString("data")); invoke.resolve()
    }
    @Command fun takeTap(invoke: Invoke) {
        val result = JSObject(); result.put("extra", tap ?: JSONObject.NULL); tap = null; invoke.resolve(result)
    }
    /** Read only IDs; platform schedule DTOs do not have a stable cross-platform JSON shape. */
    @Command fun pendingIds(invoke: Invoke) {
        val ids = activity.getSharedPreferences("NOTIFICATION_STORE", Context.MODE_PRIVATE).all.keys.mapNotNull { it.toIntOrNull() }
        invoke.resolveObject(ids)
    }
    @Command fun cancelSchedules(invoke: Invoke) {
        io.execute {
            try {
                // Android 14 cancels every alarm belonging to this app, including any orphan
                // left by a process crash between OS submission and plugin metadata persistence.
                (activity.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancelAll()
                check(activity.getSharedPreferences("NOTIFICATION_STORE", Context.MODE_PRIVATE).edit().clear().commit())
                invoke.resolve()
            } catch (_: Exception) { invoke.reject("Cannot cancel scheduled notifications") }
        }
    }
    @Command fun configure(invoke: Invoke) {
        val enabled = invoke.getArgs().getBoolean("enabled")
        activity.getSharedPreferences("wilmai-refresh", Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply()
        val work = WorkManager.getInstance(activity)
        if (enabled) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build()
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build()
            work.enqueueUniquePeriodicWork("wilmai-refresh", ExistingPeriodicWorkPolicy.KEEP, request)
        } else { work.cancelUniqueWork("wilmai-refresh"); RefreshBridge.finish() }
        invoke.resolve()
    }
    @Command fun claim(invoke: Invoke) {
        val result = JSObject(); result.put("token", RefreshBridge.claim() ?: JSONObject.NULL); invoke.resolve(result)
    }
    @Command fun complete(invoke: Invoke) { RefreshBridge.finish(invoke.getArgs().getString("token")); invoke.resolve() }
    fun requestRefresh() {
        if (!activity.isDestroyed) trigger("refresh", JSObject()) else RefreshBridge.finish()
    }
}
