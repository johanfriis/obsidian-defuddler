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
     *
     * `darkMode` is the app's own theme. The reader's "auto" appearance would otherwise ask the
     * WebView via `prefers-color-scheme`, which cannot answer honestly unless algorithmic darkening
     * is enabled — and that mangles raw pages (see ReaderActivity's WebView setup). Telling the
     * reader directly keeps both surfaces right.
     */
    fun injectionScript(context: Context, bridgeToken: String, darkMode: Boolean): String =
        "(function (__clipperBridgeToken, __clipperDarkMode) {\n" +
            source(context) +
            "\n})(" + JSONObject.quote(bridgeToken) + ", " + darkMode + ");" +
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

    /**
     * Debug-only layout probe (M1.8 follow-up). Reports how the page actually laid itself out, so a
     * complaint like "YouTube renders badly" is diagnosed with numbers rather than guesses — the
     * same discipline as G0's B3 probe. Read it with `just log`.
     */
    const val LAYOUT_PROBE_JS = """
(function () {
  try {
    var vp = document.querySelector('meta[name="viewport"]');
    var de = document.documentElement;
    return JSON.stringify({
      innerWidth: window.innerWidth,
      outerWidth: window.outerWidth,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      bodyScrollWidth: document.body ? document.body.scrollWidth : -1,
      dpr: window.devicePixelRatio,
      visualViewport: window.visualViewport ? Math.round(window.visualViewport.width) : -1,
      viewportMeta: vp ? vp.getAttribute('content') : '(none)',
      prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      htmlBg: getComputedStyle(de).backgroundColor,
      bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : '(no body)',
      bodyColor: document.body ? getComputedStyle(document.body).color : '(no body)'
    });
  } catch (e) { return 'PROBE THREW: ' + e; }
})()
"""

    /** Direct read of the same fact, for a timeout path that cannot wait for the message. */
    const val READER_RENDERED_JS = "(!!window.__clipper && window.__clipper.rendered())"
}
