/** Which rows the transcript shows: codevibez's English, or Claude Code's own. */
export type View = 'english' | 'raw'

declare module 'claude-code' {
  interface PluginState {
    codevibez: { view: View }
  }
}
