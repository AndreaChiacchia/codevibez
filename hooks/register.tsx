import type { EngineInterface, Register, RenderElement, RenderViewport, ResolveInput } from 'claude-code'

import type { Chapter, FxLine, FxProps, View } from '../types'
import { createLedger, observe, summarize } from './ledger.ts'
import {
  LOOK,
  ROLL_START,
  SEEN_LIMIT,
  WAKE_LINGER_MS,
  fxEnd,
  groupFx,
  isResolved,
  nextRoll,
  noteSeen,
  rollFx,
  rowFx,
  rowText,
} from './motion.ts'
import type { Roll, Seen } from './motion.ts'
import { describeCall, describeGroup, isKnownTool } from './narrate.ts'
import type { CallView, Narration, Sentence } from './narrate.ts'
import { anyEffect, normalizeEffects } from './settings.ts'
import type { Effects } from './settings.ts'
import { addLines, fitNewest, linesOf, startChapter, storyRows } from './story.ts'

/**
 * codevibez: plain English in place of Claude Code's raw tool rows.
 *
 * Observe only. Every hook here either draws a row or passes the event on
 * untouched; none of them refuses, rewrites, retries or delays a tool call,
 * a prompt or a permission decision. Anything unexpected (a tool it does not
 * know, a row of another shape, a throw) leaves Claude Code's own row. The
 * motion effects only change how a row is drawn, never what runs.
 */

const VIEW = { plugin: 'codevibez', key: 'view' } as const
const STORY = { plugin: 'codevibez', key: 'story' } as const
const MEMO_LIMIT = 500
const STORY_SAVE_MS = 1000

/** The effects module's file, as the fault hook finds it (each Client names it as a literal: the load refuses a variable). */
const EFFECTS_MODULE = 'effects.tsx'
/** The prefix of every Client's key; `ui.message` and the tests name them. */
const KEY_PREFIX = 'cv-'
/** The debug trace file when CODEVIBEZ_DEBUG is just switched on (1, on, true): in the session's working directory. */
const TRACE_FILE = 'codevibez-debug.log'
/** The most lines the trace keeps (the oldest go first). */
const TRACE_LIMIT = 3000

const ENGLISH_ON =
  "English view is on. Type /codevibez to see Claude Code's own rows."
const RAW_ON =
  'Raw view is on, showing exactly what ran in Claude Code\'s own rows. Type /codevibez to go back to English.'
const USAGE =
  'Use /codevibez to switch views, /codevibez english or /codevibez raw to pick one, or /codevibez story to read the session so far.'

/** What the effect paths read of a row being drawn. */
type Drawn = ResolveInput & { viewport?: RenderViewport }

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

/** Sets `key`, first dropping the oldest entry when the map is full. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= SEEN_LIMIT) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

/** The element that plays the effects: the terminal and the desktop app have it, other surfaces do not. */
function clientOf($: EngineInterface, e: ResolveInput) {
  return e.surface === 'terminal' || e.surface === 'desktop' ? $.ui.resolve(e).Client : undefined
}

/** The main screen: a finished row is printed into the scrollback and cannot be drawn again. */
function isMainScreen(e: Drawn): boolean {
  return e.surface === 'terminal' && e.viewport?.isFullscreen !== true
}

/** The room an effect Client takes inside a row: the screen's width less the 2 columns of margin. */
function widthOf(e: Drawn): number {
  return Math.max(20, Math.min(512, e.viewport?.columns ?? 80) - 2)
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
  const row = (line: Sentence, key: string, indent: boolean) => (
    <Box key={key} paddingLeft={indent ? 2 : 0}>
      <Text {...LOOK[line.tone]}>{rowText(line, isRunning)}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column">
      {lines.flatMap((narration, index) => [
        row(narration.action, `a${index}`, index > 0),
        narration.outcome === undefined ? null : row(narration.outcome, `o${index}`, true),
      ])}
    </Box>
  )
}

// ---- the debug trace ---------------------------------------------------------------------------
//
// Off unless the environment variable CODEVIBEZ_DEBUG is set when Claude Code starts. Set to a file path it writes the
// trace there; set to 1, on or true it writes codevibez-debug.log in the session's working directory. The trace says
// what each effect decision saw and chose, what the effects module did on the drawing thread, and every fault, so a
// session where an effect "never shows" can be read afterwards. It writes a file and nothing else: no row, prompt or
// tool call is touched by it.

/** The trace: `path` is undefined until the variable is read, null when the trace is off. */
type Trace = { path: string | null | undefined; lines: string[]; busy: boolean; dirty: boolean }

async function traceOn($: EngineInterface, trace: Trace): Promise<boolean> {
  if (trace.path === undefined) {
    try {
      const value = ((await $.env.get('CODEVIBEZ_DEBUG')) ?? '').trim()
      if (trace.path === undefined) {
        trace.path = value === '' || /^(0|off|false)$/i.test(value) ? null : /^(1|on|true)$/i.test(value) ? TRACE_FILE : value
        if (trace.path !== null) trace.lines.push(`trace on, writing ${trace.path}`)
      }
    } catch {
      if (trace.path === undefined) trace.path = null
    }
  }
  return typeof trace.path === 'string'
}

/** Adds one line; does nothing while the trace is off or its variable has not been read. */
function note(trace: Trace, text: string): void {
  if (typeof trace.path !== 'string') return
  trace.lines.push(`${new Date().toISOString().slice(11, 23)} ${text}`)
  if (trace.lines.length > TRACE_LIMIT) trace.lines.splice(0, trace.lines.length - TRACE_LIMIT)
  trace.dirty = true
}

/** Writes the whole trace (the file API has no append), one write at a time; a failed write only loses the trace. */
function flushTrace($: EngineInterface, trace: Trace): void {
  if (typeof trace.path !== 'string' || trace.busy || !trace.dirty) return
  trace.busy = true
  trace.dirty = false
  $.fs
    .write(trace.path, `${trace.lines.join('\n')}\n`)
    .catch(() => undefined)
    .then(() => {
      trace.busy = false
      if (trace.dirty) flushTrace($, trace)
    })
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** One ToolUse draw as the trace tells it: the row's state, what the bookkeeping holds of it, and which effects it got. */
function rowLine(
  id: string,
  view: CallView,
  record: Seen,
  now: number,
  where: string,
  mainScreen: boolean,
  lines: readonly FxLine[] | null,
): string {
  const state = view.isRunning ? 'running' : isResolved(view) ? 'done' : 'waiting'
  const flags = (line: FxLine): string =>
    `${line.settleFrom !== null ? 'S' : ''}${line.shimmerFrom !== null ? 'H' : ''}` || '-'
  const effect = lines === null ? 'none' : lines.map(flags).join(',')
  return (
    `row ${id.slice(-6)} ${view.tool} ${state}${view.isErrored ? ' err' : ''}${view.isInterrupted ? ' intr' : ''}` +
    ` live=${record.live} age=${now - record.firstAt} running=${record.runningAt === null ? '-' : now - record.runningAt}` +
    ` finished=${record.finishedAt === null ? '-' : now - record.finishedAt} main=${mainScreen} ${where} fx=${effect}`
  )
}

/** What the effect paths share with `register`: the settings, the fault flag as it stands, and the per-session maps (mutated in place). */
type FxState = {
  effects: Effects
  failed: boolean
  seen: Map<string, Seen>
  groupSince: Map<string, number>
  wakeAt: Map<string, number>
  trace: Trace
}

// A finished row that is playing an effect asks for one more draw when the
// effect ends, so the row goes back to plain text. A failure here only means
// the idle element stays until the row's next draw.
function scheduleWake(
  $: EngineInterface,
  wakeAt: Map<string, number>,
  trace: Trace,
  id: string,
  end: number,
  now: number,
): void {
  try {
    if (wakeAt.get(id) === end) return
    remember(wakeAt, id, end)
    note(trace, `wake ${id.slice(-6)} due in ${Math.max(0, end - now) + WAKE_LINGER_MS}ms`)
    $.clock.after(Math.max(0, end - now) + WAKE_LINGER_MS, () => {
      wakeAt.delete(id)
      note(trace, `wake ${id.slice(-6)} fires`)
      $.state.set({ plugin: 'codevibez', key: 'wake', id } as const, end).catch(() => undefined)
      flushTrace($, trace)
    })
  } catch (error) {
    note(trace, `wake ${id.slice(-6)} not scheduled: ${errorText(error)}`)
    wakeAt.delete(id)
  }
}

// One call's row while an effect plays, or null for the still row. Any
// throw gives the still English row, never Claude Code's own.
async function rowEffect(
  $: EngineInterface,
  fx: FxState,
  e: Drawn & { props: { tool_use_id: string; isExpanded?: boolean } },
  view: CallView,
  narration: Narration,
): Promise<RenderElement | null> {
  let tracing = false
  const id = e.props.tool_use_id
  try {
    tracing = await traceOn($, fx.trace)
    if (fx.failed || e.props.isExpanded === true) {
      if (tracing) note(fx.trace, `row ${id.slice(-6)} still: ${fx.failed ? 'effects failed' : 'expanded view'}`)
      return null
    }
    const Client = clientOf($, e)
    if (Client === undefined) {
      if (tracing) note(fx.trace, `row ${id.slice(-6)} still: no Client on ${e.surface}`)
      return null
    }
    const now = await $.clock.now()
    const record = noteSeen(fx.seen.get(id), view, now)
    remember(fx.seen, id, record)
    const mainScreen = isMainScreen(e)
    const lines = rowFx({ view, narration, seen: record, now, effects: fx.effects, mainScreen })
    if (tracing) {
      const shown = JSON.stringify((e.props as unknown as { onScreen?: unknown }).onScreen ?? null)
      const where = `viewport=${e.viewport?.columns ?? '?'}x${e.viewport?.rows ?? '?'} fullscreen=${String(e.viewport?.isFullscreen)} onScreen=${shown}`
      note(fx.trace, rowLine(id, view, record, now, where, mainScreen, lines))
    }
    if (lines === null) return null
    const end = fxEnd(lines)
    if (isResolved(view) && end !== null) {
      scheduleWake($, fx.wakeAt, fx.trace, id, end, now)
      // Reading it ties this row to the wake write, which draws exactly this row again.
      await $.state.get({ plugin: 'codevibez', key: 'wake', id } as const)
    }
    return (
      <Client
        key={`${KEY_PREFIX}row-${id}`}
        module="./effects.tsx"
        width={widthOf(e)}
        props={{ kind: 'lines', drawnAt: now, lines, debug: tracing } satisfies FxProps}
      />
    )
  } catch (error) {
    if (tracing) note(fx.trace, `row ${id.slice(-6)} still: the effect path threw: ${errorText(error)}`)
    return null
  } finally {
    if (tracing) flushTrace($, fx.trace)
  }
}

// A group's count line while one of its calls runs, or null for the still line.
async function groupEffect(
  $: EngineInterface,
  fx: FxState,
  e: Drawn & { requestId: string; props: { isActive: boolean } },
  calls: readonly CallView[],
  lines: readonly Narration[],
): Promise<RenderElement | null> {
  let tracing = false
  try {
    if (!fx.effects.shimmer || fx.failed) return null
    tracing = await traceOn($, fx.trace)
    const Client = clientOf($, e)
    if (Client === undefined) return null
    const running = e.props.isActive && calls.some(call => call.isRunning)
    if (tracing) {
      note(
        fx.trace,
        `group ${e.requestId.slice(-6)} calls=${calls.length} active=${String(e.props.isActive)} running=${String(running)} ` +
          `viewport=${e.viewport?.columns ?? '?'}x${e.viewport?.rows ?? '?'} fullscreen=${String(e.viewport?.isFullscreen)}`,
      )
    }
    if (!running) {
      fx.groupSince.delete(e.requestId)
      return null
    }
    const now = await $.clock.now()
    const since = fx.groupSince.get(e.requestId) ?? now
    remember(fx.groupSince, e.requestId, since)
    const shimmer = groupFx({ narrations: lines, running, since, effects: fx.effects })
    if (shimmer === null) return null
    return (
      <Client
        key={`${KEY_PREFIX}group-${e.requestId}`}
        module="./effects.tsx"
        width={widthOf(e)}
        props={{ kind: 'lines', drawnAt: now, lines: shimmer, debug: tracing } satisfies FxProps}
      />
    )
  } catch (error) {
    if (tracing) note(fx.trace, `group ${e.requestId.slice(-6)} still: the effect path threw: ${errorText(error)}`)
    return null
  } finally {
    if (tracing) flushTrace($, fx.trace)
  }
}

export const register: Register = (on, options) => {
  // Which motion effects are on: each has its own setting.
  const effects = normalizeEffects(options)
  const animated = anyEffect(effects)
  // A fault in the effects module turns every effect off for the rest of the process.
  let effectsFailed = false
  // When each call was first drawn here, and how its row has moved on since.
  const seen = new Map<string, Seen>()
  // When each running group's line first moved.
  const groupSince = new Map<string, number>()
  // The finished rows that have a redraw coming when their effect ends.
  const wakeAt = new Map<string, number>()
  // The debug trace (CODEVIBEZ_DEBUG); off, it holds nothing and writes nothing.
  const trace: Trace = { path: undefined, lines: [], busy: false, dirty: false }
  // The story pane's roll-in: which rows are new since it last drew.
  let roll: Roll = ROLL_START

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
  // What the effect functions read, with the fault flag as it stands at the draw.
  const fxState = (): FxState => ({ effects, failed: effectsFailed, seen, groupSince, wakeAt, trace })
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
      // Reopening shows the story still; only lines added after this roll in.
      roll = ROLL_START
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
          const moving = animated ? await rowEffect($, fxState(), e, view, narration) : null
          tree = moving ?? draw($, e, [narration], view.isRunning)
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
          if (lines !== null) {
            const moving = animated ? await groupEffect($, fxState(), e, calls, lines) : null
            tree = moving ?? draw($, e, lines, false)
          }
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
      // The lines added since the pane last drew type themselves in, one after another.
      const Client = effects.storyRoll && !effectsFailed ? clientOf($, e) : undefined
      if (rows.length === 0) {
        // An empty story is the pane's first draw too: what comes after it rolls in.
        if (Client !== undefined && roll.total < 0) {
          try {
            roll = nextRoll(roll, 0, await $.clock.now())
          } catch {
            // The lines then show whole.
          }
        }
        return <Text dimColor>Nothing has happened yet. Each prompt you type starts a chapter here.</Text>
      }
      // The pane opens short, so it shows the newest steps that fit.
      const { shown, hidden } = fitNewest(rows, e.props.bodyColumns, e.props.scroll.bodyRows)
      let now = 0
      let rolling: Array<FxLine | null> = []
      let tracing = false
      if (Client !== undefined) {
        try {
          tracing = await traceOn($, trace)
          now = await $.clock.now()
          roll = nextRoll(roll, rows.length, now)
          rolling = shown.map((row, index) => rollFx(row, hidden + index, roll, now))
        } catch (error) {
          if (tracing) note(trace, `pane still: the roll threw: ${errorText(error)}`)
          rolling = []
        }
        if (tracing) {
          note(
            trace,
            `pane rows=${rows.length} shown=${shown.length} hidden=${hidden} roll=${roll.total}/${roll.from} rolling=${rolling.filter(line => line !== null).length}`,
          )
          flushTrace($, trace)
        }
      }
      return (
        <Box flexDirection="column">
          {hidden > 0 && (
            <Text key="hidden" dimColor>
              {hidden} earlier {hidden === 1 ? 'line' : 'lines'} not shown; the newest are below
            </Text>
          )}
          {shown.map((row, index) => {
            const fx = Client === undefined ? null : (rolling[index] ?? null)
            const body =
              Client !== undefined && fx !== null ? (
                <Client
                  key={`${KEY_PREFIX}story-${hidden + index}`}
                  module="./effects.tsx"
                  width={Math.max(10, e.props.bodyColumns - (row.kind === 'heading' ? 0 : 2))}
                  props={{ kind: 'lines', drawnAt: now, lines: [fx], debug: tracing } satisfies FxProps}
                />
              ) : row.kind === 'heading' ? (
                <Text bold>{row.text}</Text>
              ) : (
                <Text {...(row.kind === 'note' ? LOOK.read : LOOK[row.tone ?? 'info'])}>{row.text}</Text>
              )
            return row.kind === 'heading' ? (
              <Box key={`h${index}`} marginTop={index === 0 ? 0 : 1}>
                {body}
              </Box>
            ) : (
              <Box key={`l${index}`} paddingLeft={2}>
                {body}
              </Box>
            )
          })}
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
    // The trace only notes when a call starts and ends, so a row's draws can be read against it; it never waits.
    const call = e as Record<string, unknown>
    note(trace, `tool.call ${String(call.tool_use_id).slice(-6)} ${String(call.tool)} starts`)
    const ran = await next(e)
    note(
      trace,
      `tool.call ${String(call.tool_use_id).slice(-6)} ends${ran.deny !== undefined ? ' (denied)' : ''}${ran.isError === true ? ' (error)' : ''}`,
    )
    flushTrace($, trace)
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

  // The effects module posts only its debug reports (the trace is on). Otherwise this
  // answers the test seam: asked, it hands the instance props it cannot draw, so it
  // fails for real (`ui.fault`).
  on('ui.message', async ($, e) => {
    if (!e.element.startsWith(KEY_PREFIX)) return {}
    const data = e.data
    if (isRecord(data) && data.type === 'fault') return { props: {} }
    // The module's own reports, sent only while the trace is on.
    if (isRecord(data) && data.type === 'cv') {
      note(trace, `module ${e.element} ${JSON.stringify(data)}`)
      flushTrace($, trace)
    }
    return {}
  })

  // An effects module that fails is left out: every effect goes off for the
  // process and the rows draw still, as with the effects switched off.
  on('ui.fault', async ($, e, next) => {
    // Always in the trace, whichever module it was: a fault is the one way every effect goes off for good.
    note(trace, `FAULT ${e.module} ${e.element} phase=${e.phase} on ${e.surface}/${e.component}: ${e.reason}`)
    flushTrace($, trace)
    if (e.module.endsWith(EFFECTS_MODULE)) {
      effectsFailed = true
      try {
        $.ui.invalidate('ui.render')
      } catch {
        // The rows draw still the next time they are drawn.
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
