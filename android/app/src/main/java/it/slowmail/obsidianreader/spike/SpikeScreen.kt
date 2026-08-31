package it.slowmail.obsidianreader.spike

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/**
 * M0 "Spike A" scratch screen (playbook §6) — THROWAWAY code, replaced in M1/M2.
 *
 * Exercises the obsidian://new save path on the real device:
 *  - A2: clipboard write + intent fire in the same tap (the exact SavePipeline sequence).
 *  - A3: content= size probe (2/16/64/128 KB + custom) to measure the reliable URI limit.
 *  - A4: append/overwrite/silent behavior flags against an existing note.
 *
 * URI recipe mirrors upstream obsidian-note-creator.ts as documented in playbook §3:
 * file= first, then behavior flags, vault=, silent=true, bare &clipboard (no =true)
 * plus a short-error content=, or a full content= body in legacy mode.
 */

private const val PREFS = "spike"

private fun buildObsidianNewUri(
    vault: String,
    file: String,
    append: Boolean,
    overwrite: Boolean,
    silent: Boolean,
    clipboardMode: Boolean,
    content: String?,
): String {
    val sb = StringBuilder("obsidian://new?file=").append(Uri.encode(file))
    if (append) sb.append("&append=true")
    if (overwrite) sb.append("&overwrite=true")
    if (vault.isNotBlank()) sb.append("&vault=").append(Uri.encode(vault))
    if (silent) sb.append("&silent=true")
    if (clipboardMode) sb.append("&clipboard")
    if (content != null) sb.append("&content=").append(Uri.encode(content))
    return sb.toString()
}

private fun payloadOfKb(kb: Int): String {
    val line = "The quick brown fox jumps over the lazy dog 0123456789.\n"
    val target = kb * 1024
    val sb = StringBuilder(target + line.length)
    var i = 0
    while (sb.length < target) {
        sb.append("spike-a3 line ").append(i++).append(": ").append(line)
    }
    return sb.toString()
}

@Composable
fun SpikeScreen() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    var vault by rememberSaveable { mutableStateOf(prefs.getString("vault", "") ?: "") }
    var file by rememberSaveable { mutableStateOf("Clippings/spike-a2") }
    var append by rememberSaveable { mutableStateOf(false) }
    var overwrite by rememberSaveable { mutableStateOf(false) }
    var silent by rememberSaveable { mutableStateOf(false) }
    var customKb by rememberSaveable { mutableStateOf("192") }
    var status by rememberSaveable { mutableStateOf("No URI fired yet.") }
    // Plain remember, NOT rememberSaveable: this holds the whole percent-encoded
    // URI, so a 512 KB content= body lands ~1.4 MB in saved instance state and
    // blows the binder limit when the activity stops. Same trap applies to
    // ReaderActivity/SavePipeline in M2 - note content stays out of saved state.
    var lastUri by remember { mutableStateOf("") }

    fun fire(uri: String, note: String) {
        prefs.edit().putString("vault", vault).apply()
        lastUri = uri
        val result = try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
            "launched OK"
        } catch (e: ActivityNotFoundException) {
            "FAILED: nothing handles obsidian:// — is Obsidian installed?"
        } catch (e: Exception) {
            "FAILED: ${e.javaClass.simpleName}: ${e.message}"
        }
        status = "$note\nURI length: ${uri.length} chars\nResult: $result"
        Toast.makeText(context, result, Toast.LENGTH_SHORT).show()
    }

    fun fireContentProbe(kb: Int) {
        val body = payloadOfKb(kb)
        val uri = buildObsidianNewUri(
            vault = vault,
            file = file,
            append = append,
            overwrite = overwrite,
            silent = silent,
            clipboardMode = false,
            content = body,
        )
        fire(uri, "A3 content= probe: $kb KB raw body (${body.length} chars before encoding)")
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("M0 Spike A — obsidian:// save path", style = MaterialTheme.typography.titleLarge)
        Text(
            "Throwaway harness for playbook §6. Record findings in §2 (gate G0).",
            style = MaterialTheme.typography.bodySmall,
        )

        OutlinedTextField(
            value = vault,
            onValueChange = { vault = it },
            label = { Text("Vault name (exact, blank = default vault)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = file,
            onValueChange = { file = it },
            label = { Text("file= (folder/name, no .md)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = append, onCheckedChange = { append = it })
            Text("append")
            Checkbox(checked = overwrite, onCheckedChange = { overwrite = it })
            Text("overwrite")
            Checkbox(checked = silent, onCheckedChange = { silent = it })
            Text("silent")
        }

        HorizontalDivider()
        Text("A2 — clipboard handoff (primary path)", style = MaterialTheme.typography.titleMedium)
        Text(
            "Copies a timestamped paragraph, then fires obsidian://new with bare &clipboard " +
                "and a short-error content= — clipboard write and intent in the same tap.",
            style = MaterialTheme.typography.bodySmall,
        )
        Button(
            onClick = {
                val stamp = System.currentTimeMillis()
                val sample =
                    "Spike A2 clipboard payload ($stamp).\n\n" +
                        "If this paragraph is the body of the new note, the clipboard handoff works. " +
                        "The quick brown fox jumps over the lazy dog."
                val cm = context.getSystemService(ClipboardManager::class.java)
                cm.setPrimaryClip(ClipData.newPlainText("spike-a2", sample))
                val uri = buildObsidianNewUri(
                    vault = vault,
                    file = file,
                    append = append,
                    overwrite = overwrite,
                    silent = silent,
                    clipboardMode = true,
                    content = "Clipboard read failed — spike A2 fallback message.",
                )
                fire(uri, "A2 clipboard mode: copied ${sample.length} chars, then fired.")
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Copy sample + fire &clipboard URI") }

        HorizontalDivider()
        Text("A3 — content= size probe (legacy fallback)", style = MaterialTheme.typography.titleMedium)
        Text(
            "Fires the full body in content=. Increase until it breaks; " +
                "record the last reliable size in playbook §2.",
            style = MaterialTheme.typography.bodySmall,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { fireContentProbe(2) }) { Text("2 KB") }
            OutlinedButton(onClick = { fireContentProbe(16) }) { Text("16 KB") }
            OutlinedButton(onClick = { fireContentProbe(64) }) { Text("64 KB") }
            OutlinedButton(onClick = { fireContentProbe(128) }) { Text("128 KB") }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = customKb,
                onValueChange = { customKb = it },
                label = { Text("Custom KB") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(
                onClick = { customKb.toIntOrNull()?.let { fireContentProbe(it) } },
            ) { Text("Fire custom") }
        }

        HorizontalDivider()
        Text("A4 — behavior flags", style = MaterialTheme.typography.titleMedium)
        Text(
            "Fire a small content= note at the same file with append/overwrite/silent " +
                "toggled above; verify semantics against an existing note.",
            style = MaterialTheme.typography.bodySmall,
        )
        Button(
            onClick = {
                val body = "spike-a4 marker line @ ${System.currentTimeMillis()}\n"
                val uri = buildObsidianNewUri(
                    vault = vault,
                    file = file,
                    append = append,
                    overwrite = overwrite,
                    silent = silent,
                    clipboardMode = false,
                    content = body,
                )
                fire(uri, "A4 flags: append=$append overwrite=$overwrite silent=$silent")
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Fire small content= note with flags") }

        HorizontalDivider()
        Text("Status", style = MaterialTheme.typography.titleMedium)
        Text(status, style = MaterialTheme.typography.bodyMedium)
        if (lastUri.isNotEmpty()) {
            Text(
                if (lastUri.length <= 300) lastUri else lastUri.take(300) + "… (truncated)",
                style = MaterialTheme.typography.bodySmall,
            )
            OutlinedButton(
                onClick = {
                    val cm = context.getSystemService(ClipboardManager::class.java)
                    cm.setPrimaryClip(ClipData.newPlainText("spike-uri", lastUri))
                    Toast.makeText(context, "URI copied", Toast.LENGTH_SHORT).show()
                },
            ) { Text("Copy last URI") }
        }
        Spacer(Modifier.height(24.dp))
    }
}

/**
 * Smoke test for the Android Studio setup: if the Compose Preview panel renders
 * this, Gradle sync, the Android facet and the Compose plugin are all wired up.
 * The buttons do nothing useful in the preview - they need a real device.
 */
@Preview(showBackground = true, heightDp = 900)
@Composable
private fun SpikeScreenPreview() {
    MaterialTheme {
        Surface {
            SpikeScreen()
        }
    }
}
