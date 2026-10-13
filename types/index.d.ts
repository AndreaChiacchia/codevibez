/** Which rows the transcript shows: codevibez's English, or Claude Code's own. */
export type View = 'english' | 'raw'

/** One English line of the story, as a tool row draws it. */
export type StoryLine = {
  glyph: string
  text: string
  tone: 'info' | 'read' | 'success' | 'failure' | 'danger' | 'stopped'
}

/** One prompt you typed, verbatim, and the steps that followed it. */
export type Chapter = {
  prompt: string
  lines: StoryLine[]
  /** Lines past the chapter's room, counted exactly. */
  more: number
  /** How many of those were failures or destructive steps. */
  serious?: number
}

declare module 'claude-code' {
  interface PluginState {
    codevibez: { view: View; story: Chapter[] }
  }
}
