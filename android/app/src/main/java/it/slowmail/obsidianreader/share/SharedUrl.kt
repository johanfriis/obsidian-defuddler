package it.slowmail.obsidianreader.share

import android.content.Intent

/**
 * Pulls the shared link out of an `ACTION_SEND` intent (playbook M1.1).
 *
 * Apps are inconsistent about what they put in `EXTRA_TEXT`: some send a bare URL, most send
 * `"Title\nURL"`, and the YouTube app sends a title plus a `youtu.be` short link. So we scan for
 * the first `http(s)` URL rather than assuming the extra *is* one.
 *
 * Deliberately free of Android APIs below `Intent` so the parsing is covered by a plain JVM test.
 */
object SharedUrl {

    private val URL_PATTERN = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)

    /** Trailing sentence punctuation, for links pasted mid-prose. Brackets are deliberately not
     *  trimmed — Wikipedia's `..._(disambiguation)` would lose its closing paren. */
    private const val TRAILING = ".,;:!?”’"

    fun from(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_SEND) return null
        return firstUrlIn(intent.getCharSequenceExtra(Intent.EXTRA_TEXT))
    }

    /** The `EXTRA_SUBJECT` some apps send alongside the link. Only a hint; the page's own title wins. */
    fun titleHintFrom(intent: Intent?): String? =
        intent?.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()?.takeIf { it.isNotEmpty() }

    fun firstUrlIn(text: CharSequence?): String? {
        val found = URL_PATTERN.find(text ?: return null)?.value ?: return null
        val trimmed = found.trimEnd { it in TRAILING }
        // "https://" on its own is a match but not a page.
        return trimmed.takeIf { it.substringAfter("://").isNotEmpty() }
    }
}
