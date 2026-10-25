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

/** How a line looks: a theme color key (or none), bold, dim. */
export type FxLook = { color: string | null; bold: boolean; dimColor: boolean }

/** A typewriter reveal (the story roll-in's): it starts at `from` (ms, `$.clock` time) and lasts `ms`. */
export type FxReveal = { from: number; ms: number }

/**
 * One line the effects module draws. `text` is the whole drawn line (`<glyph> <words>`, with the running `…` already
 * appended) and `look` is its still look.
 */
export type FxLine = {
  text: string
  look: FxLook
  indent: boolean
  reveal: FxReveal | null
  settleFrom: number | null
  shimmerFrom: number | null
}

/**
 * What the effects module (hooks/effects.tsx) is handed; `drawnAt` is `$.clock.now()` at the hook's draw. `debug` is true
 * while the CODEVIBEZ_DEBUG trace is on: the module then posts what it draws (mount, ticks, stop) for the trace.
 */
export type FxProps = { kind: 'lines'; drawnAt: number; lines: FxLine[]; debug: boolean }

declare module 'claude-code' {
  interface PluginState {
    // `wake` is written once when a finished row's effect window ends, so the row draws again as plain text; the key is the tool_use_id.
    codevibez: { view: View; story: Chapter[]; wake: StateFamily<number> }
  }
}
