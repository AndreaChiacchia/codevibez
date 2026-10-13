import type { EngineInterface, Register, RenderElement, ResolveInput } from 'claude-code'

import type { Chapter, View } from '../types'
import { createLedger, observe, summarize } from './ledger.ts'
import { describeCall, describeGroup, isKnownTool } from './narrate.ts'
import type { CallView, Narration, Sentence, Tone } from './narrate.ts'
import { addLines, fitNewest, linesOf, startChapter, storyRows } from './story.ts'

/**
 * codevibez: plain English in place of Claude Code's raw tool rows.
 *
 * Observe only. Every hook here either draws a row or passes the event on
 * untouched; none of them refuses, rewrites, retries or delays a tool call,
 * a prompt or a permission decision. Anything unexpected (a tool it does not
 * know, a row of another shape, a throw) leaves Claude Code's own row.
 */

const VIEW = { plugin: 'codevibez', key: 'view' } as const
const STORY = { plugin: 'codevibez', key: 'story' } as const
const MEMO_LIMIT = 500
const STORY_SAVE_MS = 1000

const ENGLISH_ON =
  "English view is on. Type /codevibez to see Claude Code's own rows."
const RAW_ON =
  'Raw view is on, showing exactly what ran in Claude Code\'s own rows. Type /codevibez to go back to English.'
const USAGE =
  'Use /codevibez to switch views, /codevibez english or /codevibez raw to pick one, or /codevibez story to read the session so far.'

type Look = { color?: string; bold?: boolean; dimColor?: boolean }

// Failures and destructive steps are bold and colored; routine reading is dim.
const LOOK: Readonly<Record<Tone, Look>> = {
  info: {},
  read: { dimColor: true },
  success: { color: 'success' },
  failure: { color: 'error', bold: true },
  danger: { color: 'warning', bold: true },
  stopped: { color: 'warning' },
}

async function currentView($: EngineInterface): Promise<View> {
  const { value } = await $.state.get(VIEW)
  return value === 'raw' ? 'raw' : 'english'
}

// The story pane reads the session's state; writing it never holds anything up.
function saveStory($: EngineInterface, story: Chapter[]): void {
  $.state.set(STORY, story).catch(() => undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A cheap signature of what the translation reads from a call's input. */
function signature(input: unknown): string {
  if (!isRecord(input)) return typeof input
  const field = (name: string): string => {
    const value = input[name]
    return typeof value === 'string' ? value : ''
  }
  // String lengths, not JSON: a Write carries the whole file, and stringifying
  // a large one on every draw costs milliseconds.
  let length = 0
  for (const value of Object.values(input)) length += typeof value === 'string' ? value.length : 1
  return [Object.keys(input).length, length, field('command'), field('description'), field('file_path')].join('|')
}

function asCallView(value: unknown): CallView | null {
  if (!isRecord(value) || typeof value.tool !== 'string') return null
  return {
    tool: value.tool,
    input: value.input,
    isRunning: value.isRunning === true,
    isErrored: value.isErrored === true,
    isInterrupted: value.isInterrupted === true,
    output: value.output,
  }
}

function draw(
  $: EngineInterface,
  e: ResolveInput,
  lines: readonly Narration[],
  isRunning: boolean,
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const row = (line: Sentence, key: string, indent: boolean) => {
    const words = isRunning && !line.text.endsWith('…') ? `${line.text}…` : line.text
    return (
      <Box key={key} paddingLeft={indent ? 2 : 0}>
        <Text {...LOOK[line.tone]}>
          {line.glyph} {words}
        </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {lines.flatMap((narration, index) => [
        row(narration.action, `a${index}`, index > 0),
        narration.outcome === undefined ? null : row(narration.outcome, `o${index}`, true),
      ])}
    </Box>
  )
}

export const register: Register = on => {
  // Narration state lives in memory for the session and is never written down.
  let ledger = createLedger()
  let story: Chapter[] = []
  // The story reaches the session's state only once its pane has been opened,
  // and then at most once a second while a turn runs, and at the turn's end.
  let storyShown = false
  let lastSave = 0
  const storyDue = (force: boolean): boolean => {
    if (!storyShown) return false
    const now = Date.now()
    if (!force && now - lastSave < STORY_SAVE_MS) return false
    lastSave = now
    return true
  }
  const memo = new Map<string, Narration>()
  // Whether each call's row was drawn in English, so its result block below
  // follows the same choice.
  const drawnInEnglish = new Map<string, boolean>()

  const narrate = (id: string, view: CallView): Narration | null => {
    // Claude Code draws a row first with an empty input, then again once the
    // input has arrived, so what the translation reads is part of the key, and
    // a row that could not be read yet is never cached.
    const key = `${id}|${view.isRunning}|${view.isErrored}|${view.isInterrupted}|${view.output === undefined}|${signature(view.input)}`
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    const narration = describeCall(view)
    if (drawnInEnglish.size >= MEMO_LIMIT) {
      const oldest = drawnInEnglish.keys().next().value
      if (oldest !== undefined) drawnInEnglish.delete(oldest)
    }
    if (narration === null) {
      // An input still streaming in says nothing about the finished row.
      if (isRecord(view.input) && Object.keys(view.input).length > 0) drawnInEnglish.set(id, false)
      return null
    }
    if (memo.size >= MEMO_LIMIT) {
      const oldest = memo.keys().next().value
      if (oldest !== undefined) memo.delete(oldest)
    }
    memo.set(key, narration)
    drawnInEnglish.set(id, true)
    return narration
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'codevibez',
        description: "Switch between plain English and Claude Code's own tool rows",
        argumentHint: '[english|raw|story]',
        immediate: true,
      })
    } catch {
      // Without the command the English still draws; nothing to interrupt.
    }
    return next(e)
  })

  on('command.run', { command: 'codevibez' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    if (asked === 'story') {
      storyShown = true
      lastSave = Date.now()
      saveStory($, story)
      const opened = await $.ui.open({ id: 'codevibez-story', title: 'The story so far', focus: true, closeOnEscape: true })
      return {
        text: opened.isPlaced
          ? 'The story of this session is open in a pane. Esc closes it.'
          : `The story pane could not open here (${opened.reason}).`,
      }
    }
    const now = await currentView($)
    const wanted: View | null =
      asked === ''
        ? now === 'raw' ? 'english' : 'raw'
        : asked === 'raw'
          ? 'raw'
          : asked === 'english' || asked === 'plain'
            ? 'english'
            : null
    if (wanted === null) return { text: USAGE }
    if (wanted !== now) await $.state.set(VIEW, wanted)
    return { text: wanted === 'raw' ? RAW_ON : ENGLISH_ON }
  }).catch(() => ({ text: 'Could not switch views; nothing changed.' }))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    let tree: RenderElement | undefined
    try {
      if ((await currentView($)) === 'english') {
        const view = asCallView(e.props)
        const narration = view === null ? null : narrate(e.props.tool_use_id, view)
        if (view !== null && narration !== null) {
          tree = draw($, e, [narration], view.isRunning)
        }
      }
    } catch {
      tree = undefined
    }
    return tree ?? next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    let tree: RenderElement | undefined
    try {
      if ((await currentView($)) === 'english') {
        // The English row above already says what came of the call, failures
        // included, so the raw result block under it is left out.
        const known = drawnInEnglish.get(e.props.tool_use_id) ?? isKnownTool(e.props.tool)
        if (known) {
          const { Box } = $.ui.resolve(e)
          tree = <Box />
        }
      }
    } catch {
      tree = undefined
    }
    return tree ?? next(e)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    let tree: RenderElement | undefined
    try {
      if (!e.props.isExpanded && (await currentView($)) === 'english') {
        const calls = e.props.calls.map(asCallView)
        if (calls.every((call): call is CallView => call !== null)) {
          const lines = describeGroup(calls)
          if (lines !== null) tree = draw($, e, lines, false)
        }
      }
    } catch {
      tree = undefined
    }
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'codevibez-story' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    try {
      const { value } = await $.state.get(STORY)
      const rows = storyRows(value ?? [])
      if (rows.length === 0) {
        return <Text dimColor>Nothing has happened yet. Each prompt you type starts a chapter here.</Text>
      }
      // The pane opens short, so it shows the newest steps that fit.
      const { shown, hidden } = fitNewest(rows, e.props.bodyColumns, e.props.scroll.bodyRows)
      return (
        <Box flexDirection="column">
          {hidden > 0 && (
            <Text key="hidden" dimColor>
              {hidden} earlier {hidden === 1 ? 'line' : 'lines'} not shown; the newest are below
            </Text>
          )}
          {shown.map((row, index) =>
            row.kind === 'heading' ? (
              <Box key={`h${index}`} marginTop={index === 0 ? 0 : 1}>
                <Text bold>{row.text}</Text>
              </Box>
            ) : (
              <Box key={`l${index}`} paddingLeft={2}>
                <Text {...(row.kind === 'note' ? LOOK.read : LOOK[row.tone ?? 'info'])}>{row.text}</Text>
              </Box>
            ),
          )}
        </Box>
      )
    } catch {
      return <Text dimColor>The story could not be drawn just now.</Text>
    }
  })

  on('turn.start', ($, e, next) => {
    ledger = createLedger()
    try {
      if (e.text.trim() !== '') {
        story = startChapter(story, e.text)
        if (storyDue(false)) saveStory($, story)
      }
    } catch {
      // The story missing a chapter never holds up a prompt.
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const { tool, tool_use_id: _id, agentId, ...input } = e as Record<string, unknown>
      const isError = ran.isError === true
      const text = typeof ran.text === 'string' ? ran.text : ''
      observe(ledger, {
        tool: String(tool),
        input,
        isError,
        isDenied: ran.deny !== undefined,
        result: ran.result,
        text,
      })
      // The story follows the main conversation; a helper's own steps stay
      // inside the line that handed it the task.
      if (agentId === undefined && ran.deny === undefined) {
        const narration = describeCall({
          tool: String(tool),
          input,
          isRunning: false,
          isErrored: isError,
          isInterrupted: false,
          output: isError ? text || ran.result : ran.result,
        })
        if (narration !== null) {
          story = addLines(story, linesOf(narration))
          if (storyDue(false)) saveStory($, story)
        }
      }
    } catch {
      // A summary that misses one call beats a session that stalls on it.
    }
    return ran
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    try {
      const summary = summarize(ledger)
      if (summary !== null) {
        if ((await currentView($)) === 'english') $.ui.log(`${summary.glyph} ${summary.text}`)
        story = addLines(story, [summary], true)
      }
      if (storyDue(true)) saveStory($, story)
    } catch {
      // No summary line is better than a turn that cannot end.
    }
    ledger = createLedger()
    return ran
  })
}
