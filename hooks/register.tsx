import type { EngineInterface, Register, RenderElement, ResolveInput } from 'claude-code'

import type { View } from '../types'
import { createLedger, observe, summarize } from './ledger.ts'
import { describeCall, describeGroup, isKnownTool } from './narrate.ts'
import type { CallView, Narration, Sentence, Tone } from './narrate.ts'

/**
 * codevibez: plain English in place of Claude Code's raw tool rows.
 *
 * Observe only. Every hook here either draws a row or passes the event on
 * untouched; none of them refuses, rewrites, retries or delays a tool call,
 * a prompt or a permission decision. Anything unexpected (a tool it does not
 * know, a row of another shape, a throw) leaves Claude Code's own row.
 */

const VIEW = { plugin: 'codevibez', key: 'view' } as const
const MEMO_LIMIT = 500

const ENGLISH_ON =
  "English view is on. Type /codevibez to see Claude Code's own rows."
const RAW_ON =
  'Raw view is on, showing exactly what ran in Claude Code\'s own rows. Type /codevibez to go back to English.'
const USAGE =
  'Use /codevibez to switch views, or /codevibez english or /codevibez raw.'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  const memo = new Map<string, Narration | null>()
  // Whether each call's row was drawn in English, so its result block below
  // follows the same choice.
  const drawnInEnglish = new Map<string, boolean>()

  const narrate = (id: string, view: CallView): Narration | null => {
    const key = `${id}|${view.isRunning}|${view.isErrored}|${view.isInterrupted}|${view.output === undefined}`
    if (memo.has(key)) return memo.get(key) ?? null
    const narration = describeCall(view)
    if (memo.size >= MEMO_LIMIT) {
      const oldest = memo.keys().next().value
      if (oldest !== undefined) memo.delete(oldest)
    }
    memo.set(key, narration)
    if (drawnInEnglish.size >= MEMO_LIMIT) {
      const oldest = drawnInEnglish.keys().next().value
      if (oldest !== undefined) drawnInEnglish.delete(oldest)
    }
    drawnInEnglish.set(id, narration !== null)
    return narration
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'codevibez',
        description: "Switch between plain English and Claude Code's own tool rows",
        argumentHint: '[english|raw]',
        immediate: true,
      })
    } catch {
      // Without the command the English still draws; nothing to interrupt.
    }
    return next(e)
  })

  on('command.run', { command: 'codevibez' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
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

  on('turn.start', (_$, e, next) => {
    ledger = createLedger()
    return next(e)
  })

  on('tool.call', async (_$, e, next) => {
    const ran = await next(e)
    try {
      const { tool, tool_use_id: _id, agentId: _agent, ...input } = e as Record<string, unknown>
      observe(ledger, {
        tool: String(tool),
        input,
        isError: ran.isError === true,
        isDenied: ran.deny !== undefined,
        result: ran.result,
        text: typeof ran.text === 'string' ? ran.text : '',
      })
    } catch {
      // A summary that misses one call beats a session that stalls on it.
    }
    return ran
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    try {
      const line = (await currentView($)) === 'english' ? summarize(ledger) : null
      if (line !== null) $.ui.log(line)
    } catch {
      // No summary line is better than a turn that cannot end.
    }
    ledger = createLedger()
    return ran
  })
}
