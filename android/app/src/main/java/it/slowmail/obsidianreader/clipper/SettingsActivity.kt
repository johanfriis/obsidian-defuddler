package it.slowmail.obsidianreader.clipper

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import it.slowmail.obsidianreader.reader.AndroidBridge
import it.slowmail.obsidianreader.ui.ClipperTheme
import java.util.UUID

/**
 * Upstream's settings page, including its template editor (playbook M2.6, D31 — this is what
 * retired D16).
 *
 * **Why it has its own activity.** The gear inside the clip sheet already reaches these settings,
 * but only once a sheet is open over some page. That makes settings unreachable if a page will not
 * load — and the vault name and templates live here, so it is a bad thing to be locked out of. The
 * launcher screen has no other job (the app is driven from the share sheet), so it is the natural
 * second door.
 *
 * There is no page WebView here, so [MessageRouter] answers `sendMessageToTab` with nothing — which
 * is correct: no page is being clipped from this screen.
 */
class SettingsActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences(AndroidBridge.PREFS_FILE, Context.MODE_PRIVATE)
        val token = UUID.randomUUID().toString()
        val handler = Handler(Looper.getMainLooper())

        setContent {
            ClipperTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val context = LocalContext.current
                    AndroidView(
                        modifier = Modifier.fillMaxSize().safeDrawingPadding(),
                        factory = { ctx ->
                            val router = MessageRouter(
                                bridgeToken = token,
                                post = { block -> handler.post(block) },
                                onOpenExternal = { uri -> openExternally(ctx, uri) },
                                onOpenClipSheet = { /* nothing to clip from here */ },
                                onPageEvent = { },
                            )
                            WebView(ctx).apply {
                                // Compose measures an AndroidView child from its LayoutParams, and
                                // a WebView defaults to WRAP_CONTENT, which reaches Chromium as an
                                // unbounded height: `vh` units then resolve to **zero** while
                                // `innerHeight` still reports the real number. Upstream sizes this
                                // whole page with `height: 100vh` (settings.scss ~L36), so every
                                // container collapsed and the page painted its background and
                                // nothing else.
                                layoutParams = ViewGroup.LayoutParams(
                                    ViewGroup.LayoutParams.MATCH_PARENT,
                                    ViewGroup.LayoutParams.MATCH_PARENT,
                                )
                                @SuppressLint("SetJavaScriptEnabled")
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                addJavascriptInterface(
                                    AndroidBridge(token, prefs) { json -> router.fromUi(json) },
                                    AndroidBridge.NAME,
                                )
                                webViewClient = ClipperUiWebViewClient(
                                    context = ctx,
                                    onExternalUrl = { uri -> openExternally(ctx, uri) },
                                )
                                webChromeClient = object : WebChromeClient() {
                                    override fun onConsoleMessage(
                                        m: android.webkit.ConsoleMessage,
                                    ): Boolean {
                                        android.util.Log.i(
                                            "ClipperUi",
                                            "${m.messageLevel()} ${m.message()} " +
                                                "(${m.sourceId()}:${m.lineNumber()})",
                                        )
                                        return true
                                    }
                                }
                                router.uiWebView = this
                                loadUrl(ClipperUi.settingsUrl(token))
                            }
                        },
                        onRelease = { it.destroy() },
                    )
                }
            }
        }
    }

    companion object {
        fun intent(context: Context) = Intent(context, SettingsActivity::class.java)
    }
}
