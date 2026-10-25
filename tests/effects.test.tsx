import type { On, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestOptions } from 'claude-code/testing'

import { COVERED, ENGINE_ROW, PLUGIN, SURFACES, bash, bashOutput, engineRows, failedTests, row } from './fixtures.tsx'

// The motion effects, mounted: each test turns on only the effect it checks, unless it says otherwise. The mock clock
// drives the hooks' `$.clock` (a row's age, the wake that ends an effect); `ui.advance` drives the effects module's own
// frame clock.

type Surface = (typeof SURFACES)[number]
type EffectName = 'shimmer' | 'settle' | 'storyRoll'

const FULL = { columns: 100, rows: 40, isFullscreen: true }
const START = 1_000_000

/** Only the named effects on. */
const only = (...names: EffectName[]): TestOptions => ({
  options: {
    shimmer: names.includes('shimmer') ? 'on' : 'off',
    settle: names.includes('settle') ? 'on' : 'off',
    storyRoll: names.includes('storyRoll') ? 'on' : 'off',
  },
})

const EVERYTHING = only('shimmer', 'settle', 'storyRoll')

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function walk(node: unknown, out: Node[] = []): Node[] {
  if (node === null || typeof node !== 'object') return out
  out.push(node as Node)
  for (const child of (node as Node).children ?? []) walk(child, out)
  return out
}

const clients = (node: unknown): Node[] => walk(node).filter(n => n.type === 'Client')

const keyOf = (n: Node): string => String(n.props?.key ?? (n as { key?: unknown }).key)

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  return ((node as Node).children ?? []).map(textOf).join('')
}

type Run = { text: string; color: unknown; bold: unknown; dim: unknown }

/** The Text runs of a tree: the Text nodes that hold only strings, in order. */
const runsOf = (node: unknown): Run[] =>
  walk(node)
    .filter(n => n.type === 'Text' && (n.children ?? []).length > 0 && (n.children ?? []).every(c => typeof c === 'string'))
    .map(n => ({
      text: (n.children ?? []).join(''),
      color: n.props?.color,
      bold: n.props?.bold,
      dim: n.props?.dimColor,
    }))

/** The cells of the module's runs that are lit (colored `text`), by position. */
function lit(runs: Run[]): number[] {
  const out: number[] = []
  let at = 0
  for (const run of runs) {
    for (const _ of Array.from(run.text)) {
      if (run.color === 'text') out.push(at)
      at += 1
    }
  }
  return out
}

type Drawer = {
  drawn: (scope?: { in?: string }) => Promise<unknown>
  advance: (ms: number) => Promise<void>
}

const moduleRuns = async (ui: Drawer, key: string): Promise<Run[]> => runsOf(await ui.drawn({ in: key }))
const moduleText = async (ui: Drawer, key: string): Promise<string> => textOf(await ui.drawn({ in: key }))
const rowKey = (props: { tool_use_id: string }): string => `cv-row-${props.tool_use_id}`

/** What the engine draws beneath the mod, a clock that only the test moves, and an environment with no CODEVIBEZ_DEBUG in it. */
function world(on: On) {
  engineRows(on)
  mock.env(on, {})
  return mock.clock(on, { now: START })
}

const mountRow = ($: Engine, surface: Surface | 'mobile', props: RenderPropsOf['ToolUse'], viewport?: typeof FULL) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props, ...(viewport === undefined ? {} : { viewport }) } as never)

/** The Texts a mounted row draws as plain text, in order. */
const textsOf = async (ui: { findAll: (q: { type: string }) => Promise<Array<{ text?: string }>> }): Promise<string[]> =>
  (await ui.findAll({ type: 'Text' })).map(found => String(found.text))

/** One test per surface the effects draw on. */
function eachSurface(name: string, options: TestOptions | undefined, body: ($: Engine, on: On, surface: Surface) => unknown): void {
  for (const surface of SURFACES) {
    const title = `${name} (${surface})`
    if (options === undefined) test(title, ($, on) => body($, on, surface))
    else test(title, options, ($, on) => body($, on, surface))
  }
}

const RUNNING_INSTALL = () => row('Bash', bash('npm install express'), { isRunning: true })
const INSTALL_TEXT = '→ Adding a ready-made tool to the project'

eachSurface('shimmer: a running step dims and a light of three cells sweeps across it', only('shimmer'), async ($, on, surface) => {
  world(on)
  const props = RUNNING_INSTALL()
  const key = rowKey(props)
  const ui = await mountRow($, surface, props, FULL)
  expect(clients(await ui.drawn()).map(keyOf)).toEqual([key])
  await ui.advance(2 * 50)
  const first = await moduleRuns(ui, key)
  expect(first.map(run => run.text).join('')).toBe(`${INSTALL_TEXT}…`)
  expect(lit(first)).toEqual([0, 1, 2])
  expect(first.filter(run => run.bold === true).map(run => run.text)).toEqual([' '])
  expect(first.filter(run => run.color !== 'text').every(run => run.dim === true)).toBe(true)
  await ui.advance(50)
  expect(lit(await moduleRuns(ui, key))).toEqual([1, 2, 3])
  // Finished, the row is still: no module, and the lines of the effects-off look.
  await ui.redraw({ ...props, isRunning: false, output: bashOutput('added 64 packages') })
  expect(clients(await ui.drawn())).toEqual([])
  expect(await textsOf(ui)).toEqual([INSTALL_TEXT, '✓ Set up finished (64 packages)'])
  await ui.unmount()
})

eachSurface('shimmer off: a running step is still text ending in an ellipsis', only('settle', 'storyRoll'), async ($, on, surface) => {
  world(on)
  const ui = await mountRow($, surface, RUNNING_INSTALL(), FULL)
  expect(clients(await ui.drawn())).toEqual([])
  expect(await textsOf(ui)).toEqual([`${INSTALL_TEXT}…`])
  await ui.unmount()
})

eachSurface('a destructive step never moves, whatever is on', EVERYTHING, async ($, on, surface) => {
  world(on)
  const props = row('Bash', bash('rm -rf dist/'), { isRunning: true })
  const ui = await mountRow($, surface, props, FULL)
  expect(clients(await ui.drawn())).toEqual([])
  const line = await ui.find({ type: 'Text' })
  expect(line?.text).toContain('Deleting')
  expect(line?.props).toMatchObject({ color: 'warning', bold: true })
  await ui.advance(2000)
  expect(clients(await ui.drawn())).toEqual([])
  await ui.unmount()
})

eachSurface('a new sentence appears whole, with every effect on', EVERYTHING, async ($, on, surface) => {
  world(on)
  const ui = await mountRow($, surface, row('Read', { file_path: '/repo/src/app.ts' }), FULL)
  expect(clients(await ui.drawn())).toEqual([])
  expect(await textsOf(ui)).toEqual(['→ Looking at existing code'])
  await ui.unmount()
})

eachSurface('settle: a step that finishes fades into its color, then is still', only('settle'), async ($, on, surface) => {
  const clock = world(on)
  const props = row('Bash', bash('npm test'), { isRunning: true })
  const key = rowKey(props)
  const ui = await mountRow($, surface, props, FULL)
  expect(clients(await ui.drawn())).toEqual([])
  await ui.redraw({ ...props, isRunning: false, isErrored: true, output: failedTests().output })
  expect(clients(await ui.drawn()).map(keyOf)).toEqual([key])
  const last = async (): Promise<Run | undefined> => {
    const runs = await moduleRuns(ui, key)
    return runs[runs.length - 1]
  }
  const outcome = await last()
  expect(outcome?.text).toBe('✗ 3 of 42 checks failed')
  expect(outcome).toMatchObject({ color: undefined, bold: undefined, dim: true })
  await ui.advance(100)
  expect(await last()).toMatchObject({ color: 'error', bold: undefined, dim: true })
  await ui.advance(100)
  expect(await last()).toMatchObject({ color: 'error', bold: undefined, dim: undefined })
  await ui.advance(100)
  expect(await last()).toMatchObject({ color: 'error', bold: true, dim: undefined })
  // The effect's end asks for one more draw, which is the still row. It waits WAKE_LINGER_MS past the end: the host's frame
  // clock beats every 16 ms, so the module's frames come every 64 ms and its time lags the hook's.
  await clock.advance(500)
  expect(clients(await ui.drawn())).toEqual([])
  // The still row is today's: the engine's own sentence for `npm test` ends in … even when finished (rows.test).
  expect(await textsOf(ui)).toEqual(['→ Checking everything still works…', '✗ 3 of 42 checks failed'])
  await ui.unmount()
})

test('settle on the main screen: a finished row takes its color at once', only('settle'), async ($, on) => {
  world(on)
  const props = row('Bash', bash('npm test'), { isRunning: true })
  const ui = await mountRow($, 'terminal', props)
  await ui.redraw({ ...props, isRunning: false, isErrored: true, output: failedTests().output })
  expect(clients(await ui.drawn())).toEqual([])
  expect(await textsOf(ui)).toEqual(['→ Checking everything still works…', '✗ 3 of 42 checks failed'])
  expect((await ui.find({ type: 'Text', text: /3 of 42/ }))?.props).toMatchObject({ color: 'error', bold: true })
  await ui.unmount()
})

eachSurface('rows that are already finished when first drawn never move', EVERYTHING, async ($, on, surface) => {
  world(on)
  for (const tool of COVERED) {
    const props = tool.props()
    // A row with no result yet is a step still to finish, not a finished one.
    if (props.output === undefined) continue
    const ui = await mountRow($, surface, props, FULL)
    expect(clients(await ui.drawn())).toEqual([])
    expect((await ui.find({ type: 'Text', text: tool.expected }))?.text).toContain(tool.expected)
    await ui.unmount()
  }
})

eachSurface('no idle timer: nothing changes after the effects end', only('shimmer', 'settle'), async ($, on, surface) => {
  const clock = world(on)
  const props = RUNNING_INSTALL()
  const ui = await mountRow($, surface, props, FULL)
  expect(clients(await ui.drawn())).toHaveLength(1)
  await ui.redraw({ ...props, isRunning: false, output: bashOutput('added 64 packages') })
  // The ✓ line settles for a moment...
  expect(clients(await ui.drawn())).toHaveLength(1)
  await clock.advance(500)
  // ...and then the row holds no module.
  expect(clients(await ui.drawn())).toEqual([])
  const before = JSON.stringify(await ui.drawn())
  await ui.advance(2000)
  expect(JSON.stringify(await ui.drawn())).toBe(before)
  await ui.unmount()
})

eachSurface('the raw view draws Claude Code\'s own row and nothing moves', EVERYTHING, async ($, on, surface) => {
  world(on)
  await $.command.run({ command: 'codevibez', args: 'raw' } as never)
  const ui = await mountRow($, surface, RUNNING_INSTALL(), FULL)
  expect((await ui.find({ text: ENGINE_ROW }))?.text).toBe(ENGINE_ROW)
  expect(clients(await ui.drawn())).toEqual([])
  await ui.unmount()
})

test('a surface without the effects element shows the rows still', EVERYTHING, async ($, on) => {
  world(on)
  const ui = await mountRow($, 'mobile', RUNNING_INSTALL(), FULL)
  expect(clients(await ui.drawn())).toEqual([])
  expect(await textsOf(ui)).toEqual([`${INSTALL_TEXT}…`])
  await ui.unmount()
})

eachSurface('with no settings given, the manifest defaults have every effect on', undefined, async ($, on, surface) => {
  world(on)
  const props = RUNNING_INSTALL()
  const ui = await mountRow($, surface, props, FULL)
  expect(clients(await ui.drawn()).map(keyOf)).toEqual([rowKey(props)])
  await ui.unmount()
})

eachSurface('story roll: the lines added since the pane last drew type themselves in', only('storyRoll'), async ($, on, surface) => {
  world(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  const pane: RenderPropsOf['Pane'] = {
    title: 'The story so far',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  }
  await $.command.run({ command: 'codevibez', args: 'story' } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'codevibez-story', props: pane })
  expect(clients(await ui.drawn())).toEqual([])
  await $.turn.start({ text: 'Make a folder', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'mkdir a' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await ui.redraw()
  // The heading and the mkdir line roll in; the deleting line and the turn's summary (a destructive step) appear whole.
  expect(clients(await ui.drawn()).map(keyOf)).toEqual(['cv-story-0', 'cv-story-1'])
  expect((await moduleText(ui, 'cv-story-0')).length).toBeLessThan('Make a folder'.length)
  const plain = await textsOf(ui)
  expect(plain).toHaveLength(2)
  expect(plain[0]).toBe("⚠ Deleting 'build' and everything inside it")
  expect(plain[1]).toContain('This turn')
  expect((await ui.find({ type: 'Text', text: /Deleting/ }))?.props).toMatchObject({ color: 'warning', bold: true })
  await ui.advance(1000)
  expect(await moduleText(ui, 'cv-story-0')).toBe('Make a folder')
  expect((await moduleText(ui, 'cv-story-1')).startsWith('→ ')).toBe(true)
  expect((await moduleText(ui, 'cv-story-1')).endsWith('…')).toBe(false)
  await ui.unmount()
})

eachSurface('story roll off: new lines appear at once', only('shimmer', 'settle'), async ($, on, surface) => {
  world(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  const pane: RenderPropsOf['Pane'] = {
    title: 'The story so far',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  }
  await $.command.run({ command: 'codevibez', args: 'story' } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'codevibez-story', props: pane })
  await $.turn.start({ text: 'Make a folder', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'mkdir a' })
  await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await ui.redraw()
  expect(clients(await ui.drawn())).toEqual([])
  expect((await textsOf(ui))[0]).toBe('Make a folder')
  await ui.unmount()
})

eachSurface('group shimmer: the count line of a group moves while one of its reads runs', only('shimmer'), async ($, on, surface) => {
  world(on)
  const calls = [row('Read', { file_path: '/repo/a.ts' }), row('Read', { file_path: '/repo/b.ts' }, { isRunning: true })]
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'ToolGroup',
    requestId: 'g1',
    props: { calls, isActive: true, isExpanded: false },
    viewport: FULL,
  } as never)
  expect(clients(await ui.drawn()).map(keyOf)).toEqual(['cv-group-g1'])
  await ui.advance(100)
  expect(lit(await moduleRuns(ui, 'cv-group-g1'))).toEqual([0, 1, 2])
  expect(await moduleText(ui, 'cv-group-g1')).toBe('→ Getting familiar with your code (2 files read)')
  await ui.redraw({ calls, isActive: false, isExpanded: false })
  expect(clients(await ui.drawn())).toEqual([])
  expect(await textsOf(ui)).toEqual(['→ Getting familiar with your code (2 files read)'])
  await ui.unmount()
})

eachSurface('a fault in the effects module turns every effect off', only('shimmer'), async ($, on, surface) => {
  world(on)
  const props = RUNNING_INSTALL()
  const key = rowKey(props)
  const ui = await mountRow($, surface, props, FULL)
  expect(clients(await ui.drawn()).map(keyOf)).toEqual([key])
  await ui.post({ type: 'fault' }, { in: key }).catch(() => undefined)
  expect(clients(await ui.drawn())).toEqual([])
  expect(await textsOf(ui)).toEqual([`${INSTALL_TEXT}…`])
  const next = await mountRow($, surface, RUNNING_INSTALL(), FULL)
  expect(clients(await next.drawn())).toEqual([])
  expect(await textsOf(next)).toEqual([`${INSTALL_TEXT}…`])
  await next.unmount()
  await ui.unmount()
})
