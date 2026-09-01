package it.slowmail.obsidianreader.share

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import it.slowmail.obsidianreader.R
import it.slowmail.obsidianreader.reader.ReaderActivity

/**
 * The app's real entry point (playbook M1.1): a trampoline for `ACTION_SEND` + `text/plain`.
 *
 * It has no UI of its own — a translucent theme and an immediate `finish()` — so sharing a link
 * goes straight to the reader with no intermediate screen to look at.
 */
class ShareReceiverActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val url = SharedUrl.from(intent)
        if (url == null) {
            // Nothing shareable in the intent. Say so plainly rather than opening an empty reader.
            Toast.makeText(this, R.string.share_no_url, Toast.LENGTH_LONG).show()
        } else {
            startActivity(ReaderActivity.intentFor(this, url, SharedUrl.titleHintFrom(intent)))
        }
        finish()
    }
}
