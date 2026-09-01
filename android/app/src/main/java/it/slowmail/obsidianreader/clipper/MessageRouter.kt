package it.slowmail.obsidianreader.clipper

import android.net.Uri
import android.util.Log
import android.webkit.WebView
import org.json.JSONObject

/**
 * Carries messages between the two WebViews (playbook M2.2, D31).
 *
 * **Why anything has to.** In the extension, the popup asks the page for its content with
 * `tabs.sendMessage`, and the background does the routing. Here the popup and the page are separate
 * WebViews with no way to reach each other: the only thing that can see both is Kotlin. So this is
 * the background's routing duty and nothing else — it neither composes notes nor builds URIs, both
 * of which stayed upstream's (D31).
 *
 * The wire format is the shim's, documented there: `request` / `response` / `event` envelopes.
 * `test/bridge.test.ts` is its executable spec, so a mismatch fails the suite rather than the phone.
 *
 * Threading: `AndroidBridge` calls arrive on the WebView's JavaBridge thread, and `evaluateJavascript`
 * must run on the main thread. Every entry point here therefore hops via [post] before touching a
 * WebView.
 */
class MessageRouter(
    private val bridgeToken: String,
    private val post: (() -> Unit) -> Unit,
    private val onOpenExternal: (Uri) -> Boolean,
    private val onOpenClipSheet: () -> Unit,
    private val onPageEvent: (JSONObject) -> Unit,
) {

    /** Set as each WebView is created; either may be absent (the sheet is not always open). */
    var pageWebView: WebView? = null
    var uiWebView: WebView? = null

    private var nextRequestId = 1
    private val awaitingPage = mutableMapOf<Int, (String?) -> Unit>()

    // --- from the UI WebView (upstream's popup / settings) --------------------

    fun fromUi(json: String) = post {
        val envelope = parse(json) ?: return@post
        if (envelope.optString("kind") != "request") return@post

        val id = envelope.optInt("id", -1)
        val message = envelope.optJSONObject("message") ?: return@post

        when (val action = message.optString("action")) {
            // The clip path. Upstream's popup is asking the page for its extracted content; the
            // inner message is what the content script expects, verbatim.
            "sendMessageToTab" -> {
                val inner = message.optJSONObject("message")
                if (inner == null) {
                    replyToUi(id, null)
                } else {
                    askPage(inner) { result -> replyToUi(id, result) }
                }
            }

            // The save. Kotlin's whole contribution is turning a URI into an intent — upstream built
            // it, and no bridge method authorises anything (D27's tap-only rule was retired for
            // exactly this).
            "openObsidianUrl" -> {
                val url = message.optString("url")
                val opened = url.isNotEmpty() && onOpenExternal(Uri.parse(url))
                replyToUi(id, JSONObject().put("success", opened).toString())
            }

            // The reader toolbar's Obsidian button (reader.ts ~L252). Upstream means "show the
            // clipper as an in-page iframe"; we open the bottom sheet instead. Redirected rather
            // than removed, because it is the one-tap clip from inside the reader — and therefore
            // the reason the shell bar could go (D33).
            "toggleIframe" -> {
                onOpenClipSheet()
                replyToUi(id, JSONObject().put("success", true).toString())
            }

            "openSettings", "openOptionsPage" -> {
                uiWebView?.loadUrl(ClipperUi.settingsUrl(bridgeToken))
                replyToUi(id, JSONObject().put("success", true).toString())
            }

            // Questions for the content script. In the extension the background forwards these to
            // the tab; here that is the same hop as `sendMessageToTab`, just without the wrapper —
            // upstream sends some actions wrapped and some bare, so both shapes have to work.
            in PAGE_ACTIONS -> askPage(message) { result -> replyToUi(id, result) }

            else -> {
                // Answer rather than ignore: upstream awaits these, and an unanswered promise is a
                // sheet that spins for the shim's full timeout with nothing to show for it.
                // `undefined` is what an extension's background returns for an unhandled action.
                Log.i(TAG, "unrouted action from UI: $action")
                replyToUi(id, null)
            }
        }
    }

    // --- from the page WebView (the reader and upstream's content script) -----

    fun fromPage(json: String) = post {
        val envelope = parse(json) ?: return@post
        when (envelope.optString("kind")) {
            "response" -> {
                val id = envelope.optInt("id", -1)
                val settle = awaitingPage.remove(id)
                if (settle == null) {
                    // Already timed out on the JS side, or never ours.
                    Log.i(TAG, "late or unknown response from page: id=$id")
                } else {
                    settle(if (envelope.isNull("result")) null else envelope.opt("result").toString())
                }
            }

            // The page talking outward: `clipperReaderApplied`, `updateHasHighlights`, and the
            // reader toolbar's `toggleIframe`. These are the messages M1 handled, now enveloped.
            "request" -> {
                val id = envelope.optInt("id", -1)
                val message = envelope.optJSONObject("message")
                if (message?.optString("action") == "toggleIframe") {
                    onOpenClipSheet()
                } else {
                    message?.let(onPageEvent)
                }
                replyToUi(id, null, target = pageWebView)
            }

            else -> parse(json)?.let(onPageEvent)
        }
    }

    // --- plumbing ------------------------------------------------------------

    private fun askPage(message: JSONObject, onResult: (String?) -> Unit) {
        val page = pageWebView
        if (page == null) {
            onResult(null)
            return
        }
        val id = nextRequestId++
        awaitingPage[id] = onResult
        val envelope = JSONObject()
            .put("kind", "request")
            .put("id", id)
            .put("message", message)
        deliver(page, envelope.toString())
    }

    private fun replyToUi(id: Int, resultJson: String?, target: WebView? = uiWebView) {
        if (id < 0) return
        val web = target ?: return
        // `result` is omitted rather than null-ed when there is none: the shim resolves the promise
        // with `undefined`, which is what upstream's callers check for.
        val envelope = StringBuilder("""{"kind":"response","id":$id""")
        if (resultJson != null) envelope.append(""","result":""").append(resultJson)
        envelope.append('}')
        deliver(web, envelope.toString())
    }

    /** `JSONObject.quote` does the JS string escaping, so no payload can break out of the call. */
    private fun deliver(web: WebView, json: String) {
        web.evaluateJavascript(
            "window.__clipper && window.__clipper.receive(${JSONObject.quote(json)})",
            null,
        )
    }

    private fun parse(json: String): JSONObject? =
        try {
            JSONObject(json)
        } catch (error: org.json.JSONException) {
            Log.w(TAG, "unparseable bridge message: ${json.take(120)}", error)
            null
        }

    private companion object {
        const val TAG = "ClipperRouter"

        /**
         * Actions upstream's content script answers (content.ts's listener). Sent bare rather than
         * inside `sendMessageToTab`, so the router has to know them by name.
         */
        val PAGE_ACTIONS = setOf(
            "ping",
            "getPageContent",
            "extractContent",
            "getHighlighterMode",
            "setHighlighterMode",
            "toggleHighlighterMode",
            "toggleHighlighter",
            "getHighlighterState",
            "getReaderModeState",
            "toggleReaderMode",
            "paintHighlights",
            "clearHighlights",
        )
    }
}
