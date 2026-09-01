package it.slowmail.obsidianreader.reader

import android.content.SharedPreferences
import android.util.Log
import android.webkit.JavascriptInterface
import androidx.core.content.edit
import org.json.JSONArray

/**
 * The Kotlin half of the shim's `browser.storage` and `browser.runtime` (playbook M1.3, §4).
 *
 * **Why every method takes a token.** `addJavascriptInterface` attaches this object to the main
 * world of *every* page the WebView loads, so a hostile page's own script can call it exactly as
 * our bundle does. minSdk 31 means only `@JavascriptInterface` methods are reachable — there is no
 * reflection path — so the exposure is bounded to what is written here; but what is written here
 * grows a save-to-vault path in M2, and a page that can silently rewrite settings or fake a
 * message is a page that can steer a save. The token is generated per activity and handed to the
 * bundle as a closure parameter (see `ClipperBundle.injectionScript`), so it never lands on
 * `window` where page script could read it back.
 *
 * The residual, recorded rather than papered over: page script can still reach anything exposed on
 * `window.__clipper`, which includes our own storage and `sendMessage`. **M2 must therefore never
 * treat an inbound message as authorisation to save** — the save is initiated by a tap on this
 * side.
 *
 * Threading: WebView calls these on its own JavaBridge thread, not the main thread.
 * SharedPreferences is safe there; [onMessage] is not, so it is posted back to the caller's
 * chosen dispatcher rather than invoked here.
 */
class AndroidBridge(
    private val token: String,
    private val prefs: SharedPreferences,
    private val onMessage: (json: String) -> Unit,
) {

    private fun authorize(candidate: String?) {
        if (candidate != token) {
            // Loud on purpose: in normal operation this cannot happen, so if it ever does it is
            // either a page probing the interface or our own injection wrapper being wrong.
            Log.w(TAG, "rejected a bridge call with a bad token")
            throw SecurityException("clipper bridge: bad token")
        }
    }

    /** Areas share one preferences file; the area is a key prefix. `session` never reaches here. */
    private fun keyFor(area: String, key: String) = "$area:$key"

    @JavascriptInterface
    fun getItem(token: String?, area: String, key: String): String? {
        authorize(token)
        return prefs.getString(keyFor(area, key), null)
    }

    @JavascriptInterface
    fun setItem(token: String?, area: String, key: String, json: String) {
        authorize(token)
        prefs.edit { putString(keyFor(area, key), json) }
    }

    @JavascriptInterface
    fun removeItem(token: String?, area: String, key: String) {
        authorize(token)
        prefs.edit { remove(keyFor(area, key)) }
    }

    /** Backs `storage.get(null)`, which upstream uses to read a whole area at once. */
    @JavascriptInterface
    fun keys(token: String?, area: String): String {
        authorize(token)
        val prefix = "$area:"
        val out = JSONArray()
        for (key in prefs.all.keys) if (key.startsWith(prefix)) out.put(key.removePrefix(prefix))
        return out.toString()
    }

    @JavascriptInterface
    fun clear(token: String?, area: String) {
        authorize(token)
        val prefix = "$area:"
        prefs.edit { for (key in prefs.all.keys) if (key.startsWith(prefix)) remove(key) }
    }

    /** Events up. The eight actions the reader can send are listed in the shim; most belong to
     *  milestones that have not landed, so unhandled ones are logged rather than dropped. */
    @JavascriptInterface
    fun postMessage(token: String?, json: String) {
        authorize(token)
        onMessage(json)
    }

    companion object {
        const val NAME = "AndroidBridge"
        const val PREFS_FILE = "clipper-storage"
        private const val TAG = "ClipperBridge"
    }
}
