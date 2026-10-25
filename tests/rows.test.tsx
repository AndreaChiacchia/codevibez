import { describe, expect, test } from 'claude-code/testing'

import {
  COVERED,
  ENGINE_ROW,
  PLUGIN,
  SURFACES,
  bash,
  deletion,
  engineRows,
  failedCommand,
  failedTests,
  row,
  STILL,
} from './fixtures.tsx'

describe('English in place of each tool row', () => {
  for (const tool of COVERED) {
    test(`${tool.name} draws plain English on terminal and desktop`, STILL, async ($, on) => {
      engineRows(on)
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: tool.props() })
        const line = await ui.find({ type: 'Text', text: tool.expected })
        expect(line?.text).toContain(tool.expected)
        expect(await ui.find({ text: ENGINE_ROW })).toBeUndefined()
        await ui.unmount()
      }
    })
  }

  test('a running call reads as still going, then settles', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const props = row('Bash', bash('npm install express'), { isRunning: true })
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      expect((await ui.find({ type: 'Text' }))?.text).toBe('→ Adding a ready-made tool to the project…')
      await ui.redraw({ ...props, isRunning: false, output: { stdout: 'added 64 packages', stderr: '', interrupted: false } })
      expect((await ui.findAll({ type: 'Text' })).map(found => found.text)).toEqual([
        '→ Adding a ready-made tool to the project',
        '✓ Set up finished (64 packages)',
      ])
      await ui.unmount()
    }
  })
})

describe('failures and destructive steps are never softened', () => {
  test('a failed test run shows the exact counts, in the error color', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: failedTests() })
      const failure = await ui.find({ type: 'Text', text: '3 of 42 checks failed' })
      expect(failure?.text).toBe('✗ 3 of 42 checks failed')
      expect(failure?.props).toMatchObject({ color: 'error', bold: true })
      await ui.unmount()
    }
  })

  test('a failed command keeps its exit code', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: failedCommand() })
      const failure = await ui.find({ type: 'Text', text: /exit code 2/ })
      expect(failure?.text).toBe('✗ Something needed for that step could not be found (exit code 2)')
      expect(failure?.props).toMatchObject({ color: 'error', bold: true })
      await ui.unmount()
    }
  })

  test('the exit code is kept however Claude Code words the error', STILL, async ($, on) => {
    engineRows(on)
    const outputs = [
      'Error: Exit code 1\nls: /no-such-folder-here: No such file or directory',
      '<tool_use_error>Exit code 1\nls: /no-such-folder-here: No such file or directory</tool_use_error>',
      'ls: /no-such-folder-here: No such file or directory\nExit code 1',
    ]
    for (const surface of SURFACES) {
      for (const output of outputs) {
        const props = row('Bash', bash('ls /no-such-folder-here'), { isErrored: true, output })
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
        expect((await ui.find({ type: 'Text', text: /✗/ }))?.text).toBe(
          '✗ Something needed for that step could not be found (exit code 1)',
        )
        await ui.unmount()
      }
    }
  })

  test('a deletion names its target in full, in the warning color', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: deletion() })
      const line = await ui.find({ type: 'Text' })
      expect(line?.text).toBe("⚠ Deleting 'dist/' and everything inside it")
      expect(line?.props).toMatchObject({ color: 'warning', bold: true })
      await ui.unmount()
    }
  })

  test('force pushes, hard resets, permission changes and dropped data are flagged', STILL, async ($, on) => {
    engineRows(on)
    const cases: Array<[string, string]> = [
      ['git push --force origin main', '⚠ Replacing the shared online copy of this work; older versions there are lost'],
      ['git reset --hard HEAD~2', '⚠ Throwing away the last 2 saved checkpoints and any unsaved edits'],
      ['chmod -R 777 public/', "⚠ Changing who can open or change 'public/' and everything inside it"],
      ['psql -c "DROP TABLE users"', '⚠ Permanently erasing stored data (table users)'],
      [': > notes.txt', "⚠ Emptying 'notes.txt'"],
    ]
    for (const surface of SURFACES) {
      for (const [command, expected] of cases) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row('Bash', bash(command)) })
        expect((await ui.find({ type: 'Text' }))?.text).toBe(expected)
        await ui.unmount()
      }
    }
  })

  test('a step you said no to says so', STILL, async ($, on) => {
    engineRows(on)
    const props = row('Edit', { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' }, {
      isErrored: true,
      output: "The user doesn't want to proceed with this tool use. The tool use was rejected.",
    })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      expect((await ui.find({ type: 'Text', text: /Not run/ }))?.text).toBe('✗ Not run: you said no')
      await ui.unmount()
    }
  })

  test('an interrupted step says it stopped', STILL, async ($, on) => {
    engineRows(on)
    const props = row('Bash', bash('npm run build'), { isInterrupted: true, isErrored: true, output: 'Interrupted' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      expect((await ui.find({ type: 'Text', text: /Stopped/ }))?.text).toBe('■ Stopped before it finished')
      await ui.unmount()
    }
  })
})

describe('0.2.1: no raw row first, and no bare catch-all', () => {
  test('a row drawn first with an empty input is English once the input arrives', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const streaming = row('Bash', {}, { isRunning: false })
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: streaming })
      expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
      // Same flags as the first draw: only the input changed.
      await ui.redraw({ ...streaming, input: bash('git log --oneline -3') })
      expect((await ui.find({ type: 'Text' }))?.text).toBe('→ Checking the state of the work')
      await ui.unmount()
    }
  })

  test("an unknown routine command shows the step's own description", STILL, async ($, on) => {
    engineRows(on)
    const props = row('Bash', bash('qq-tool --serve', { description: 'Start the app services' }), {
      output: { stdout: '', stderr: '', interrupted: false },
    })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      expect((await ui.find({ type: 'Text' }))?.text).toBe('→ Start the app services')
      await ui.unmount()
    }
  })

  test('a long or secret-bearing description is cut to 80 characters and scrubbed', STILL, async ($, on) => {
    engineRows(on)
    const long = `Run the importer with token=sk-ant-api03-abcdefghijklmnop ${'and then keep going '.repeat(6)}`
    const props = row('Bash', bash('qq-tool import', { description: long }))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      const shown = (await ui.find({ type: 'Text' }))?.text ?? ''
      expect(shown).toContain('[REDACTED]')
      expect(shown.includes('abcdefghijklmnop')).toBe(false)
      expect(shown.length).toBeLessThanOrEqual(2 + 80 + 1)
      await ui.unmount()
    }
  })

  test('a destructive command with a soothing description keeps its warning', STILL, async ($, on) => {
    engineRows(on)
    const props = row('Bash', bash('rm -rf build', { description: 'Tidy up a little' }), {
      output: { stdout: '', stderr: '', interrupted: false },
    })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      const line = await ui.find({ type: 'Text' })
      expect(line?.text).toBe("⚠ Deleting 'build' and everything inside it")
      expect(line?.props).toMatchObject({ color: 'warning', bold: true })
      await ui.unmount()
    }
  })

  test('a failed, stopped or refused unknown command keeps the rule-based lines', STILL, async ($, on) => {
    engineRows(on)
    const refusal = "The user doesn't want to proceed with this tool use. The tool use was rejected."
    const cases = [
      [row('Bash', bash('my-tool --flag', { description: 'Start the server' }), { isErrored: true, output: 'Exit code 3\nboom' }),
        ["→ Running one of the project's own tools", '✗ Something went wrong while running that step (exit code 3)']],
      [row('Bash', bash('my-tool --flag', { description: 'Start the server' }), { isErrored: true, isInterrupted: true, output: 'Interrupted' }),
        ["→ Running one of the project's own tools", '■ Stopped before it finished']],
      [row('Bash', bash('my-tool --flag', { description: 'Start the server' }), { isErrored: true, isInterrupted: true, output: refusal }),
        ["→ Running one of the project's own tools", '✗ Not run: you said no']],
    ] as const
    for (const surface of SURFACES) {
      for (const [props, expected] of cases) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
        expect((await ui.findAll({ type: 'Text' })).map(found => found.text)).toEqual([...expected])
        await ui.unmount()
      }
    }
  })

  test('a call with no description falls back to the old catch-all', STILL, async ($, on) => {
    engineRows(on)
    const props = row('Bash', { command: 'my-tool --flag' }, { output: { stdout: '', stderr: '', interrupted: false } })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      expect((await ui.find({ type: 'Text' }))?.text).toBe("→ Running one of the project's own tools")
      await ui.unmount()
    }
  })
})

describe('found in the end-to-end test', () => {
  test("a test run with Node's or Python's built-in runner keeps exact counts", STILL, async ($, on) => {
    engineRows(on)
    const nodeFailed = row('Bash', bash('node --test'), {
      isErrored: true,
      output: 'Error: Exit code 1\nnot ok 2 - multiply\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0',
    })
    const nodePassed = row('Bash', bash('sleep 15 && node --test'), {
      output: { stdout: 'ok 1 - add\nok 2 - multiply\n1..2\n# tests 2\n# pass 2\n# fail 0', stderr: '', interrupted: false },
    })
    const pythonFailed = row('Bash', bash('python3 -m unittest'), {
      isErrored: true,
      output: 'Exit code 1\nRan 3 tests in 0.001s\n\nFAILED (failures=1)',
    })
    for (const surface of SURFACES) {
      for (const [props, expected] of [
        [nodeFailed, ['→ Checking everything still works…', '✗ 1 of 2 checks failed']],
        [nodePassed, ['→ Checking everything still works… (+1 more step)', '✓ All checks pass (2 checks)']],
        [pythonFailed, ['→ Checking everything still works…', '✗ 1 of 3 checks failed']],
      ] as const) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
        expect((await ui.findAll({ type: 'Text' })).map(found => found.text)).toEqual([...expected])
        await ui.unmount()
      }
    }
  })

  test('a chain is named by the step it is for, not the filler before it', STILL, async ($, on) => {
    engineRows(on)
    const commit = row('Bash', bash("git add math.js && git commit -m 'First version'"), { output: { stdout: '', stderr: '', interrupted: false } })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: commit })
      expect((await ui.find({ type: 'Text' }))?.text).toBe('→ Saving a checkpoint of the work (+1 more step)')
      await ui.unmount()
    }
  })

  test('a step refused at the permission prompt says it did not run', STILL, async ($, on) => {
    engineRows(on)
    const refusal =
      "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)."
    const cases = [
      row('Bash', bash('rm -rf docs'), { isErrored: true, isInterrupted: true, output: refusal }),
      row('Edit', { file_path: '/repo/math.js', old_string: 'a', new_string: 'b' }, { isErrored: true, isInterrupted: true, output: 'User rejected tool use' }),
    ]
    for (const surface of SURFACES) {
      for (const props of cases) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
        const lines = (await ui.findAll({ type: 'Text' })).map(found => found.text)
        expect(lines[1]).toBe('✗ Not run: you said no')
        expect(lines.join('\n').includes('Stopped')).toBe(false)
        await ui.unmount()
      }
    }
  })

  test('a group of one call is that call\'s own line; a group of to-dos says so', STILL, async ($, on) => {
    engineRows(on)
    const one = [row('TaskCreate', { subject: 'Fix multiply', description: 'x' })]
    const todos = [row('TaskCreate', { subject: 'Fix multiply', description: 'x' }), row('TaskUpdate', { taskId: '1', status: 'completed' })]
    for (const surface of SURFACES) {
      const single = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolGroup', props: { calls: one, isActive: false, isExpanded: false } })
      expect((await single.find({ type: 'Text' }))?.text).toBe('→ Adding a to-do: "Fix multiply"')
      await single.unmount()
      const pair = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolGroup', props: { calls: todos, isActive: false, isExpanded: false } })
      expect((await pair.find({ type: 'Text' }))?.text).toBe('→ Updating its to-do list (2 to-do updates)')
      await pair.unmount()
    }
  })
})

describe('the rows around each call', () => {
  test('the raw result block under a known call is left out', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'ToolResult',
        props: { tool_use_id: 'toolu_r', tool: 'Bash', output: { stdout: 'ok', stderr: '', interrupted: false }, isErrored: false },
      })
      // Claude Code 2.1.304's kit adds where a tree came from (`part`); what matters is an empty box.
      const drawn = (await ui.drawn()) as { type: string; children?: unknown[] }
      expect(drawn.type).toBe('Box')
      expect(drawn.children ?? []).toHaveLength(0)
      await ui.unmount()
    }
  })

  test('a collapsed group gets one count line with exact numbers', STILL, async ($, on) => {
    engineRows(on)
    const calls = [
      row('Read', { file_path: '/repo/a.ts' }),
      row('Read', { file_path: '/repo/b.ts' }),
      row('Read', { file_path: '/repo/c.ts' }),
      row('Grep', { pattern: 'login' }),
    ]
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
      expect((await ui.find({ type: 'Text' }))?.text).toBe('→ Getting familiar with your code (3 files read, 1 search)')
      await ui.unmount()
    }
  })

  test('a failure inside a group is spelled out, not folded away', STILL, async ($, on) => {
    engineRows(on)
    const calls = [
      row('Read', { file_path: '/repo/a.ts' }),
      row('Read', { file_path: '/repo/missing.ts' }, { isErrored: true, output: 'File does not exist.' }),
    ]
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
      const failure = await ui.find({ type: 'Text', text: /failed/ })
      expect(failure?.text).toBe('✗ 1 of 2 steps failed: Could not open the file: something it needed could not be found')
      expect(failure?.props).toMatchObject({ color: 'error', bold: true })
      await ui.unmount()
    }
  })

  test('an expanded group is left to Claude Code, which unfolds it into rows', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'ToolGroup',
        props: { calls: [row('Read', { file_path: '/repo/a.ts' })], isActive: false, isExpanded: true },
      })
      expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
      await ui.unmount()
    }
  })
})

describe('0.2.2: more of Claude Code in plain words', () => {
  test("Claude Code's own tools get plain lines on terminal and desktop", STILL, async ($, on) => {
    engineRows(on)
    const cases: Array<[string, unknown, string]> = [
      ['SendMessage', { to: 'helper', message: 'hi' }, '→ Sending a message to a helper'],
      ['ScheduleWakeup', { delaySeconds: 600, prompt: 'x', reason: 'x' }, '→ Setting a reminder to check back later'],
      ['CronCreate', { cron: '0 9 * * *', prompt: 'x' }, '→ Scheduling a job to repeat'],
      ['EnterWorktree', { name: 'fix' }, '→ Starting work in a separate copy of the project'],
      ['Workflow', { name: 'review' }, '→ Running a planned set of helper steps'],
      ['ReadMcpResourceTool', { server: 's', uri: 'u' }, '→ Reading from a connected service'],
      ['PushNotification', { message: 'done' }, '→ Sending you a notification'],
      ['memory_write', { content: 'x' }, '✎ Saving a note for later'],
    ]
    for (const surface of SURFACES) {
      for (const [tool, input, expected] of cases) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row(tool, input) })
        expect((await ui.find({ type: 'Text' }))?.text).toBe(expected)
        await ui.unmount()
      }
    }
  })

  test('removing a separate copy of the project is a warning', STILL, async ($, on) => {
    engineRows(on)
    const props = row('ExitWorktree', { action: 'remove', discard_changes: true })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      const line = await ui.find({ type: 'Text' })
      expect(line?.text).toBe('⚠ Removing the separate copy of the project and throwing away its unsaved edits')
      expect(line?.props).toMatchObject({ color: 'warning', bold: true })
      await ui.unmount()
    }
  })

  test('a group made only of commands says it is looking around', STILL, async ($, on) => {
    engineRows(on)
    const calls = [row('Bash', bash('ls -la')), row('Bash', bash('git status')), row('Bash', bash('wc -l README.md'))]
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('→ Looking around the project (3 commands)')
  })

  test('a group that wrote files never says it only looked around', STILL, async ($, on) => {
    engineRows(on)
    const written = [row('Bash', bash("cat > a.md <<'EOF'\nhi\nEOF")), row('Bash', bash("cat > README.md <<'EOF'\n# v2\nEOF"))]
    const mixed = [row('Bash', bash('ls -la')), row('Bash', bash("cat > a.md <<'EOF'\nhi\nEOF"))]
    for (const [calls, expected] of [
      [written, '✎ Writing files (2 file writes)'],
      [mixed, '✎ Looking around and writing files (1 command, 1 file write)'],
    ] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolGroup', props: { calls: [...calls], isActive: false, isExpanded: false } })
      expect((await ui.find({ type: 'Text' }))?.text).toBe(expected)
      await ui.unmount()
    }
  })
})

describe('0.2.3: shell writes read like the Write tool', () => {
  test('a heredoc that writes a file and a test run saved to a log read calmly', STILL, async ($, on) => {
    engineRows(on)
    const cases: Array<[string, string, string]> = [
      ["cat > notes.md <<'EOF'\nhello\nEOF", 'Create the notes file', '✎ Writing a file (notes.md)'],
      ['npm test > test.log 2>&1', 'Run tests and save output', '→ Checking everything still works… (output saved to test.log)'],
      ['echo $RESULT > $OUT', 'Save the result', '✎ Writing a file'],
    ]
    for (const surface of SURFACES) {
      for (const [command, description, expected] of cases) {
        const props = row('Bash', bash(command, { description }), { output: { stdout: '', stderr: '', interrupted: false } })
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
        const line = await ui.find({ type: 'Text' })
        expect(line?.text).toBe(expected)
        expect((line?.props as { color?: string } | undefined)?.color).not.toBe('warning')
        await ui.unmount()
      }
    }
  })

  test('emptying a file and sorting a file into itself keep their warning', STILL, async ($, on) => {
    engineRows(on)
    const cases: Array<[string, string]> = [
      [': > notes.txt', "⚠ Emptying 'notes.txt'"],
      ['sort list.txt > list.txt', "⚠ Emptying 'list.txt' before it is read, so what was in it is lost"],
    ]
    for (const surface of SURFACES) {
      for (const [command, expected] of cases) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row('Bash', bash(command)) })
        const line = await ui.find({ type: 'Text' })
        expect(line?.text).toBe(expected)
        expect(line?.props).toMatchObject({ color: 'warning', bold: true })
        await ui.unmount()
      }
    }
  })
})

describe('0.2.3: a call a hook stopped reads as not run', () => {
  // The exact texts Claude Code 2.1.304 gave a live session for each form.
  const EXIT_2 = 'Error: PreToolUse:Bash hook error: [/scratch/block.sh]: Blocked by the test hook (exit 2)\n'
  const JSON_DENY = 'Error: PreToolUse:Bash hook error: Blocked by the test hook (JSON deny)'

  test('both hook-block forms say the step did not run, never that it failed', STILL, async ($, on) => {
    engineRows(on)
    const cases = [
      row('Bash', bash('echo marker'), { isErrored: true, output: EXIT_2 }),
      row('Bash', bash('echo marker'), { isErrored: true, output: JSON_DENY }),
      row('Bash', bash('for f in *.log; do gzip "$f"; done'), { isErrored: true, output: EXIT_2 }),
    ]
    for (const surface of SURFACES) {
      for (const props of cases) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
        const lines = await ui.findAll({ type: 'Text' })
        expect(lines[1]?.text).toBe('✗ Not run: a hook blocked it')
        expect((lines[1]?.props as { color?: string } | undefined)?.color).not.toBe('error')
        expect(lines.map((found) => found.text).join('\n').includes('failure')).toBe(false)
        await ui.unmount()
      }
    }
  })

  test('a collapsed group counts a hook-blocked step as not run', STILL, async ($, on) => {
    engineRows(on)
    const calls = [row('Read', { file_path: '/repo/a.ts' }), row('Bash', bash('ls -la'), { isErrored: true, output: JSON_DENY })]
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
    const shown = (await ui.findAll({ type: 'Text' })).map((found) => found.text)
    expect(shown).toContain('✗ Not run: a hook blocked 1 step')
    expect(shown.join('\n').includes('failed')).toBe(false)
  })

  test('a step that ran and failed stays a failure, whatever its output mentions', STILL, async ($, on) => {
    engineRows(on)
    const cases = [
      row('Bash', bash('npm test'), {
        isErrored: true,
        output: 'Exit code 1\n FAIL hooks.test.ts\n   expected "PreToolUse:Bash hook error: x"\n      Tests  1 failed | 4 passed (5)',
      }),
      row('Bash', bash('curl -f https://example.com'), { isErrored: true, output: 'Exit code 22\nthe request was rejected by the server' }),
    ]
    for (const props of cases) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', props })
      const outcome = (await ui.findAll({ type: 'Text' }))[1]
      expect(outcome?.text.startsWith('✗ Not run')).toBe(false)
      expect((outcome?.props as { color?: string } | undefined)?.color).toBe('error')
      await ui.unmount()
    }
  })
})

describe('leaves what it cannot read to Claude Code', () => {
  test('any other tool gets a plain line that keeps its name', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row('BrandNewTool', { anything: 1 }) })
      expect((await ui.find({ type: 'Text' }))?.text).toBe("→ Using one of Claude Code's tools (brand new tool)")
      await ui.unmount()
    }
  })

  test('a tool whose input is not an object keeps Claude Code\'s own row', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row('BrandNewTool', 'raw text') })
      expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
      await ui.unmount()
    }
  })

  test('an unexpected input shape keeps Claude Code\'s own row', STILL, async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      for (const props of [row('Bash', { cmd: 'ls' }), row('Read', 'not an object'), row('Edit', null)]) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
        expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
        await ui.unmount()
      }
    }
  })

  test('a group holding a call it cannot read keeps Claude Code\'s own line', STILL, async ($, on) => {
    engineRows(on)
    const calls = [row('Read', { file_path: '/repo/a.ts' }), row('Bash', { cmd: 'ls' })]
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
    expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
  })
})

describe('privacy', () => {
  test('secret-looking values never reach an English line', STILL, async ($, on) => {
    engineRows(on)
    const secret = 'sk-ant-api03-abcdefghijklmnop'
    const props = [
      row('WebSearch', { query: `docs for token=${secret}`, mode: 'standard' }),
      row('Agent', { description: `use ${secret}`, prompt: 'x' }),
      row('Bash', bash(`rm -rf /tmp/${secret}/`)),
    ]
    for (const surface of SURFACES) {
      for (const one of props) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: one })
        const shown = (await ui.findAll({ type: 'Text' })).map(found => found.text).join('\n')
        expect(shown).toContain('[REDACTED]')
        expect(shown.includes('abcdefghijklmnop')).toBe(false)
        await ui.unmount()
      }
    }
  })
})
