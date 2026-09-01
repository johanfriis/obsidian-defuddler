package it.slowmail.obsidianreader.clipper

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import it.slowmail.obsidianreader.R

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
    fun clipSheetUrl(pageUrl: String, pageTitle: String, bridgeToken: String): String =
        Uri.parse("$ORIGIN/$ASSET_DIR/popup.html")
            .buildUpon()
            .appendQueryParameter("readerUrl", pageUrl)
            .appendQueryParameter("pageTitle", pageTitle)
            // The page WebView takes its token as a closure parameter, because a site's script
            // shares that document. Nothing foreign runs on this origin, so a query parameter is
            // enough here — and it is the only carrier available, since these pages load their own
            // script without a wrapper we could close over.
            .appendQueryParameter("bridgeToken", bridgeToken)
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

/**
 * Hands a non-`http(s)` URL to whatever app claims it — in practice always `obsidian://`.
 *
 * A4 measured that only `md.obsidian` claims the scheme on the Find N6, so there is no chooser to
 * defeat. A throw here means Obsidian is not installed, or the URI outgrew the binder limit (A3:
 * ~1 MB encoded); either way **it is reported, never rerouted** — D2.
 */
internal fun openExternally(context: Context, uri: Uri): Boolean {
    return try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (error: ActivityNotFoundException) {
        Toast.makeText(context, R.string.no_obsidian, Toast.LENGTH_LONG).show()
        android.util.Log.w("ClipSheet", "no handler for ${uri.scheme}:", error)
        true
    } catch (error: RuntimeException) {
        Toast.makeText(context, R.string.save_failed, Toast.LENGTH_LONG).show()
        android.util.Log.w("ClipSheet", "failed to open ${uri.scheme}:", error)
        true
    }
}
