package it.slowmail.obsidianreader.reader

import android.content.Context
import org.json.JSONObject

/**
 * The JS half of Layer B: the built `clipper-bundle.js` asset plus the small snippets Kotlin uses
 * to drive it (playbook M1.6, §4).
 *
 * G0/B3 measured `evaluateJavascript` handling the ~2 MB bundle in 42–222 ms, so it is injected
 * whole on every `onPageFinished` — no asset server, no chunking. The bundle guards itself with
 * `window.obsidianReaderInitialized`, which held across the four `onPageFinished` calls github
 * fired for one navigation.
 */
object ClipperBundle {

    private const val ASSET = "clipper-bundle.js"

    @Volatile
    private var cached: String? = null

    /**
     * Reads the asset once per process. B3 measured the read at 20–40 ms; SPA pages fire
     * `onPageFinished` several times per navigation, so re-reading it each time is pure waste.
     */
    fun source(context: Context): String =
        cached ?: synchronized(this) {
            cached ?: context.applicationContext.assets
                .open(ASSET)
                .bufferedReader()
                .use { it.readText() }
                .also { cached = it }
        }

    /**
     * The bundle, wrapped so the shim receives its bridge token as a closure parameter.
     *
     * The wrapper is the whole security story of [AndroidBridge]: a page can read any global we
     * set, but not a closure variable, so the token cannot be recovered by page script and the
     * bridge refuses calls without it. The bundle is an IIFE evaluating to `undefined`, so a
     * trailing probe makes the `evaluateJavascript` callback carry a verdict instead of `null`.
     */
    fun injectionScript(context: Context, bridgeToken: String): String =
        "(function (__clipperBridgeToken) {\n" +
            source(context) +
            "\n})(" + JSONObject.quote(bridgeToken) + ");" +
            "\n;(typeof window.__clipper);"

    /**
     * Toggles the reader, reporting synchronously which direction it went.
     *
     * `Reader.toggle` is async and — turning the reader *off* — deliberately returns a promise that
     * never resolves, because upstream restores the page with `window.location.reload()` and does
     * not want further DOM edits flashing before the reload lands. So Kotlin must never await this;
     * it returns immediately and the caller confirms by other means (see [READER_RENDERED_JS]).
     */
    const val TOGGLE_JS = """
(function () {
  if (!window.__clipper) return 'no-bundle';
  var wasActive = window.__clipper.isActive();
  try {
    window.__clipper.toggle();
  } catch (e) {
    return 'threw: ' + e;
  }
  return wasActive ? 'restoring' : 'applying';
})()
"""

    /**
     * The action the bundle posts when `Reader.apply` finishes, carrying `rendered` — whether the
     * reader really built its container, as opposed to merely having been asked to. Upstream only
     * announces the *off* direction, and `apply` swallows its own errors, so this is ours.
     */
    const val ACTION_READER_APPLIED = "clipperReaderApplied"

    /** Direct read of the same fact, for a timeout path that cannot wait for the message. */
    const val READER_RENDERED_JS = "(!!window.__clipper && window.__clipper.rendered())"
}
