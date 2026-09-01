package it.slowmail.obsidianreader.reader

import android.content.Context

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
     * The bundle is an IIFE evaluating to `undefined`; the trailing probe makes the
     * `evaluateJavascript` callback carry a verdict instead of `null`.
     */
    fun injectionScript(context: Context): String =
        source(context) + "\n;(typeof window.__clipper);"

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
     * Whether the reader actually rendered.
     *
     * Deliberately *not* the `obsidian-reader-active` class: `Reader.apply` catches its own errors,
     * so on a page where extraction dies (G0 found this on Trusted Types pages before D21) the
     * class is still set while nothing was built. The container element only exists if apply got
     * far enough to construct the reader, which is the thing worth reporting.
     */
    const val READER_RENDERED_JS =
        "(!!document.querySelector('.obsidian-reader-container'))"
}
