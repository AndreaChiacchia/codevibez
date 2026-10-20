import type { BuiltinToolResults, ToolCallResult } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ENGINE_ROW, PLUGIN, SURFACES, deletion, engineRows, failedTests, row } from './fixtures.tsx'

const ok = (stdout: string): BuiltinToolResults['Bash'] => ({ stdout, stderr: '', interrupted: false })

async function startTurn($: Engine, text: string): Promise<void> {
  await $.turn.start({ text, turnId: 'turn_1' } as never)
}

/** Stands in for Claude Code beneath the mod at the turn's edges and logging. */
function engineTurns(on: On, logs: string[] = []): string[] {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  return logs
}

async function endTurn($: Engine, agentId?: string): Promise<void> {
  await $.turn.complete({
    answer: 'Done.',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn_1',
    reason: 'answer',
    ...(agentId === undefined ? {} : { agentId }),
  } as never)
}

describe('/codevibez switches the view and says which is on', () => {
  test('toggles to the raw rows and back, on every surface', async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: deletion() })
      expect((await ui.find({ type: 'Text' }))?.text).toContain('Deleting')

      const raw = await $.command.run({ command: 'codevibez', args: '' } as never)
      expect(raw.text).toContain('Raw view is on')
      // The row redraws by itself: it read the view while drawing.
      expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)

      const english = await $.command.run({ command: 'codevibez', args: '' } as never)
      expect(english.text).toContain('English view is on')
      expect((await ui.find({ type: 'Text' }))?.text).toContain('Deleting')
      await ui.unmount()
    }
  })

  test('takes english and raw by name, and explains anything else', async $ => {
    expect((await $.command.run({ command: 'codevibez', args: 'raw' } as never)).text).toContain('Raw view is on')
    expect((await $.command.run({ command: 'codevibez', args: 'raw' } as never)).text).toContain('Raw view is on')
    expect((await $.command.run({ command: 'codevibez', args: 'english' } as never)).text).toContain('English view is on')
    expect((await $.command.run({ command: 'codevibez', args: 'loud' } as never)).text).toContain('/codevibez english')
  })

  test('raw view leaves the result block and the group line to Claude Code', async ($, on) => {
    engineRows(on)
    await $.command.run({ command: 'codevibez', args: 'raw' } as never)
    const result = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'ToolResult',
      props: { tool_use_id: 'toolu_raw', tool: 'Bash', output: ok('hi'), isErrored: false },
    })
    expect((await result.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
    const group = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'ToolGroup',
      props: { calls: [row('Read', { file_path: '/a.ts' })], isActive: false, isExpanded: false },
    })
    expect((await group.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
  })

  test('registers the command when the session starts', async ($, on) => {
    const registered: string[] = []
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', (_$, e) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(registered).toEqual(['codevibez'])
  })
})

describe('turn summary', () => {
  test('one line under the answer, with exact counts and the failure first-class', async ($, on) => {
    const logs = engineTurns(on)
    on('tool.call', (_$, e) => {
      if (e.tool === 'Write') {
        return { result: { type: 'create', filePath: '/repo/login.ts', content: '', structuredPatch: [], originalFile: null } }
      }
      if (e.tool === 'Edit') return { result: { filePath: '/repo/app.ts' } }
      if (e.tool === 'Bash' && e.command === 'npm test') {
        return {
          isError: true,
          result: 'Exit code 1\n      Tests  3 failed | 39 passed (42)',
          text: 'Exit code 1\n      Tests  3 failed | 39 passed (42)',
        }
      }
      return { result: ok('') }
    })

    await startTurn($, 'add a login page')
    await $.tool.call({ tool: 'Write', file_path: '/repo/login.ts', content: 'x' })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/app.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/app.ts', old_string: 'b', new_string: 'c' })
    await $.tool.call({ tool: 'Bash', command: 'npm install express' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf dist/' })
    await endTurn($)

    expect(logs).toEqual([
      '✗ This turn: changed 2 files (1 new), ran 3 commands (1 failed), 3 of 42 checks failed, 1 destructive step.',
    ])
  })

  test('a step you said no to is counted as that, not as a failure or a destructive step', async ($, on) => {
    const logs = engineTurns(on)
    const refusal = "The user doesn't want to proceed with this tool use. The tool use was rejected."
    on('tool.call', (_$, e) => {
      if (e.tool === 'Bash' && e.command === 'rm -rf docs') return { isError: true, result: refusal, text: refusal }
      return { result: ok('') }
    })
    await startTurn($, 'tidy up')
    await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf docs' })
    await endTurn($)
    expect(logs).toEqual(['⚠ This turn: ran 1 command, 1 destructive step, you said no to 1 step.'])
  })

  test('shell writes are not counted as destructive steps; emptying a file is', async ($, on) => {
    const logs = engineTurns(on)
    on('tool.call', () => ({ result: ok('') }))
    await startTurn($, 'write some files')
    await $.tool.call({ tool: 'Bash', command: "cat > notes.md <<'EOF'\nhello\nEOF" })
    await $.tool.call({ tool: 'Bash', command: 'npm test > test.log 2>&1' })
    await $.tool.call({ tool: 'Bash', command: ': > old.txt' })
    await endTurn($)
    expect(logs).toEqual(['⚠ This turn: ran 3 commands, the checks passed, 1 destructive step.'])
  })

  test('steps a hook stopped are counted as not run, never as failures', async ($, on) => {
    const logs = engineTurns(on)
    const exit2 = 'PreToolUse:Bash hook error: [/scratch/block.sh]: Blocked by the test hook (exit 2)\n'
    const deny = 'PreToolUse:Bash hook error: Blocked by the test hook (JSON deny)'
    on('tool.call', (_$, e) => {
      if (e.tool === 'Bash' && e.command === 'echo one') return { isError: true, result: `Error: ${exit2}`, text: exit2 }
      if (e.tool === 'Bash' && e.command === 'echo two') return { isError: true, result: `Error: ${deny}`, text: deny }
      return { result: ok('') }
    })
    await startTurn($, 'try these')
    await $.tool.call({ tool: 'Bash', command: 'echo one' })
    await $.tool.call({ tool: 'Bash', command: 'echo two' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await endTurn($)
    expect(logs).toEqual(['● This turn: ran 1 command, a hook blocked 2 steps.'])
  })

  test('says nothing when nothing changed and nothing ran', async ($, on) => {
    const logs = engineTurns(on)
    on('tool.call', () => ({ result: {} }))
    await startTurn($, 'what does this project do?')
    await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' })
    await endTurn($)
    expect(logs).toEqual([])
  })

  test('a subagent finishing is not the end of the turn', async ($, on) => {
    const logs = engineTurns(on)
    on('tool.call', () => ({ result: ok('') }))
    await startTurn($, 'build it')
    await $.tool.call({ tool: 'Bash', command: 'npm run build' })
    await endTurn($, 'agent_1')
    expect(logs).toEqual([])
    await endTurn($)
    expect(logs).toEqual(['● This turn: ran 1 command.'])
  })

  test('shows nothing in the raw view', async ($, on) => {
    const logs = engineTurns(on)
    on('tool.call', () => ({ result: ok('') }))
    await $.command.run({ command: 'codevibez', args: 'raw' } as never)
    await startTurn($, 'build it')
    await $.tool.call({ tool: 'Bash', command: 'npm run build' })
    await endTurn($)
    expect(logs).toEqual([])
  })
})

describe('observe only', () => {
  test('every tool call reaches Claude Code unchanged and its result comes back unchanged', async ($, on) => {
    const seen: unknown[] = []
    const answers: ToolCallResult[] = [
      { result: ok('fine') },
      { isError: true, result: 'Exit code 1\nboom', text: 'Exit code 1\nboom' },
      { deny: 'blocked by a rule' },
    ]
    let index = 0
    on('tool.call', (_$, e) => {
      seen.push(e)
      const answer = answers[index] ?? answers[0]
      index += 1
      return answer as never
    })
    const calls = [
      { tool: 'Bash', command: 'ls -la' },
      { tool: 'Bash', command: 'npm test' },
      { tool: 'Bash', command: 'rm -rf /' },
    ] as const
    for (const [at, call] of calls.entries()) {
      const result = await $.tool.call({ ...call })
      expect(result).toEqual(answers[at])
      expect(seen[at]).toMatchObject(call)
    }
  })

  test('a failed Bash call reaches the English line and the summary', async ($, on) => {
    engineRows(on)
    const logs = engineTurns(on)
    on('tool.call', () => ({
      isError: true,
      result: 'Exit code 1\n      Tests  3 failed | 39 passed (42)',
      text: 'Exit code 1\n      Tests  3 failed | 39 passed (42)',
    }))
    await startTurn($, 'run the tests')
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: failedTests() })
      expect((await ui.find({ type: 'Text', text: /checks failed/ }))?.text).toBe('✗ 3 of 42 checks failed')
      await ui.unmount()
    }
    await endTurn($)
    expect(logs).toEqual(['✗ This turn: ran 1 command (1 failed), 3 of 42 checks failed.'])
  })
})

describe('fail-open', () => {
  test('when translating a row throws, Claude Code draws its own row', async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      // A group whose calls are not a list makes the translation itself throw.
      const group = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'ToolGroup',
        props: { calls: 42 as never, isActive: false, isExpanded: false },
      })
      expect((await group.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
      await group.unmount()
    }
  })

  test('the turn ends with its own answer, untouched', async ($, on) => {
    const logs = engineTurns(on)
    on('tool.call', () => ({ result: ok('') }))
    await startTurn($, 'build it')
    await $.tool.call({ tool: 'Bash', command: 'npm run build' })
    const ended = await $.turn.complete({
      answer: 'Built.',
      durationMs: 5,
      isAborted: false,
      turnId: 'turn_1',
      reason: 'answer',
    } as never)
    expect(ended.text).toBe('Built.')
    expect(logs).toEqual(['● This turn: ran 1 command.'])
  })
})
