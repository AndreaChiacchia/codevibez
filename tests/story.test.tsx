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

    await $.turn.start({ text: 'Add a login page, please.', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf dist/' })
    await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await $.turn.start({ text: 'now explain it', turnId: 't2' } as never)

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

  test('says so when nothing has happened yet', async $ => {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'codevibez-story', props: PANE })
      expect((await ui.find({ type: 'Text' }))?.text).toContain('Nothing has happened yet')
      await ui.unmount()
    }
  })
})
