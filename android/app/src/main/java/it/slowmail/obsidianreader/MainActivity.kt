package it.slowmail.obsidianreader

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import it.slowmail.obsidianreader.spike.SpikeBActivity
import it.slowmail.obsidianreader.spike.SpikeScreen

/**
 * Phase 0 scaffold, now a chooser between the two M0 spike harnesses (playbook §6).
 * Spike A stays reachable because M2's acceptance list still references it.
 * M1 replaces all of this with the share -> reader flow.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface {
                    SpikeChooser()
                }
            }
        }
    }
}

@Composable
private fun SpikeChooser() {
    val context = LocalContext.current
    var showSpikeA by remember { mutableStateOf(false) }

    if (showSpikeA) {
        SpikeScreen()
        return
    }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("M0 spike harnesses", style = MaterialTheme.typography.titleLarge)
        Button(
            onClick = { showSpikeA = true },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Spike A — obsidian:// save path") }
        Button(
            onClick = { context.startActivity(Intent(context, SpikeBActivity::class.java)) },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Spike B — reader in a WebView") }
    }
}
