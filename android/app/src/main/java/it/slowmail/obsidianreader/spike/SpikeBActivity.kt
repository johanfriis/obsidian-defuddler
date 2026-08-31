package it.slowmail.obsidianreader.spike

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * M0 "Spike B" scratch harness (playbook §6) — THROWAWAY code, replaced by ReaderActivity in M1.
 *
 * Answers the three questions B1/B2 left on B3's plate, on the device, without needing
 * chrome://inspect (which stays available and is still the tool for anything visual):
 *
 *  1. Does `Reader.toggle(document)` render in a bare WebView at all?
 *  2. Does the page's CSP block the reader's stylesheet? The reader strips the page's own
 *     stylesheets and injects `reader.css` through a blob URL; an extension is exempt from page
 *     CSP, we are not. The PROBE button reports whether the blob sheet actually landed in
 *     `document.styleSheets`, which is the difference between "works" and "content stripped,
 *     no styles".
 *  3. Does `evaluateJavascript` cope with a ~2 MB bundle? Injection is timed and its result
 *     reported, so a failure is visible rather than silent.
 *
 * Note the Spike A landmine (§2): note/page content must never enter saved instance state. The
 * log here is a plain snapshot list, deliberately not `rememberSaveable`.
 */
class SpikeBActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)
        setContent {
            MaterialTheme {
                Surface {
                    SpikeBScreen()
                }
            }
        }
    }
}

/** M1.2 will make this a settings value; the spike hardcodes it so B3 sees what Chrome sees. */
private const val CHROME_MOBILE_UA =
    "Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/140.0.0.0 Mobile Safari/537.36"

private val PRESETS = listOf(
    "stephango" to "https://stephango.com/vault",
    "github (CSP)" to "https://github.com/obsidianmd/obsidian-clipper",
    "news" to "https://apnews.com/hub/technology",
    "youtube" to "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
)

/**
 * Reports whether the reader took over and — the point of the exercise — whether its stylesheet
 * survived the page's CSP. A blob sheet present in `document.styleSheets` with readable rules
 * loaded; a blob `<link>` with no matching sheet was blocked.
 */
private const val PROBE_JS = """
(function () {
  try {
    var html = document.documentElement;
    var sheets = Array.prototype.map.call(document.styleSheets, function (s) {
      var n;
      try { n = s.cssRules.length; } catch (e) { n = 'opaque'; }
      return (s.href ? s.href.slice(0, 48) : '<inline>') + ' rules=' + n;
    });
    var links = Array.prototype.map.call(
      document.querySelectorAll('link[rel="stylesheet"]'),
      function (l) { return l.href.slice(0, 48); }
    );
    return JSON.stringify({
      toggle: window.__spikeToggle || '(not run)',
      active: html.classList.contains('obsidian-reader-active'),
      htmlBg: getComputedStyle(html).backgroundColor,
      toolbar: !!document.querySelector('.obsidian-reader-settings'),
      outline: !!document.querySelector('.obsidian-reader-outline'),
      transcript: (function () {
        // Content and interactive layer fail independently: defuddle emits the transcript as a
        // plain <h2>Transcript</h2> + timestamped paragraphs, while reader-transcript.ts's
        // pinned player / auto-scroll / clickable segments need a `.youtube.transcript` element
        // it never sees. Report both so they are never conflated again.
        var head = null, chars = 0;
        var hs = document.querySelectorAll('h1,h2,h3,h4');
        for (var j = 0; j < hs.length; j++) {
          if (/transcript/i.test(hs[j].textContent)) { head = hs[j]; break; }
        }
        if (head) {
          var n = head.nextElementSibling;
          while (n && !/^H[1-4]$/.test(n.tagName)) { chars += n.textContent.length; n = n.nextElementSibling; }
        }
        return {
          content: head ? 'heading + ' + chars + ' chars' : 'absent',
          interactive: document.querySelector('.player-container') ? 'wired'
            : (document.querySelector('.youtube.transcript') ? 'element present, not wired' : 'not wired')
        };
      })(),
      highlighterStyleTag: (function () {
        var el = document.getElementById('obsidian-highlighter-stylesheet');
        return el ? el.tagName + (el.tagName === 'STYLE' ? '(' + el.textContent.length + ')' : '') : 'MISSING';
      })(),
      readerStyleTag: (function () {
        var el = document.getElementById('obsidian-reader-styles');
        return el ? el.tagName + (el.tagName === 'STYLE' ? '(' + el.textContent.length + ')' : '') : 'MISSING';
      })(),
      links: links,
      sheets: sheets
    }, null, 1);
  } catch (e) {
    return 'PROBE THREW: ' + e;
  }
})()
"""

/**
 * toggle() is async; stash the outcome on the window for PROBE_JS to pick up.
 *
 * `cssMode` is the B3 experiment: 'link' is upstream's behaviour (reader.css via a blob URL,
 * which page CSP can refuse — github.com sends `style-src 'unsafe-inline' …` with no `blob:`),
 * 'inline' pre-installs the same CSS as a `<style>` so upstream skips the blob path entirely.
 */
private fun toggleJs(cssMode: String) = """
(function () {
  if (!window.__clipper) return 'no bundle';
  window.__spikeToggle = 'pending';
  try {
    window.__clipper.toggle('$cssMode').then(
      function (a) { window.__spikeToggle = 'active=' + a; },
      function (e) { window.__spikeToggle = 'REJECTED: ' + e; }
    );
  } catch (e) {
    window.__spikeToggle = 'THREW: ' + e;
  }
  return 'called (css=$cssMode)';
})()
"""

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SpikeBScreen() {
    val context = LocalContext.current
    val log = remember { mutableStateListOf<String>() }
    var url by remember { mutableStateOf(PRESETS[0].second) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var autoInject by remember { mutableStateOf(true) }
    // Matches the bundle default (G0: inline is M1's default, not a fallback).
    var cssMode by remember { mutableStateOf("inline") }

    fun say(line: String) {
        log.add(line)
        // The on-screen pane ellipsizes; logcat is where the full probe JSON is readable.
        // `just log`, or: adb logcat -s SpikeB
        Log.d("SpikeB", line)
    }

    // Read once: this is the ~2 MB artifact and re-reading it per page load would muddy the
    // injection timing we are here to measure.
    val bundle = remember {
        val started = System.nanoTime()
        val text = context.assets.open("clipper-bundle.js").bufferedReader().use { it.readText() }
        say("asset read: ${text.length / 1024} KB in ${(System.nanoTime() - started) / 1_000_000} ms")
        text
    }

    fun inject(view: WebView) {
        val started = System.nanoTime()
        // The bundle is an IIFE evaluating to undefined; append a probe so the callback carries
        // a verdict rather than "null".
        view.evaluateJavascript(
            bundle + "\n;(typeof window.__clipper);",
        ) { result ->
            val ms = (System.nanoTime() - started) / 1_000_000
            say("inject -> $result in $ms ms")
        }
    }

    fun probe(view: WebView) {
        view.evaluateJavascript(PROBE_JS) { raw ->
            say("probe -> " + unquote(raw))
        }
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(8.dp)) {
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            PRESETS.forEach { (label, preset) ->
                TextButton(onClick = { url = preset; webView?.loadUrl(preset) }) { Text(label) }
            }
        }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Button(onClick = { webView?.loadUrl(url) }) { Text("Load") }
            OutlinedButton(onClick = { webView?.let { inject(it) } }) { Text("Inject") }
            OutlinedButton(onClick = {
                webView?.evaluateJavascript(toggleJs(cssMode)) { say("toggle -> " + unquote(it)) }
            }) { Text("Toggle") }
            OutlinedButton(onClick = { webView?.let { probe(it) } }) { Text("Probe") }
        }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TextButton(onClick = { autoInject = !autoInject }) {
                Text(if (autoInject) "auto-inject: on" else "auto-inject: off")
            }
            TextButton(onClick = { cssMode = if (cssMode == "link") "inline" else "link" }) {
                Text(if (cssMode == "link") "css: link (upstream)" else "css: inline (CSP fix)")
            }
            TextButton(onClick = { log.clear() }) { Text("clear log") }
        }

        AndroidView(
            factory = { ctx ->
                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.userAgentString = CHROME_MOBILE_UA
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                            // CSP violations surface here ("Refused to load the stylesheet ...").
                            say("js/${m.messageLevel()}: ${m.message().take(300)}")
                            return true
                        }
                    }
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView, finished: String) {
                            say("onPageFinished: ${finished.take(60)}")
                            if (autoInject) inject(view)
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            error: WebResourceError,
                        ) {
                            if (request.isForMainFrame) {
                                say("load error ${error.errorCode}: ${error.description}")
                            }
                        }
                    }
                    webView = this
                    loadUrl(url)
                }
            },
            modifier = Modifier.fillMaxWidth().weight(1f),
        )

        val listState = rememberLazyListState()
        LaunchedEffect(log.size) {
            if (log.isNotEmpty()) listState.animateScrollToItem(log.lastIndex)
        }
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth().height(160.dp),
        ) {
            items(log) { line ->
                Text(
                    line,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 6,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }

    BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }
}

/** evaluateJavascript hands back a JSON-encoded value; unwrap the common string case. */
private fun unquote(raw: String?): String {
    val s = raw ?: return "null"
    if (s.length >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
        return s.substring(1, s.length - 1)
            .replace("\\n", "\n")
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
    }
    return s
}
