package it.slowmail.obsidianreader.reader

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Icon
import androidx.compose.material3.SmallFloatingActionButton
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
import androidx.compose.ui.draw.rotate
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import it.slowmail.obsidianreader.BuildConfig
import it.slowmail.obsidianreader.clipper.ClipSheet
import it.slowmail.obsidianreader.clipper.MessageRouter
import it.slowmail.obsidianreader.clipper.openExternally
import it.slowmail.obsidianreader.R
import it.slowmail.obsidianreader.ui.ClipperTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.UUID
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
            ClipperTheme {
                Surface {
                    ReaderScreen(
                        url = url,
                        prefs = getSharedPreferences(AndroidBridge.PREFS_FILE, MODE_PRIVATE),
                        onDone = { finish() },
                    )
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
 * them outright) see a normal mobile Chrome. `Android 10; K` is deliberate: Chrome's reduced UA
 * freezes exactly that pair on every device and OS version, so any other value is a string no
 * real Chrome sends — a fingerprint, not a disguise. A settings override lands with the rest of
 * settings in M2.4.
 */
private const val CHROME_MOBILE_UA =
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/140.0.0.0 Mobile Safari/537.36"

/** How long to wait for the bundle's `clipperReaderApplied` message before giving up on it and
 *  asking the page directly. Extraction on a heavy page is seconds, not tens of seconds. */
private const val READER_APPLIED_TIMEOUT_MS = 15_000L

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ReaderScreen(url: String, prefs: SharedPreferences, onDone: () -> Unit) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val mainHandler = remember { Handler(Looper.getMainLooper()) }
    val scope = rememberCoroutineScope()

    var webView by remember { mutableStateOf<WebView?>(null) }
    // One token per activity, handed to the bundle as a closure parameter so page script cannot
    // read it back off `window`. See AndroidBridge's class comment.
    val bridgeToken = remember { UUID.randomUUID().toString() }
    // Handed to the bundle so the reader's "auto" appearance follows the app instead of asking the
    // WebView, which cannot answer honestly without algorithmic darkening (see the WebView setup).
    // Captured when the WebView factory runs: uiMode is in configChanges, so a mid-session theme
    // flip does not recreate this activity and only reaches the reader on the next share.
    val darkMode = isSystemInDarkTheme()
    // Completed by the bundle's `clipperReaderApplied` message; created before the toggle is fired
    // so the message can never arrive before there is something to receive it.
    var pendingApply by remember { mutableStateOf<CompletableDeferred<Boolean>?>(null) }
    var progress by remember { mutableStateOf(0) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var readerActive by remember { mutableStateOf(false) }
    var toggleInFlight by remember { mutableStateOf(false) }
    // The shell FAB's menu (D35). Deliberately not saved across process death: a menu the
    // user cannot remember opening should not come back open.
    var fabExpanded by remember { mutableStateOf(false) }
    // Non-null while upstream's clip sheet is up. Holds the page identity captured at the moment
    // Clip was tapped, not a live read: the sheet is clipping the page as it was then.
    var clipping by remember { mutableStateOf<Pair<String, String>?>(null) }
    // Retry after a load error. The error pane replaced the WebView in composition and onRelease
    // destroyed it (after onRenderProcessGone the framework forbids reusing it anyway), so clearing
    // the error is what recreates one: the factory runs again and starts from the shared URL.
    fun retryFromError() {
        readerActive = false
        loadError = null
    }

    /**
     * Open upstream's clip sheet over the current page (D25's third button, D31's hosting).
     *
     * The URL comes from the WebView rather than the activity's `url` extra, because a reader
     * toggle or an in-page navigation may have moved on since the share.
     */
    fun openClipSheet() {
        val web = webView ?: return
        clipping = (web.url ?: url) to (web.title.orEmpty())
    }

    // Carries messages between the two WebViews (M2.2). Held here rather than inside the sheet
    // because it outlives the sheet: the page WebView is registered with it for the whole session,
    // and the sheet only attaches and detaches the UI side.
    val router = remember {
        MessageRouter(
            bridgeToken = bridgeToken,
            // Bridge calls land on the WebView's JavaBridge thread; everything downstream of here
            // touches a WebView, which is main-thread only.
            post = { block -> mainHandler.post(block) },
            onOpenExternal = { uri -> openExternally(appContext, uri) },
            // The reader toolbar's clip button arrives here, from either WebView.
            onOpenClipSheet = ::openClipSheet,
            // Reads the delegate on each call, so it sees whichever toggle is in flight now — not
            // whatever was pending when the router was first remembered.
            onPageEvent = { message -> onBridgeMessage(message, pendingApply) },
        )
    }

    fun toggleReader() {
        val web = webView ?: return
        if (toggleInFlight) return
        toggleInFlight = true
        scope.launch {
            try {
                val signal = CompletableDeferred<Boolean>()
                pendingApply = signal
                when (val outcome = web.evaluate(ClipperBundle.TOGGLE_JS).unquote()) {
                    "applying" -> {
                        // A lost message and a failed render look identical from here, so on
                        // timeout ask the page directly rather than assuming the worst.
                        val rendered = withTimeoutOrNull(READER_APPLIED_TIMEOUT_MS) { signal.await() }
                            ?: (web.evaluate(ClipperBundle.READER_RENDERED_JS) == "true")
                        // `rendered` and the reader-active class can disagree: apply swallows its
                        // own errors (class set, nothing built), and an apply slower than the
                        // timeout can finish after the probe said no. The class decides what the
                        // next tap does (apply vs restore), so it is what the button must track;
                        // `rendered` only decides whether to report failure.
                        readerActive =
                            rendered || web.evaluate(ClipperBundle.READER_ACTIVE_JS) == "true"
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
                pendingApply = null
                toggleInFlight = false
            }
        }
    }

    Scaffold(modifier = Modifier.fillMaxSize().safeDrawingPadding()) { insets ->
        Box(Modifier.fillMaxSize().padding(insets)) {
            val error = loadError
            if (error != null) {
                LoadErrorPane(error, onRetry = ::retryFromError)
            } else {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    // Runs when a load error swaps the pane in, and when the screen goes away. A
                    // WebView holds native resources GC cannot see, and one whose renderer died
                    // must never be reused — destroy it, and drop the stale reference so nothing
                    // pokes a dead view.
                    onRelease = { view ->
                        if (webView === view) webView = null
                        view.destroy()
                    },
                    factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.userAgentString = CHROME_MOBILE_UA
                            // Without these a WebView ignores the page's <meta name="viewport">
                            // entirely and lays out at the control's width in CSS pixels, which is
                            // why YouTube arrived clipped and mis-sized. Every real browser honours
                            // the tag; a reader that shows the page before the reader is a tap away
                            // (D24) has to look like one.
                            settings.useWideViewPort = true
                            settings.loadWithOverviewMode = true
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                            // Algorithmic darkening is deliberately NOT enabled, after trying it.
                            //
                            // It is the only switch that makes a WebView report
                            // `prefers-color-scheme: dark`, so it is tempting: it is what made the
                            // reader go dark. But WebView only defers to a page's own dark theme
                            // when the page declares `color-scheme`; a page that merely *has* a
                            // dark mode (stephango drives its own from JS, with no such
                            // declaration) gets machine-darkened instead — dark grey text on a dark
                            // background, measurably worse than the light page it replaced.
                            //
                            // So the raw page is left exactly as its author drew it, and the reader
                            // is told the app's theme directly instead — see `darkMode` in
                            // ClipperBundle.injectionScript. The reader is the surface Johan reads
                            // on; the raw page is a waypoint, and a bright waypoint beats an
                            // unreadable one.

                            // M1.3. Attached before the first load, since the interface only
                            // applies to pages loaded after it is added. WebView calls in on its
                            // own thread, so the handler hops back to main before touching state.
                            addJavascriptInterface(
                                AndroidBridge(bridgeToken, prefs) { json -> router.fromPage(json) },
                                AndroidBridge.NAME,
                            )

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
                                        ClipperBundle.injectionScript(ctx, bridgeToken, darkMode),
                                    ) { result ->
                                        if (result.unquote() != "object") {
                                            android.util.Log.w("Reader", "bundle injection -> $result")
                                        }
                                    }
                                    if (BuildConfig.DEBUG) {
                                        view.evaluateJavascript(ClipperBundle.LAYOUT_PROBE_JS) {
                                            android.util.Log.i("Reader", "layout ${it.unquote()}")
                                        }
                                    }
                                },
                                onFailed = { description -> loadError = description },
                                onRendererGone = { crashed ->
                                    // The WebView is dead; the Compose state around it is not.
                                    // Say which of the two happened, because they mean different
                                    // things to whoever reads the report.
                                    readerActive = false
                                    loadError = if (crashed) {
                                        context.getString(R.string.renderer_crashed)
                                    } else {
                                        context.getString(R.string.renderer_reclaimed)
                                    }
                                    android.util.Log.w("Reader", "render process gone, crashed=$crashed")
                                },
                            )
                            webView = this
                            router.pageWebView = this
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
                if (loadError == null) {
                    ShellControls(
                        expanded = fabExpanded,
                        onExpandedChange = { fabExpanded = it },
                        readerActive = readerActive,
                        enabled = webView != null && !toggleInFlight,
                        onToggleReader = ::toggleReader,
                        onClip = ::openClipSheet,
                        modifier = Modifier.matchParentSize(),
                    )
                }
            }
        }
    }

    clipping?.let { (pageUrl, pageTitle) ->
        ClipSheet(
            pageUrl = pageUrl,
            pageTitle = pageTitle,
            bridgeToken = bridgeToken,
            prefs = prefs,
            router = router,
            onDismiss = { clipping = null },
        )
    }

    // System Back walks the WebView's own history where there is any, then leaves. That is an OS
    // gesture rather than chrome, so D23 is untouched — there are no back/forward buttons.
    BackHandler {
        val web = webView
        when {
            // An open menu is the first thing Back should take away — same as the scrim tap.
            fabExpanded -> fabExpanded = false
            web != null && web.canGoBack() -> web.goBack()
            else -> onDone()
        }
    }
}

/**
 * The whole of the app's chrome (D25, reshaped by D33, then by **D35**): one FAB, bottom right,
 * that opens a small vertical menu.
 *
 * **D35, Johan's call (2026-09-03):** two permanent mini FABs took too much of the page. One
 * collapsed button costs 56dp where the pair cost 88dp, and the second tap buys an explicit label
 * for what each action is. He accepted that cost in as many words — *"I do not mind the extra click
 * for the clarity"* — so the tap count is the decision, not an oversight to optimise away later.
 *
 * **The main button is `Clip` once the menu is open**, in the same place the finger just tapped;
 * `Reader` pops out above it. Swapping the two is a matter of exchanging the two `onClick`s and
 * icons below, and nothing else depends on the order.
 *
 * `Reload` stays retired (D33): toggling the reader off already ends in `window.location.reload()`,
 * which is D26's recovery for a too-early reader tap, and a page that fails outright still gets the
 * error pane's Retry.
 *
 * Both buttons are `SmallFloatingActionButton` and both are `CircleShape` (Johan, 2026-09-03):
 * Material's default FAB is 56dp with a rounded-square corner, and at this size and count the
 * squircle reads as chrome. Colour carries the hierarchy the size no longer does — the main button
 * takes `primaryContainer` while the menu is open.
 *
 * The dismiss scrim is the full window on purpose — "tap anywhere that is not a button" is the
 * close gesture, and that first tap is deliberately swallowed rather than passed to the page.
 */
@Composable
private fun ShellControls(
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    readerActive: Boolean,
    enabled: Boolean,
    onToggleReader: () -> Unit,
    onClip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Deliberately quicker than Material's defaults (Johan, 2026-09-03). The menu sits between the
    // finger and the thing it wants; at this range the motion reads as feedback rather than as an
    // animation waited on.
    val motion = tween<Float>(durationMillis = 110, easing = FastOutSlowInEasing)
    val slide = tween<IntOffset>(durationMillis = 110, easing = FastOutSlowInEasing)

    // Collapse before acting, so the menu is never left open behind a sheet or a reloading page.
    fun run(action: () -> Unit) {
        onExpandedChange(false)
        if (enabled) action()
    }

    Box(modifier = modifier.fillMaxSize()) {
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn(animationSpec = motion),
            exit = fadeOut(animationSpec = motion),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f))
                    // No ripple and no indication: this is a dismiss target, not a control.
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { onExpandedChange(false) },
            )
        }

        Column(
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AnimatedVisibility(
                visible = expanded,
                enter = fadeIn(animationSpec = motion) +
                    scaleIn(animationSpec = motion, initialScale = 0.7f) +
                    slideInVertically(animationSpec = slide) { it / 2 },
                exit = fadeOut(animationSpec = motion) +
                    scaleOut(animationSpec = motion, targetScale = 0.7f) +
                    slideOutVertically(animationSpec = slide) { it / 2 },
            ) {
                SmallFloatingActionButton(
                    onClick = { run(onToggleReader) },
                    shape = CircleShape,
                    containerColor = if (readerActive) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
                ) {
                    Icon(
                        painterResource(R.drawable.ic_reader),
                        contentDescription = stringResource(R.string.action_reader),
                    )
                }
            }

            // Collapsed this is a neutral plus; open, it rotates 45° into a close mark *and*
            // becomes Clip. One button with two jobs, which is why the icon crossfades rather
            // than simply rotating.
            val rotation by animateFloatAsState(
                targetValue = if (expanded) 45f else 0f,
                animationSpec = motion,
                label = "shellFabRotation",
            )
            SmallFloatingActionButton(
                onClick = { if (expanded) run(onClip) else onExpandedChange(true) },
                shape = CircleShape,
                containerColor = if (expanded) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                },
            ) {
                if (expanded) {
                    Icon(
                        painterResource(R.drawable.ic_clip),
                        contentDescription = stringResource(R.string.action_clip),
                    )
                } else {
                    Icon(
                        painterResource(R.drawable.ic_actions),
                        contentDescription = stringResource(R.string.action_actions),
                        modifier = Modifier.rotate(rotation),
                    )
                }
            }
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

/**
 * Events arriving from the bundle (M1.3).
 *
 * Only our own `clipperReaderApplied` is acted on. Upstream's other seven actions belong to
 * milestones that have not landed — they are logged rather than dropped silently, because a
 * message going nowhere quietly is exactly the failure that would be blamed on the reader.
 *
 * Nothing here may be treated as authorisation to act on the vault: page script can reach
 * `window.__clipper` and therefore `sendMessage`. M2's save must start from a tap on this side.
 */
private fun onBridgeMessage(message: JSONObject, pendingApply: CompletableDeferred<Boolean>?) {
    when (val action = message.optString("action")) {
        ClipperBundle.ACTION_READER_APPLIED ->
            pendingApply?.complete(message.optBoolean("rendered", false))

        // Upstream announces the off direction itself; the reload that follows resets our state
        // anyway, so there is nothing to do but note it.
        "readerModeChanged" -> Unit

        // The highlighter announcing itself (M2.7). Nothing to do on this side — the page's body
        // class is the state, and Kotlin reads it there when the clip sheet asks. Named rather than
        // left to the `else` branch so a genuinely unexpected action still stands out in the log.
        "highlighterModeChanged", "updateHasHighlights" -> Unit

        else -> android.util.Log.i("Reader", "unhandled bridge action: $action")
    }
}

/** `evaluateJavascript` as a suspend call. Must be called from the main thread, which every
 *  `rememberCoroutineScope()` launch is. */
private suspend fun WebView.evaluate(js: String): String? =
    suspendCancellableCoroutine { continuation ->
        evaluateJavascript(js) { result -> continuation.resume(result) }
    }

/** `evaluateJavascript` hands back JSON; unwrap the string case these snippets return. */
private fun String?.unquote(): String =
    this?.removeSurrounding("\"")?.replace("\\\"", "\"") ?: "null"
