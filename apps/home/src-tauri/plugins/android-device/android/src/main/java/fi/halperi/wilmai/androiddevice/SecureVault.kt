package fi.halperi.wilmai.androiddevice

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The key never leaves AndroidKeyStore; only authenticated ciphertext reaches the atomic file. */
internal class SecureVault(private val context: Context, suffix: String = "") {
    internal val file = AtomicFile(File(context.noBackupFilesDir, "wilmai-vault$suffix.bin"))
    internal val alias = "${context.packageName}.vault.v1$suffix"
    private val aad = "${context.packageName}|vault.v1".toByteArray(Charsets.UTF_8)
    private val maxBytes = 1024 * 1024
    private fun hasRecord() = file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()
    private fun unlocked() {
        check(!(context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceLocked)
    }
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (store.containsAlias(alias)) return store.getKey(alias, null) as SecretKey
        // Never replace a missing key while an encrypted record still exists.
        check(create && !hasRecord())
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true)
        // Android 12–14 have documented data-loss/biometric bugs with this flag. On those versions
        // every native operation checks Keyguard; Android's credential-encrypted app sandbox also applies.
        if (Build.VERSION.SDK_INT >= 35) spec.setUnlockedDeviceRequired(true)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(spec.build())
        }.generateKey()
    }
    private fun installation(value: String) {
        require(Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}").matches(value))
    }
    /** Authenticate the existing envelope before using its identity or replacing any data. */
    private fun envelope(): JSONObject? {
        if (!hasRecord()) return null
        val bytes = file.openRead().use { input ->
            val value = ByteArray(maxBytes + 65); var count = 0
            while (count < value.size) {
                val read = input.read(value, count, value.size - count)
                if (read < 0) break
                count += read
            }
            require(count <= maxBytes + 64); value.copyOf(count)
        }
        require(bytes.size >= 29 && bytes[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        cipher.updateAAD(aad)
        val envelope = JSONObject(String(cipher.doFinal(bytes.copyOfRange(13, bytes.size)), Charsets.UTF_8))
        require(envelope.getInt("version") == 1)
        installation(envelope.getString("installation"))
        return envelope
    }
    /** App-private noBackup data and its Keystore key are removed on uninstall, unlike WebView storage. */
    @Synchronized fun identity(legacy: String?, proposed: String): String {
        unlocked(); installation(proposed); legacy?.let { installation(it) }
        return envelope()?.getString("installation") ?: legacy ?: proposed
    }
    @Synchronized fun load(installation: String): String? {
        unlocked(); installation(installation)
        val existing = envelope() ?: return null
        check(existing.getString("installation") == installation) { "Installation identity mismatch; existing vault preserved" }
        return existing.getString("data")
    }
    @Synchronized fun save(installation: String, data: String) {
        unlocked(); installation(installation)
        require(data.toByteArray(Charsets.UTF_8).size <= maxBytes)
        require(JSONObject(data).getInt("version") == 1)
        val existing = envelope()
        check(existing == null || existing.getString("installation") == installation) { "Installation identity mismatch; existing vault preserved" }
        val clear = JSONObject().put("version", 1).put("installation", installation).put("data", data)
            .toString().toByteArray(Charsets.UTF_8)
        require(clear.size <= maxBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(aad)
        require(cipher.iv.size == 12)
        val encrypted = byteArrayOf(1) + cipher.iv + cipher.doFinal(clear)
        val output = file.startWrite()
        try { output.write(encrypted); output.fd.sync(); file.finishWrite(output) }
        catch (e: Exception) { file.failWrite(output); throw e }
        // AtomicFile can log a failed rename rather than throw. Confirm the replacement before
        // acknowledging a migration, so browser copies are not removed after a failed commit.
        check(load(installation) == data)
    }
}
