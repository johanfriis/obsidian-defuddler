package it.slowmail.obsidianreader.clipper

import android.annotation.SuppressLint
import android.content.SharedPreferences
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import it.slowmail.obsidianreader.reader.AndroidBridge

/**
 * Upstream's clip sheet, hosted (playbook M2.1, D31).
 *
 * There is deliberately almost nothing here. The sheet's contents — template dropdown, note name,
 * typed properties, body, folder, "Add to Obsidian" — are upstream's `popup.html`, and the note
 * composition and `obsidian://` URI are upstream's `obsidian-note-creator.ts`. What Kotlin
 * contributes is a container, an origin, and an intent.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClipSheet(
    pageUrl: String,
    pageTitle: String,
    bridgeToken: String,
    prefs: SharedPreferences,
    router: MessageRouter,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val dismiss = rememberUpdatedState(onDismiss)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        AndroidView(
            modifier = Modifier.fillMaxWidth().fillMaxHeight(0.9f),
            factory = { ctx ->
                WebView(ctx).apply {
                    @SuppressLint("SetJavaScriptEnabled")
                    settings.javaScriptEnabled = true
                    // Upstream's pages are ordinary files on our own origin, so unlike the page
                    // WebView this one needs no bundle injection, no CSP workarounds and no
                    // Chrome-mobile UA. It is closer to a normal app WebView than to a browser.
                    settings.domStorageEnabled = true

                    // The same bridge and the same preferences file as the page WebView, because
                    // in an extension there is one `browser.storage` and both documents see it —
                    // the Aa panel's reader settings and the popup's templates are one store.
                    addJavascriptInterface(
                        AndroidBridge(bridgeToken, prefs) { json -> router.fromUi(json) },
                        AndroidBridge.NAME,
                    )

                    webViewClient = ClipperUiWebViewClient(
                        context = ctx,
                        onExternalUrl = { uri -> openExternally(ctx, uri) },
                    )

                    // M2.0 finding: upstream's popup calls window.close() after a successful clip.
                    // Without this the save works and the sheet stays on screen, dead.
                    webChromeClient = object : WebChromeClient() {
                        override fun onCloseWindow(window: WebView) {
                            dismiss.value()
                        }

                        // Upstream's UI reports its own failures to the console and nowhere else —
                        // "Web Clipper was not able to start" on screen can mean half a dozen
                        // things. Mirroring it to logcat is what makes `just log` enough to
                        // diagnose this WebView without attaching chrome://inspect every time.
                        override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                            android.util.Log.i(
                                "ClipperUi",
                                "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})",
                            )
                            return true
                        }
                    }

                    router.uiWebView = this
                    loadUrl(ClipperUi.clipSheetUrl(pageUrl, pageTitle, bridgeToken))
                }
            },
            onRelease = { web ->
                // The router outlives the sheet; leaving a destroyed WebView on it would make the
                // next reply crash instead of being dropped.
                if (router.uiWebView === web) router.uiWebView = null
                web.destroy()
            },
        )
    }
}
