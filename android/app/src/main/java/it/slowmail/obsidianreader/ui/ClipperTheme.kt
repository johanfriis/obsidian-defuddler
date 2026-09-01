package it.slowmail.obsidianreader.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

/**
 * The app's Compose theme (playbook M5.2, wired at M1.8).
 *
 * Both activities previously called `MaterialTheme { }` with no arguments, which silently means
 * `lightColorScheme()` *always* — one of the three reasons dark mode had no effect on this app at
 * all. The other two were the hardcoded `Theme.Material.Light` XML theme and the WebView never
 * opting into algorithmic darkening.
 *
 * Deliberately the stock Material 3 schemes rather than a bespoke palette: the shell is one slim
 * bar (D25) and the reader owns every colour that matters, so a hand-tuned palette would be
 * decoration on the two square inches the reader does not paint.
 */
@Composable
fun ClipperTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) darkColorScheme() else lightColorScheme(),
        content = content,
    )
}
