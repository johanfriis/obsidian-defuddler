package it.slowmail.obsidianreader.reader

import android.graphics.Bitmap
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Page lifecycle for the reader WebView (playbook M1.2/M1.6).
 *
 * Only main-frame events are reported: sub-resource failures are the page's own business and a
 * blocked tracker must not put an error screen in front of an article that rendered fine.
 */
class ReaderWebViewClient(
    private val onStarted: (url: String) -> Unit,
    private val onFinished: (view: WebView) -> Unit,
    private val onFailed: (description: String) -> Unit,
    private val onRendererGone: (crashed: Boolean) -> Unit,
) : WebViewClient() {

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        onStarted(url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        onFinished(view)
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        if (request.isForMainFrame) onFailed(error.description.toString())
    }

    /**
     * The WebView's renderer process died — either it crashed, or the system reclaimed it while the
     * app was in the background.
     *
     * **Returning true is the whole point.** The documented default, for a client that does not
     * override this, is that the framework kills the *app* process. From the outside that is
     * indistinguishable from a crash, and it leaves no Java stack trace behind — which is why the
     * crash buffer can be empty after one. Handling it turns an app death into a page that says
     * what happened and offers Reload.
     *
     * The WebView is unusable afterwards either way; recovery is reloading into a fresh one.
     */
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onRendererGone(detail.didCrash())
        return true
    }

    // HTTP status errors (404, 410, 500) are deliberately *not* surfaced as our own error screen.
    // The server usually sends a real page with them, and the governing principle prefers leaving
    // Johan in front of something he can read and judge over replacing it with our verdict.
}
