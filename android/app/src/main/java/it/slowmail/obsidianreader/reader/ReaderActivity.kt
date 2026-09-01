package it.slowmail.obsidianreader.reader

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import it.slowmail.obsidianreader.BuildConfig
import it.slowmail.obsidianreader.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Renders a shared link and, on a tap, hands it to the vendored reader (playbook M1.2/M1.6).
 *
 * Two rules from the decisions log shape this screen:
 *  - **D24** — the page loads and renders normally; the reader is a tap, never automatic.
 *  - **D23/D25** — the only chrome is a slim bottom bar (`Reader`, `Reload`; `Clip` arrives in M2).
 *    No URL bar, no back/forward buttons, no tabs.
 *
 * G0 landmine (§2): page/note content must never enter saved instance state — a large payload in a
 * `rememberSaveable` killed the Spike A harness with `TransactionTooLargeException` *after* a
 * successful save, which reads as a save failure but isn't. Nothing here is saveable.
 */
class ReaderActivity : ComponentActivity() {

    companion object {
        private const val EXTRA_URL = "it.slowmail.obsidianreader.extra.URL"
        private const val EXTRA_TITLE_HINT = "it.slowmail.obsidianreader.extra.TITLE_HINT"

        fun intentFor(context: Context, url: String, titleHint: String?): Intent =
            Intent(context, ReaderActivity::class.java).apply {
                putExtra(EXTRA_URL, url)
                titleHint?.let { putExtra(EXTRA_TITLE_HINT, it) }
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val url = intent.getStringExtra(EXTRA_URL)
        if (url.isNullOrBlank()) {
            finish()
            return
        }

        // chrome://inspect against the phone is the primary tool for all Layer B work (§14).
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        CookieManager.getInstance().setAcceptCookie(true)

        setContent {
            MaterialTheme {
                Surface {
                    ReaderScreen(url = url, onDone = { finish() })
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        // Login sessions have to survive a relaunch (M1.2), and the cookie store is only durable
        // once flushed.
        CookieManager.getInstance().flush()
    }
}

/**
 * Current Chrome-mobile UA with no `; wv` token — sites that treat WebViews differently (or block
 * them outright) see a normal mobile Chrome. A settings override lands with the rest of settings
 * in M2.4.
 */
private const val CHROME_MOBILE_UA =
    "Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/140.0.0.0 Mobile Safari/537.36"

/** How long to wait for `Reader.apply` to build its container before calling the toggle failed. */
private const val READER_RENDER_TIMEOUT_MS = 10_000L

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ReaderScreen(url: String, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var webView by remember { mutableStateOf<WebView?>(null) }
    var progress by remember { mutableStateOf(0) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var readerActive by remember { mutableStateOf(false) }
    var toggleInFlight by remember { mutableStateOf(false) }

    fun loadFresh(target: String) {
        loadError = null
        readerActive = false
        webView?.loadUrl(target)
    }

    fun toggleReader() {
        val web = webView ?: return
        if (toggleInFlight) return
        toggleInFlight = true
        scope.launch {
            try {
                when (val outcome = web.evaluate(ClipperBundle.TOGGLE_JS).unquote()) {
                    "applying" -> {
                        val rendered = web.awaitReaderRendered()
                        readerActive = rendered
                        if (!rendered) {
                            // Honest failure beats a button that lies about its state (D2's spirit).
                            Toast.makeText(context, R.string.reader_failed, Toast.LENGTH_LONG).show()
                        }
                    }
                    // Upstream restores the page by reloading it; onPageStarted resets the rest.
                    "restoring" -> readerActive = false
                    else -> {
                        Toast.makeText(context, R.string.reader_failed, Toast.LENGTH_LONG).show()
                        android.util.Log.w("Reader", "toggle -> $outcome")
                    }
                }
            } finally {
                toggleInFlight = false
            }
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize().safeDrawingPadding(),
        bottomBar = {
            ShellBar(
                readerActive = readerActive,
                enabled = webView != null && loadError == null && !toggleInFlight,
                onToggleReader = ::toggleReader,
                // A full reload. Also the recovery for a reader tapped before the page settled
                // (D26): reload, wait, tap Reader again.
                onReload = { webView?.let { loadFresh(it.url ?: url) } },
            )
        },
    ) { insets ->
        Box(Modifier.fillMaxSize().padding(insets)) {
            val error = loadError
            if (error != null) {
                LoadErrorPane(error) { loadFresh(url) }
            } else {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.userAgentString = CHROME_MOBILE_UA
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                            webChromeClient = object : WebChromeClient() {
                                override fun onProgressChanged(view: WebView, newProgress: Int) {
                                    progress = newProgress
                                }
                            }
                            webViewClient = ReaderWebViewClient(
                                onStarted = {
                                    // A new document: whatever the reader did to the old one is gone.
                                    readerActive = false
                                    loadError = null
                                },
                                onFinished = { view ->
                                    // Inject, never toggle (D24). Idempotent — the bundle's own
                                    // guard held across the four onPageFinished calls github fired
                                    // for a single navigation (G0/B3).
                                    view.evaluateJavascript(
                                        ClipperBundle.injectionScript(ctx),
                                    ) { result ->
                                        if (result.unquote() != "object") {
                                            android.util.Log.w("Reader", "bundle injection -> $result")
                                        }
                                    }
                                },
                                onFailed = { description -> loadError = description },
                            )
                            webView = this
                            loadUrl(url)
                        }
                    },
                )
                if (progress in 1..99) {
                    LinearProgressIndicator(
                        progress = { progress / 100f },
                        modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter),
                    )
                }
            }
        }
    }

    // System Back walks the WebView's own history where there is any, then leaves. That is an OS
    // gesture rather than chrome, so D23 is untouched — there are no back/forward buttons.
    BackHandler {
        val web = webView
        if (web != null && web.canGoBack()) web.goBack() else onDone()
    }
}

/**
 * The whole of the app's chrome (D25). Present in both states, because `Reload` is as useful on a
 * half-broken raw page as it is on a reader view.
 */
@Composable
private fun ShellBar(
    readerActive: Boolean,
    enabled: Boolean,
    onToggleReader: () -> Unit,
    onReload: () -> Unit,
) {
    Column {
        HorizontalDivider()
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Filled while the reader owns the page, so the bar says which of the two views is on
            // screen without needing a label that changes meaning.
            if (readerActive) {
                FilledTonalButton(onClick = onToggleReader, enabled = enabled) {
                    Text(stringResource(R.string.action_reader))
                }
            } else {
                TextButton(onClick = onToggleReader, enabled = enabled) {
                    Text(stringResource(R.string.action_reader))
                }
            }
            TextButton(onClick = onReload, enabled = enabled) {
                Text(stringResource(R.string.action_reload))
            }
            // `Clip` joins these in M2 (D25).
        }
    }
}

@Composable
private fun LoadErrorPane(description: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.load_failed_title),
            style = MaterialTheme.typography.titleMedium,
        )
        Text(description, style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onRetry) { Text(stringResource(R.string.action_retry)) }
    }
}

/** `evaluateJavascript` as a suspend call. Must be called from the main thread, which every
 *  `rememberCoroutineScope()` launch is. */
private suspend fun WebView.evaluate(js: String): String? =
    suspendCancellableCoroutine { continuation ->
        evaluateJavascript(js) { result -> continuation.resume(result) }
    }

/**
 * Waits for `Reader.apply` to actually build its container.
 *
 * Polling rather than a callback because the reader's completion signal only reaches Kotlin once
 * the AndroidBridge exists (M1.3). `Reader.toggle` cannot be awaited: turning the reader off it
 * returns a promise that never resolves by design.
 */
private suspend fun WebView.awaitReaderRendered(): Boolean {
    val deadline = SystemClock.uptimeMillis() + READER_RENDER_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
        delay(150)
        if (evaluate(ClipperBundle.READER_RENDERED_JS) == "true") return true
    }
    return false
}

/** `evaluateJavascript` hands back JSON; unwrap the string case these snippets return. */
private fun String?.unquote(): String =
    this?.removeSurrounding("\"")?.replace("\\\"", "\"") ?: "null"
