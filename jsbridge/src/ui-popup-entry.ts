// Entry for android/app/src/main/assets/ui/popup.js — upstream's clip sheet (D31).
//
// The background responder is installed first, because upstream's popup queries `getActiveTab` from
// its own DOMContentLoaded handler and shows "Please reload" if nothing answers.

import { installBackground, setPageContext } from './background';

installBackground();

import '../vendor/obsidian-clipper/src/core/popup';

// Kotlin's entry point into this document, mirroring `__clipper` in the page WebView.
(window as unknown as { __clipperUi: unknown }).__clipperUi = { setPageContext };
