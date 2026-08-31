declare module 'virtual:assets' {
  /** name → file contents, embedded at build time; served through `browser.runtime.getURL`. */
  export const assets: Record<string, string>;
  /** `_locales/en/messages.json`, backing `browser.i18n.getMessage`. */
  export const messages: Record<
    string,
    { message: string; placeholders?: Record<string, { content: string }> }
  >;
}
