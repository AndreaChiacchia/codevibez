import type { BuiltinToolResults, RenderPropsOf } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { PLUGIN, SURFACES } from './fixtures.tsx'

const PANE: RenderPropsOf['Pane'] = {
  title: 'The story so far',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const ok = (stdout: string): BuiltinToolResults['Bash'] => ({ stdout, stderr: '', interrupted: false })

describe('/codevibez story', () => {
  test('opens the story pane', async ($, on) => {
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    const answer = await $.command.run({ command: 'codevibez', args: 'story' } as never)
    expect(opened).toEqual(['codevibez-story'])
    expect(answer.text).toContain('story of this session is open')
  })

  test('tells each prompt verbatim as a chapter heading, then its steps in English', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('ui.log', () => ({ value: undefined }))
    on('tool.call', (_$, e) => {
      if (e.tool === 'Bash' && e.command === 'npm test') {
        const text = 'Exit code 1\n      Tests  3 failed | 39 passed (42)'
        return { isError: true, result: text, text }
      }
      return { result: ok('') }
    })

    await $.command.run({ command: 'codevibez', args: 'story' } as never)
    await $.turn.start({ text: 'Add a login page, please.', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf dist/' })
    await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await $.turn.start({ text: 'now explain it', turnId: 't2' } as never)
    await $.turn.complete({ answer: 'It adds.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'codevibez-story', props: PANE })
      const shown = (await ui.findAll({ type: 'Text' })).map(found => found.text)
      expect(shown).toEqual([
        'Add a login page, please.',
        '→ Checking everything still works…',
        '✗ 3 of 42 checks failed',
        "⚠ Deleting 'dist/' and everything inside it",
        '✗ This turn: ran 2 commands (1 failed), 3 of 42 checks failed, 1 destructive step.',
        'now explain it',
        'No steps.',
      ])
      expect((await ui.find({ type: 'Text', text: '3 of 42 checks failed' }))?.props).toMatchObject({ color: 'error', bold: true })
      await ui.unmount()
    }
  })

  test('a short pane shows the newest steps and says how many earlier lines are hidden', async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('ui.log', () => ({ value: undefined }))
    on('tool.call', () => ({ result: ok('') }))
    await $.command.run({ command: 'codevibez', args: 'story' } as never)
    await $.turn.start({ text: 'first prompt', turnId: 't1' } as never)
    for (let index = 0; index < 8; index += 1) await $.tool.call({ tool: 'Bash', command: `mkdir step${index}` })
    await $.turn.start({ text: 'second prompt', turnId: 't2' } as never)
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as never)
    const short = { ...PANE, scroll: { offset: 0, bodyRows: 6 } }
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'codevibez-story', props: short })
      const shown = (await ui.findAll({ type: 'Text' })).map(found => found.text)
      expect(shown[0]).toBe('8 earlier lines not shown; the newest are below')
      expect(shown.slice(-3)).toEqual([
        'second prompt',
        "⚠ Deleting 'build' and everything inside it",
        '⚠ This turn: ran 1 command, 1 destructive step.',
      ])
      await ui.unmount()
    }
  })

  test('says so when nothing has happened yet', async $ => {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'codevibez-story', props: PANE })
      expect((await ui.find({ type: 'Text' }))?.text).toContain('Nothing has happened yet')
      await ui.unmount()
    }
  })
})
