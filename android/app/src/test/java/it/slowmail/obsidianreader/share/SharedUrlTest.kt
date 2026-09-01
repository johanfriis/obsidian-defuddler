package it.slowmail.obsidianreader.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * M1.1's parsing, against the shapes real apps actually send. No Android APIs are touched, so this
 * runs as a plain JVM test (`./gradlew testDebugUnitTest`).
 */
class SharedUrlTest {

    @Test
    fun `bare url`() {
        assertEquals("https://stephango.com/vault", SharedUrl.firstUrlIn("https://stephango.com/vault"))
    }

    @Test
    fun `title then url, as most apps share`() {
        assertEquals(
            "https://apnews.com/article/x",
            SharedUrl.firstUrlIn("Some headline\nhttps://apnews.com/article/x"),
        )
    }

    @Test
    fun `youtube app sends a title and a short link`() {
        assertEquals(
            "https://youtu.be/dQw4w9WgXcQ",
            SharedUrl.firstUrlIn("Watch this\n\nhttps://youtu.be/dQw4w9WgXcQ"),
        )
    }

    @Test
    fun `first url wins when there are several`() {
        assertEquals(
            "https://one.example",
            SharedUrl.firstUrlIn("https://one.example and https://two.example"),
        )
    }

    @Test
    fun `trailing sentence punctuation is trimmed`() {
        assertEquals("https://example.com/a", SharedUrl.firstUrlIn("Read https://example.com/a."))
    }

    @Test
    fun `closing brackets are kept — wikipedia depends on them`() {
        assertEquals(
            "https://en.wikipedia.org/wiki/Mercury_(planet)",
            SharedUrl.firstUrlIn("https://en.wikipedia.org/wiki/Mercury_(planet)"),
        )
    }

    @Test
    fun `http is accepted, other schemes are not`() {
        assertEquals("http://example.com", SharedUrl.firstUrlIn("http://example.com"))
        assertNull(SharedUrl.firstUrlIn("obsidian://open?vault=Sanctum"))
        assertNull(SharedUrl.firstUrlIn("ftp://example.com/file"))
    }

    @Test
    fun `no url at all`() {
        assertNull(SharedUrl.firstUrlIn("just some shared text"))
        assertNull(SharedUrl.firstUrlIn(""))
        assertNull(SharedUrl.firstUrlIn(null))
    }
}
