import { describe, expect, test } from 'claude-code/testing'

import type { FxLine } from '../types'
import * as client from '../hooks/effects.tsx'
import {
  FRAME_MS,
  ROLL_LINE_MS,
  ROLL_MAX,
  ROLL_STAGGER_MS,
  ROLL_START,
  SETTLE_MS,
  SETTLE_STEP_MS,
  fxEnd,
  fxLook,
  groupFx,
  isResolved,
  nextRoll,
  noteSeen,
  rollFx,
  rowFx,
  rowText,
} from '../hooks/motion.ts'
import type { Seen } from '../hooks/motion.ts'
import type { CallView, Narration, Sentence, Tone } from '../hooks/narrate.ts'
import { DEFAULT_EFFECTS, anyEffect, normalizeEffects } from '../hooks/settings.ts'
import type { Effects } from '../hooks/settings.ts'
import type { StoryRow } from '../hooks/story.ts'

const ALL: Effects = DEFAULT_EFFECTS
const NONE: Effects = { shimmer: false, settle: false, storyRoll: false }

const sentence = (glyph: string, text: string, tone: Tone): Sentence => ({ glyph, text, tone })

const view = (rest: Partial<CallView> = {}): CallView => ({
  tool: 'Bash',
  input: { command: 'x' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...rest,
})

const running = (): CallView => view({ isRunning: true })
const finished = (): CallView => view({ output: { stdout: 'ok', stderr: '', interrupted: false } })
const failedView = (): CallView => view({ isErrored: true, output: 'Exit code 1' })

const info: Narration = { action: sentence('→', 'Checking everything still works', 'info') }
const infoThenFail: Narration = { ...info, outcome: sentence('✗', '3 of 42 checks failed', 'failure') }
const infoThenPass: Narration = { ...info, outcome: sentence('✓', 'All checks pass', 'success') }
const danger: Narration = { action: sentence('⚠', "Deleting 'dist/' and everything inside it", 'danger') }

const T0 = 1_000_000

describe('settings', () => {
  test('the defaults are all on, and each switch is its own', () => {
    expect(normalizeEffects({})).toEqual({ shimmer: true, settle: true, storyRoll: true })
    expect(normalizeEffects({ shimmer: 'off' })).toEqual({ shimmer: false, settle: true, storyRoll: true })
    expect(normalizeEffects({ storyRoll: 'off' })).toEqual({ shimmer: true, settle: true, storyRoll: false })
    expect(normalizeEffects({ settle: 'maybe' }).settle).toBe(true)
    expect(anyEffect(ALL)).toBe(true)
    expect(anyEffect(NONE)).toBe(false)
    expect(anyEffect({ ...NONE, settle: true })).toBe(true)
  })
})

describe('constants', () => {
  test('the effects module carries the same numbers as motion.ts', () => {
    expect(client.FRAME_MS).toBe(FRAME_MS)
    expect(client.SETTLE_MS).toBe(SETTLE_MS)
    expect(client.SETTLE_STEP_MS).toBe(SETTLE_STEP_MS)
  })
})

describe('what a row remembers', () => {
  test('a first view with output is not live; an unresolved one is', () => {
    expect(noteSeen(undefined, finished(), T0).live).toBe(false)
    expect(noteSeen(undefined, failedView(), T0).live).toBe(false)
    expect(noteSeen(undefined, view(), T0).live).toBe(true)
    expect(noteSeen(undefined, running(), T0).live).toBe(true)
  })

  test('running then resolved sets runningAt then finishedAt, and firstAt never moves', () => {
    const first = noteSeen(undefined, view(), T0)
    expect(first).toEqual({ live: true, firstAt: T0, runningAt: null, finishedAt: null })
    const second = noteSeen(first, running(), T0 + 100)
    expect(second).toEqual({ live: true, firstAt: T0, runningAt: T0 + 100, finishedAt: null })
    const third = noteSeen(second, finished(), T0 + 900)
    expect(third).toEqual({ live: true, firstAt: T0, runningAt: T0 + 100, finishedAt: T0 + 900 })
    expect(noteSeen(third, finished(), T0 + 2000)).toEqual(third)
  })

  test('a row that was first seen resolved never gets a finishedAt', () => {
    const seen = noteSeen(noteSeen(undefined, finished(), T0), finished(), T0 + 50)
    expect(seen.finishedAt).toBeNull()
    expect(isResolved(finished())).toBe(true)
    expect(isResolved(running())).toBe(false)
  })

  test('rowText ends a running step in an ellipsis, once', () => {
    expect(rowText(info.action, false)).toBe('→ Checking everything still works')
    expect(rowText(info.action, true)).toBe('→ Checking everything still works…')
    expect(rowText(sentence('→', 'Waiting…', 'info'), true)).toBe('→ Waiting…')
  })
})

describe('rowFx', () => {
  const live = (patch: Partial<Seen> = {}): Seen => ({ live: true, firstAt: T0, runningAt: null, finishedAt: null, ...patch })
  const fx = (input: Partial<Parameters<typeof rowFx>[0]> & Pick<Parameters<typeof rowFx>[0], 'view' | 'narration'>) =>
    rowFx({ seen: live(), now: T0, effects: ALL, mainScreen: false, ...input })

  test('a row first seen resolved gives null', () => {
    const seen: Seen = { live: false, firstAt: T0, runningAt: null, finishedAt: null }
    expect(fx({ view: finished(), narration: infoThenPass, seen })).toBeNull()
  })

  test('a running danger action gives null', () => {
    expect(fx({ view: running(), narration: danger, seen: live({ runningAt: T0 }) })).toBeNull()
  })

  test('the failure outcome of a live finished row gets settle only', () => {
    // Finished a while after it ran, so only the settle is left.
    const finishedAt = T0 + 2000
    const seen = live({ runningAt: T0, finishedAt })
    const lines = fx({ view: failedView(), narration: infoThenFail, seen, now: finishedAt })
    expect(lines).not.toBeNull()
    const outcome = lines?.[1] as FxLine
    expect(outcome.text).toBe('✗ 3 of 42 checks failed')
    expect(outcome.indent).toBe(true)
    expect(outcome.settleFrom).toBe(finishedAt)
    expect(outcome.reveal).toBeNull()
    expect(outcome.shimmerFrom).toBeNull()
    expect(outcome.look).toEqual({ color: 'error', bold: true, dimColor: false })
    const action = lines?.[0] as FxLine
    expect(action.reveal).toBeNull()
    expect(action.settleFrom).toBeNull()
  })

  test('a running info row shimmers from when it ran, and its sentence is never revealed', () => {
    const early = fx({ view: running(), narration: info, seen: live({ runningAt: T0 + 100 }), now: T0 + 100 })
    expect(early?.[0]?.reveal).toBeNull()
    expect(early?.[0]?.shimmerFrom).toBe(T0 + 100)
    expect(early?.[0]?.text).toBe('→ Checking everything still works…')
    const late = fx({ view: running(), narration: info, seen: live({ runningAt: T0 + 100 }), now: T0 + 5000 })
    expect(late?.[0]?.reveal).toBeNull()
    expect(late?.[0]?.shimmerFrom).toBe(T0 + 100)
    // Not yet noted as running: the light starts at this draw.
    expect(fx({ view: running(), narration: info, seen: live(), now: T0 + 300 })?.[0]?.shimmerFrom).toBe(T0 + 300)
  })

  test('the main screen draws a resolved row still; a running one still moves', () => {
    const seen = live({ runningAt: T0, finishedAt: T0 })
    expect(fx({ view: failedView(), narration: infoThenFail, seen, mainScreen: true })).toBeNull()
    expect(fx({ view: running(), narration: info, seen: live({ runningAt: T0 }), mainScreen: true })).not.toBeNull()
  })

  test('the settle window closes after 300 ms', () => {
    // Finished a while after it ran, so the settle is the only effect left to close.
    const finishedAt = T0 + 2000
    const seen = live({ runningAt: T0, finishedAt })
    expect(fx({ view: failedView(), narration: infoThenFail, seen, now: finishedAt + SETTLE_MS - 1 })).not.toBeNull()
    expect(fx({ view: failedView(), narration: infoThenFail, seen, now: finishedAt + SETTLE_MS })).toBeNull()
  })

  test('failures and destructive steps give no row effect before they finish', () => {
    const lines = fx({ view: view(), narration: danger })
    expect(lines).toBeNull()
    const failing: Narration = { action: sentence('✗', 'It broke', 'failure') }
    expect(fx({ view: view(), narration: failing })).toBeNull()
  })

  test('each effect is controlled by its own switch', () => {
    const seen = live({ runningAt: T0, finishedAt: T0 })
    expect(fx({ view: running(), narration: info, seen: live({ runningAt: T0 }), effects: { ...NONE, shimmer: true } })?.[0]?.shimmerFrom).toBe(T0)
    expect(fx({ view: view(), narration: info, effects: { ...NONE, shimmer: true, settle: true } })).toBeNull()
    expect(fx({ view: running(), narration: info, seen: live({ runningAt: T0 }), effects: { ...NONE, settle: true } })).toBeNull()
    expect(fx({ view: failedView(), narration: infoThenFail, seen, effects: { ...NONE, shimmer: true } })).toBeNull()
    expect(fx({ view: failedView(), narration: infoThenFail, seen, effects: NONE })).toBeNull()
  })
})

describe('fxEnd', () => {
  const line = (patch: Partial<FxLine>): FxLine => ({
    text: '→ x',
    look: fxLook({}),
    indent: false,
    reveal: null,
    settleFrom: null,
    shimmerFrom: null,
    ...patch,
  })

  test('any shimmer gives null', () => {
    expect(fxEnd([line({ shimmerFrom: T0 }), line({ settleFrom: T0 })])).toBeNull()
  })

  test('settles give the later end, and a line with no effect gives none', () => {
    expect(fxEnd([line({ settleFrom: T0 }), line({ settleFrom: T0 + 1000 })])).toBe(T0 + 1000 + SETTLE_MS)
    expect(fxEnd([line({ settleFrom: T0 })])).toBe(T0 + SETTLE_MS)
    expect(fxEnd([line({})])).toBeNull()
  })
})

describe('groupFx', () => {
  const reads: Narration[] = [
    { action: sentence('→', 'Getting familiar with your code (3 files)', 'read'), outcome: sentence('✓', 'Done', 'success') },
  ]

  test('not running gives null', () => {
    expect(groupFx({ narrations: reads, running: false, since: T0, effects: ALL })).toBeNull()
    expect(groupFx({ narrations: reads, running: true, since: T0, effects: { ...ALL, shimmer: false } })).toBeNull()
  })

  test('running with a read first line shimmers line 0 only', () => {
    const lines = groupFx({ narrations: reads, running: true, since: T0, effects: ALL })
    expect(lines?.map(line => line.shimmerFrom)).toEqual([T0, null])
    expect(lines?.[0]?.text).toBe('→ Getting familiar with your code (3 files)')
    expect(lines?.[1]?.indent).toBe(true)
  })

  test('a danger line in the group does not shimmer', () => {
    const mixed: Narration[] = [reads[0] as Narration, danger]
    const lines = groupFx({ narrations: mixed, running: true, since: T0, effects: ALL })
    expect(lines?.map(line => line.shimmerFrom)).toEqual([T0, null, null])
    expect(groupFx({ narrations: [danger], running: true, since: T0, effects: ALL })).toBeNull()
  })
})

describe('the story roll', () => {
  const line = (text: string, tone: StoryRow['tone'] = 'info'): StoryRow => ({ kind: 'line', text, tone })

  test('the first draw rolls nothing', () => {
    const roll = nextRoll(ROLL_START, 5, T0)
    expect(roll).toEqual({ total: 5, from: 5, at: T0 })
    expect(rollFx(line('a'), 4, roll, T0)).toBeNull()
  })

  test('new rows roll one after another', () => {
    const roll = nextRoll({ total: 5, from: 5, at: T0 }, 8, T0 + 1000)
    expect(roll).toEqual({ total: 8, from: 5, at: T0 + 1000 })
    const starts = [5, 6, 7].map(index => rollFx(line('a'), index, roll, T0 + 1000)?.reveal?.from)
    expect(starts).toEqual([T0 + 1000, T0 + 1000 + ROLL_STAGGER_MS, T0 + 1000 + 2 * ROLL_STAGGER_MS])
    expect(rollFx(line('a'), 4, roll, T0 + 1000)).toBeNull()
  })

  test('only the newest 8 of many roll', () => {
    const roll = nextRoll({ total: 5, from: 5, at: T0 }, 25, T0 + 1000)
    expect(roll.from).toBe(25 - ROLL_MAX)
    expect(rollFx(line('a'), 16, roll, T0 + 1000)).toBeNull()
    expect(rollFx(line('a'), 17, roll, T0 + 1000)).not.toBeNull()
  })

  test('a redraw of the same story continues the roll; fewer rows reset it', () => {
    const roll = { total: 8, from: 5, at: T0 }
    expect(nextRoll(roll, 8, T0 + 100)).toBe(roll)
    expect(nextRoll(roll, 6, T0 + 100)).toEqual({ total: 6, from: 6, at: T0 + 100 })
  })

  test('failures and destructive steps appear whole; a line is still after its window', () => {
    const roll = { total: 8, from: 5, at: T0 }
    expect(rollFx(line('x', 'danger'), 5, roll, T0)).toBeNull()
    expect(rollFx(line('x', 'failure'), 5, roll, T0)).toBeNull()
    expect(rollFx(line('x', 'success'), 5, roll, T0)?.look).toEqual({ color: 'success', bold: false, dimColor: false })
    expect(rollFx(line('x'), 5, roll, T0 + ROLL_LINE_MS - 1)).not.toBeNull()
    expect(rollFx(line('x'), 5, roll, T0 + ROLL_LINE_MS)).toBeNull()
  })

  test('headings are bold and notes dim', () => {
    const roll = { total: 8, from: 5, at: T0 }
    expect(rollFx({ kind: 'heading', text: 'Add it' }, 5, roll, T0)?.look).toEqual({ color: null, bold: true, dimColor: false })
    expect(rollFx({ kind: 'note', text: 'No steps.' }, 5, roll, T0)?.look).toEqual({ color: null, bold: false, dimColor: true })
  })
})

describe('the effects module frames', () => {
  const base: FxLine = {
    text: '→ Looking at existing code',
    look: fxLook({}),
    indent: false,
    reveal: null,
    settleFrom: null,
    shimmerFrom: null,
  }
  const cps = Array.from(base.text).length

  test('the reveal shows the glyph at once, everything at its end, a blank before it starts', () => {
    const line: FxLine = { ...base, reveal: { from: T0, ms: ROLL_LINE_MS } }
    expect(client.revealed(line, T0 - 1)).toBeNull()
    expect(client.revealed(line, T0)).toBe(1)
    expect(client.revealed(line, T0 + ROLL_LINE_MS)).toBe(cps)
    expect(client.revealed(line, T0 + ROLL_LINE_MS / 2)).toBe(Math.ceil(cps / 2))
    expect(client.revealed(base, T0)).toBe(cps)
    expect(client.lineRuns(line, T0 - 1)).toEqual([{ text: ' ', look: base.look }])
    expect(client.lineRuns(line, T0)).toEqual([{ text: '→', look: base.look }])
  })

  test('the settle steps at 0, 100, 200 and 300 ms', () => {
    const line: FxLine = { ...base, settleFrom: T0 }
    expect([0, 100, 200, 300].map(ms => client.settleStep(line, T0 + ms))).toEqual([0, 1, 2, 3])
    expect(client.settleStep(base, T0)).toBe(3)
  })

  test('a settling failure line goes from grey to bold red', () => {
    const line: FxLine = { ...base, look: { color: 'error', bold: true, dimColor: false }, settleFrom: T0 }
    expect(client.lineRuns(line, T0)).toEqual([{ text: base.text, look: { color: null, bold: false, dimColor: true } }])
    expect(client.lineRuns(line, T0 + 100)[0]?.look).toEqual({ color: 'error', bold: false, dimColor: true })
    expect(client.lineRuns(line, T0 + 200)[0]?.look).toEqual({ color: 'error', bold: false, dimColor: false })
    expect(client.lineRuns(line, T0 + 300)).toEqual([{ text: base.text, look: { color: 'error', bold: true, dimColor: false } }])
  })

  test('a shimmering line lights three cells, one bold, and dims the rest', () => {
    const line: FxLine = { ...base, shimmerFrom: T0 }
    // The light enters from the left: at 100 ms its centre is on the second cell.
    const runs = client.lineRuns(line, T0 + 2 * FRAME_MS)
    const lit = runs.filter(run => run.look.color === 'text')
    expect(lit.map(run => Array.from(run.text).length).reduce((a, b) => a + b, 0)).toBe(3)
    expect(runs.filter(run => run.look.bold).map(run => run.text)).toEqual([' '])
    const dim = runs.filter(run => run.look.color === null)
    expect(dim.every(run => run.look.dimColor && !run.look.bold)).toBe(true)
    expect(runs.map(run => run.text).join('')).toBe(base.text)
    // One frame later the light is one cell to the right.
    const next = client.lineRuns(line, T0 + 3 * FRAME_MS)
    const where = (r: typeof runs): number => {
      let at = 0
      for (const run of r) {
        if (run.look.bold) return at
        at += Array.from(run.text).length
      }
      return -1
    }
    expect(where(next)).toBe(where(runs) + 1)
  })

  test('the light waits out a reveal and rests dark between sweeps', () => {
    const typing: FxLine = { ...base, reveal: { from: T0, ms: ROLL_LINE_MS }, shimmerFrom: T0 + ROLL_LINE_MS }
    expect(client.shimmerCenter(typing, T0 + 100)).toBeNull()
    expect(client.shimmerCenter(typing, T0 + ROLL_LINE_MS)).toBe(-client.SHIMMER_HALF)
    const line: FxLine = { ...base, shimmerFrom: T0 }
    const period = cps + 2 * client.SHIMMER_HALF + 1 + client.SHIMMER_GAP
    // Past the line's end nothing is lit.
    const gap = client.lineRuns(line, T0 + FRAME_MS * (cps + 2 * client.SHIMMER_HALF + 2))
    expect(gap.every(run => run.look.color === null && run.look.dimColor)).toBe(true)
    // After a whole period the sweep starts again.
    expect(client.shimmerCenter(line, T0 + FRAME_MS * period)).toBe(-client.SHIMMER_HALF)
  })

  test('a line is active while it shimmers, reveals or settles, and not after', () => {
    expect(client.lineActive({ ...base, shimmerFrom: T0 }, T0 + 99_999)).toBe(true)
    expect(client.lineActive({ ...base, reveal: { from: T0, ms: ROLL_LINE_MS } }, T0 + 100)).toBe(true)
    expect(client.lineActive({ ...base, reveal: { from: T0, ms: ROLL_LINE_MS } }, T0 + ROLL_LINE_MS)).toBe(false)
    expect(client.lineActive({ ...base, settleFrom: T0 }, T0 + 200)).toBe(true)
    expect(client.lineActive({ ...base, settleFrom: T0 }, T0 + 300)).toBe(false)
    expect(client.lineActive(base, T0)).toBe(false)
  })

  test('the frame key changes with what is on screen and not otherwise', () => {
    const line: FxLine = { ...base, reveal: { from: T0, ms: ROLL_LINE_MS } }
    expect(client.frameKey([line], T0)).not.toBe(client.frameKey([line], T0 + 100))
    expect(client.frameKey([line], T0 + ROLL_LINE_MS)).toBe(client.frameKey([line], T0 + ROLL_LINE_MS + 500))
    const shimmer: FxLine = { ...base, shimmerFrom: T0 }
    const farPast = (frames: number): string => client.frameKey([shimmer], T0 + FRAME_MS * frames)
    expect(farPast(cps + 5)).toBe(farPast(cps + 6))
  })
})
