package it.slowmail.obsidianreader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import it.slowmail.obsidianreader.spike.SpikeScreen

// Phase 0 scaffold. Currently hosts the M0 Spike A harness (playbook §6);
// M1 replaces this with the share -> reader flow.
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface {
                    SpikeScreen()
                }
            }
        }
    }
}
