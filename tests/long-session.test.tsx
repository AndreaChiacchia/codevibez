import type { RenderPropsOf } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Chapter } from '../types'

import { STILL } from './fixtures.tsx'

// A long session through every hook, so story writes, the chapter cap and the
// time per step stay bounded. The kit stops a test at 20 seconds; 0.2.1 took
// longer than that for these sessions.
const PANE: RenderPropsOf['Pane'] = {
  title: 'The story so far',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

type Writes = { count: number; bytes: number; story: Chapter[] }

function engine(on: On): Writes {
  const writes: Writes = { count: 0, bytes: 0, story: [] }
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.log', () => ({ value: undefined }))
  on('state.set', async (_$, e, next) => {
    const value = (e as { value: unknown }).value
    if (Array.isArray(value)) {
      writes.count += 1
      writes.bytes += JSON.stringify(value).length
      writes.story = value as Chapter[]
    }
    return next(e)
  })
  on('tool.call', (_$, e) => {
    const failing = String((e as { command?: unknown }).command ?? '').includes('fail')
    return failing
      ? { isError: true, result: 'Exit code 1\nboom', text: 'Exit code 1\nboom' }
      : { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return writes
}

async function turn($: Engine, id: string, steps: number, failEvery: number): Promise<void> {
  await $.turn.start({ text: `prompt ${id}`, turnId: id } as never)
  for (let step = 0; step < steps; step += 1) {
    const failing = (step + 1) % failEvery === 0
    await $.tool.call({ tool: 'Bash', command: failing ? `node fail-${step}.js` : `ls dir${step}` })
  }
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)
}

for (const paneOpen of [false, true]) {
  test(`1,200 steps over 60 turns, story pane ${paneOpen ? 'open' : 'closed'}`, STILL, async ($, on) => {
    const writes = engine(on)
    if (paneOpen) await $.command.run({ command: 'codevibez', args: 'story' } as never)
    const started = Date.now()
    for (let index = 0; index < 60; index += 1) await turn($, `t${index}`, 20, 10)
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(10_000)
    if (!paneOpen) {
      expect(writes.count).toBe(0)
    } else {
      // About one write per turn end, not one per step.
      expect(writes.count).toBeLessThan(200)
      expect(writes.bytes).toBeLessThan(10_000_000)
      expect(writes.story).toHaveLength(50)
      const ui = await $.ui.mount({ plugin: 'codevibez', surface: 'terminal', component: 'Pane', requestId: 'codevibez-story', props: PANE })
      expect((await ui.find({ type: 'Text', text: /This turn/ }))?.text).toContain('This turn')
      await ui.unmount()
    }
  })

  test(`one turn of 2,000 steps, half failing, story pane ${paneOpen ? 'open' : 'closed'}`, STILL, async ($, on) => {
    const writes = engine(on)
    if (paneOpen) await $.command.run({ command: 'codevibez', args: 'story' } as never)
    const started = Date.now()
    await turn($, 'long', 2000, 2)
    expect(Date.now() - started).toBeLessThan(10_000)
    if (!paneOpen) {
      expect(writes.count).toBe(0)
    } else {
      expect(writes.count).toBeLessThan(10)
      const chapter = writes.story[writes.story.length - 1]
      // 2,000 steps make 3,000 lines: each passing step one line, each failing
      // step its action and its ✗. The chapter keeps its first 200 lines (66 of
      // them failures), 300 more failures and the summary, and counts the rest
      // exactly: 1,000 failures in all, so 634 failures are counted, not shown.
      expect(chapter?.lines.length).toBe(501)
      expect((chapter?.lines.length ?? 0) - 1 + (chapter?.more ?? 0)).toBe(3000)
      expect(chapter?.serious).toBe(634)
    }
  })
}
