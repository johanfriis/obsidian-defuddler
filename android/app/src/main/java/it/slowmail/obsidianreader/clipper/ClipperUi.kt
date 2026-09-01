package it.slowmail.obsidianreader.clipper

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * The UI WebView's origin and the pages served on it (playbook M2.1, D31).
 *
 * **Why a second WebView at all.** We host upstream's extension rather than reimplementing it, and
 * an extension's popup and settings are *documents on the extension's own origin* — not script
 * injected into the visited page. Reproducing that split is what buys us the thing D20 and D21 exist
 * to work around: a page's CSP cannot reach here. `runtime.getURL` is an ordinary relative URL,
 * `style.css` is a real `<link>`, and nothing a site sends can refuse either.
 *
 * The origin is `WebViewAssetLoader`'s default, `https://appassets.androidplatform.net`. It is a
 * real https origin as far as the WebView is concerned, which matters for more than tidiness:
 * `navigator.clipboard` and other secure-context APIs are unavailable on `file://`, and upstream's
 * save path uses exactly those.
 */
object ClipperUi {

    /** Where upstream's pages live inside `assets/`; `build.mjs` writes them there. */
    private const val ASSET_DIR = "ui"

    const val ORIGIN = "https://appassets.androidplatform.net"

    /**
     * Serves the whole asset tree, with the URL path carrying the `ui/` prefix.
     *
     * `AssetsPathHandler` appends whatever follows the registered prefix to `assets/`, so mounting
     * at `/` and asking for `/ui/popup.html` resolves to `assets/ui/popup.html`. Mounting at `/ui/`
     * instead would strip the very segment the file lives under, which is a five-minute mistake to
     * make and a much longer one to diagnose from a blank page.
     */
    fun assetLoader(context: Context): WebViewAssetLoader =
        WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context.applicationContext))
            .build()

    /**
     * The clip sheet, told which page it is clipping.
     *
     * The page URL travels as a query parameter rather than an `evaluateJavascript` call after load,
     * because upstream's popup asks for tab info from its own `DOMContentLoaded` handler and would
     * win that race. `readerUrl` is upstream's own name for this — `Reader.toggleReaderPageIframe`
     * passes it the same way — so `core/popup.ts` already knows to read it.
     */
    fun clipSheetUrl(pageUrl: String, pageTitle: String): String =
        Uri.parse("$ORIGIN/$ASSET_DIR/popup.html")
            .buildUpon()
            .appendQueryParameter("readerUrl", pageUrl)
            .appendQueryParameter("pageTitle", pageTitle)
            .build()
            .toString()

    /** Upstream's settings page, which is also the template editor (D31 retired D16). */
    fun settingsUrl(): String = "$ORIGIN/$ASSET_DIR/settings.html"
}

/**
 * Page lifecycle for the UI WebView.
 *
 * Deliberately not [it.slowmail.obsidianreader.reader.ReaderWebViewClient]: that one is about a
 * hostile, arbitrary page — renderer crashes, HTTP errors it must not editorialise. This one serves
 * files we shipped, so a failure here is a build defect, not a web page misbehaving, and it should
 * be loud rather than gracefully handled.
 */
class ClipperUiWebViewClient(
    context: Context,
    private val onExternalUrl: (Uri) -> Boolean,
    private val onFinished: () -> Unit = {},
) : WebViewClient() {

    private val loader = ClipperUi.assetLoader(context)

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

    /**
     * The save path leaves through here.
     *
     * Upstream's `openObsidianUrl` ends up navigating to `obsidian://…`; anything that is not our
     * own origin is handed to [onExternalUrl], which fires the intent. **No bridge call is involved**
     * — D27's tap-only rule was retired precisely so this could be upstream's own code path.
     */
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        if (url.toString().startsWith(ClipperUi.ORIGIN)) return false
        return onExternalUrl(url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        onFinished()
    }
}
