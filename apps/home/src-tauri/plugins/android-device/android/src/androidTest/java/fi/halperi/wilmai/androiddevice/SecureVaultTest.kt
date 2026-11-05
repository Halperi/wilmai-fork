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
    private val other = "00000000-0000-4000-8000-000000000002"
    private val data = "{\"version\":1,\"secret\":\"synthetic-password\"}"
    private fun isolated(test: (SecureVault) -> Unit) {
        val vault = SecureVault(context, ".synthetic-test")
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        try { vault.file.delete(); store.deleteEntry(vault.alias); test(vault) }
        finally { vault.file.delete(); store.deleteEntry(vault.alias) }
    }
    @Test fun encryptedRoundTripUsesRandomIvAndRecoversIdentityAfterWebViewLoss() = isolated { vault ->
        assertNull(vault.load(installation)); vault.save(installation, data)
        val first = vault.file.readFully()
        assertFalse(String(first, Charsets.ISO_8859_1).contains("synthetic-password"))
        assertEquals(data, vault.load(installation)); vault.save(installation, data)
        assertFalse(first.contentEquals(vault.file.readFully()))
        val committed = vault.file.readFully()
        // A fresh native object represents a restarted process, with missing or stale browser data.
        val restarted = SecureVault(context, ".synthetic-test")
        assertEquals(installation, restarted.identity(null, other))
        assertEquals(installation, restarted.identity(other, other))
        assertEquals(data, restarted.load(installation))
        assertArrayEquals("identity lookup must not rewrite ciphertext", committed, vault.file.readFully())
    }
    @Test fun mismatchedReadsAndWritesPreserveTheRecord() = isolated { vault ->
        vault.save(installation, data)
        val committed = vault.file.readFully()
        try { vault.load(other); fail("mismatched read must fail") } catch (_: IllegalStateException) { }
        try { vault.save(other, data); fail("mismatched save must fail") } catch (_: IllegalStateException) { }
        assertArrayEquals(committed, vault.file.readFully())
        assertEquals(data, vault.load(installation))
    }
    @Test fun tamperingFailsWithoutReplacingCiphertext() = isolated { vault ->
        vault.save(installation, data)
        val bytes = vault.file.readFully(); bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        vault.file.startWrite().also { it.write(bytes); vault.file.finishWrite(it) }
        try { vault.load(installation); fail("tampering must fail") } catch (_: javax.crypto.AEADBadTagException) { }
        try { vault.identity(null, other); fail("must authenticate before returning identity") } catch (_: javax.crypto.AEADBadTagException) { }
        try { vault.save(installation, data); fail("must not replace damaged record") } catch (_: javax.crypto.AEADBadTagException) { }
        assertArrayEquals(bytes, vault.file.readFully())
    }
    @Test fun lostKeyFailsWithoutReplacingTheRecord() = isolated { vault ->
        vault.save(installation, data); val bytes = vault.file.readFully()
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(vault.alias) }
        try { vault.load(installation); fail("missing key must fail") } catch (_: IllegalStateException) { }
        try { vault.identity(null, other); fail("missing key must not become a fresh identity") } catch (_: IllegalStateException) { }
        try { vault.save(installation, data); fail("must not silently replace key") } catch (_: IllegalStateException) { }
        assertFalse(store.containsAlias(vault.alias))
        assertArrayEquals(bytes, vault.file.readFully())
    }
    @Test fun freshInstallationCannotRestoreAfterAppDataAndKeyRemoval() = isolated { vault ->
        vault.save(installation, data)
        // Simulate uninstall in this isolated fixture only; never touch the real app's data or key.
        vault.file.delete()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(vault.alias) }
        val fresh = SecureVault(context, ".synthetic-test")
        assertEquals(other, fresh.identity(null, other))
        assertNull(fresh.load(other))
        assertFalse(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(vault.alias))
        fresh.save(other, data)
        assertEquals(data, fresh.load(other))
    }
    @Test fun shippedBrowserIdentityIsPreservedDuringEnrollment() = isolated { vault ->
        assertEquals(installation, vault.identity(installation, other))
        assertFalse(vault.file.baseFile.exists())
        assertFalse(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(vault.alias))
        try { vault.identity(null, "bad-id"); fail("invalid proposed identity must fail") } catch (_: IllegalArgumentException) { }
    }
}
