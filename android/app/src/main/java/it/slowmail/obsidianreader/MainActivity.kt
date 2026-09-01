package it.slowmail.obsidianreader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import it.slowmail.obsidianreader.ui.ClipperTheme

/**
 * The launcher screen — and deliberately almost nothing (playbook M1.0).
 *
 * The app is driven from the share sheet (M1.1), so tapping the icon has nothing to open. This
 * says so, and is what `just run` lands on. It grows into M2.4's setup screen: vault name, default
 * folder, silent-open toggle.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ClipperTheme {
                Surface {
                    HomeScreen()
                }
            }
        }
    }
}

@Composable
private fun HomeScreen() {
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.home_hint), style = MaterialTheme.typography.bodyMedium)
    }
}

/** Smoke test that Gradle sync, the Android facet and the Compose plugin are all wired (P0.2). */
@Preview(showBackground = true)
@Composable
private fun HomeScreenPreview() {
    ClipperTheme { Surface { HomeScreen() } }
}
