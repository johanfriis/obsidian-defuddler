package it.slowmail.obsidianreader.reader

import android.graphics.Bitmap
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
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

    // HTTP status errors (404, 410, 500) are deliberately *not* surfaced as our own error screen.
    // The server usually sends a real page with them, and the governing principle prefers leaving
    // Johan in front of something he can read and judge over replacing it with our verdict.
}
