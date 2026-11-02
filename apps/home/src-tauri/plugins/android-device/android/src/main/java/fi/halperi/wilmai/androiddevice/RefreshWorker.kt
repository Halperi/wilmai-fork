package fi.halperi.wilmai.androiddevice

import android.app.KeyguardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** No credentials or school data enter WorkManager. A killed process has no JS engine: skip honestly. */
internal object RefreshBridge {
    @Volatile var plugin = WeakReference<AndroidDevicePlugin>(null)
    class Ticket(val token: String = UUID.randomUUID().toString()) {
        val done = CountDownLatch(1)
        var claimed = false
    }
    private var ticket: Ticket? = null
    @Synchronized fun begin(): Ticket? {
        if (ticket != null) return null
        return Ticket().also { ticket = it }
    }
    @Synchronized fun claim(): String? = ticket?.takeUnless { it.claimed }?.also { it.claimed = true }?.token
    @Synchronized fun finish(token: String? = null) {
        if (token == null || ticket?.token == token) { ticket?.done?.countDown(); ticket = null }
    }
}
class RefreshWorker(context: Context, args: WorkerParameters): Worker(context, args) {
    override fun doWork(): Result {
        if (!applicationContext.getSharedPreferences("wilmai-refresh", Context.MODE_PRIVATE).getBoolean("enabled", false)) return Result.success()
        if ((applicationContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceLocked) return Result.success()
        val plugin = RefreshBridge.plugin.get() ?: return Result.success()
        val ticket = RefreshBridge.begin() ?: return Result.success()
        return try {
            Handler(Looper.getMainLooper()).post { plugin.requestRefresh() }
            ticket.done.await(25, TimeUnit.SECONDS)
            Result.success()
        } finally { RefreshBridge.finish(ticket.token) }
    }
}
