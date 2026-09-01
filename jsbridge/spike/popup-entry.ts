// Spike only — throwaway. Background first, so its listener is registered before popup.ts
// fires its DOMContentLoaded handler.
import './fake-background';
import '../vendor/obsidian-clipper/src/core/popup';
