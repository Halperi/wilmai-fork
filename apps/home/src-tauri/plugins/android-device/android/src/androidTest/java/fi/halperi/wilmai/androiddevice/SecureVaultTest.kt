package fi.halperi.wilmai.androiddevice

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore

@RunWith(AndroidJUnit4::class)
class SecureVaultTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val installation = "00000000-0000-4000-8000-000000000001"
    private val data = "{\"version\":1,\"secret\":\"synthetic-password\"}"
    private fun isolated(test: (SecureVault) -> Unit) {
        val vault = SecureVault(context, ".synthetic-test")
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        try { vault.file.delete(); store.deleteEntry(vault.alias); test(vault) }
        finally { vault.file.delete(); store.deleteEntry(vault.alias) }
    }
    @Test fun encryptedRoundTripUsesRandomIvAndReinstallCannotRestore() = isolated { vault ->
        assertNull(vault.load(installation)); vault.save(installation, data)
        val first = vault.file.readFully()
        assertFalse(String(first, Charsets.ISO_8859_1).contains("synthetic-password"))
        assertEquals(data, vault.load(installation)); vault.save(installation, data)
        assertFalse(first.contentEquals(vault.file.readFully()))
        assertNull(vault.load("00000000-0000-4000-8000-000000000002"))
    }
    @Test fun tamperingFailsWithoutReplacingCiphertext() = isolated { vault ->
        vault.save(installation, data)
        val bytes = vault.file.readFully(); bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        vault.file.startWrite().also { it.write(bytes); vault.file.finishWrite(it) }
        try { vault.load(installation); fail("tampering must fail") } catch (_: javax.crypto.AEADBadTagException) { }
        assertArrayEquals(bytes, vault.file.readFully())
    }
    @Test fun lostKeyFailsWithoutReplacingTheRecord() = isolated { vault ->
        vault.save(installation, data); val bytes = vault.file.readFully()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(vault.alias) }
        try { vault.load(installation); fail("missing key must fail") } catch (_: IllegalStateException) { }
        try { vault.save(installation, data); fail("must not silently replace key") } catch (_: IllegalStateException) { }
        assertArrayEquals(bytes, vault.file.readFully())
    }
}
