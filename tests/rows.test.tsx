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
} from './fixtures.tsx'

describe('English in place of each tool row', () => {
  for (const tool of COVERED) {
    test(`${tool.name} draws plain English on terminal and desktop`, async ($, on) => {
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

  test('a running call reads as still going, then settles', async ($, on) => {
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
  test('a failed test run shows the exact counts, in the error color', async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: failedTests() })
      const failure = await ui.find({ type: 'Text', text: '3 of 42 checks failed' })
      expect(failure?.text).toBe('✗ 3 of 42 checks failed')
      expect(failure?.props).toMatchObject({ color: 'error', bold: true })
      await ui.unmount()
    }
  })

  test('a failed command keeps its exit code', async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: failedCommand() })
      const failure = await ui.find({ type: 'Text', text: /exit code 2/ })
      expect(failure?.text).toBe('✗ Something needed for that step could not be found (exit code 2)')
      expect(failure?.props).toMatchObject({ color: 'error', bold: true })
      await ui.unmount()
    }
  })

  test('the exit code is kept however Claude Code words the error', async ($, on) => {
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

  test('a deletion names its target in full, in the warning color', async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: deletion() })
      const line = await ui.find({ type: 'Text' })
      expect(line?.text).toBe("⚠ Deleting 'dist/' and everything inside it")
      expect(line?.props).toMatchObject({ color: 'warning', bold: true })
      await ui.unmount()
    }
  })

  test('force pushes, hard resets, permission changes and dropped data are flagged', async ($, on) => {
    engineRows(on)
    const cases: Array<[string, string]> = [
      ['git push --force origin main', '⚠ Replacing the shared online copy of this work; older versions there are lost'],
      ['git reset --hard HEAD~2', '⚠ Throwing away the last 2 saved checkpoints and any unsaved edits'],
      ['chmod -R 777 public/', "⚠ Changing who can open or change 'public/' and everything inside it"],
      ['psql -c "DROP TABLE users"', '⚠ Permanently erasing stored data (table users)'],
      ['echo hi > notes.txt', "⚠ Overwriting 'notes.txt' and destroying its previous contents"],
    ]
    for (const surface of SURFACES) {
      for (const [command, expected] of cases) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row('Bash', bash(command)) })
        expect((await ui.find({ type: 'Text' }))?.text).toBe(expected)
        await ui.unmount()
      }
    }
  })

  test('a step you said no to says so', async ($, on) => {
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

  test('an interrupted step says it stopped', async ($, on) => {
    engineRows(on)
    const props = row('Bash', bash('npm run build'), { isInterrupted: true, isErrored: true, output: 'Interrupted' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
      expect((await ui.find({ type: 'Text', text: /Stopped/ }))?.text).toBe('■ Stopped before it finished')
      await ui.unmount()
    }
  })
})

describe('the rows around each call', () => {
  test('the raw result block under a known call is left out', async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'ToolResult',
        props: { tool_use_id: 'toolu_r', tool: 'Bash', output: { stdout: 'ok', stderr: '', interrupted: false }, isErrored: false },
      })
      expect(await ui.drawn()).toEqual({ type: 'Box' })
      await ui.unmount()
    }
  })

  test('a collapsed group gets one count line with exact numbers', async ($, on) => {
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

  test('a failure inside a group is spelled out, not folded away', async ($, on) => {
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

  test('an expanded group is left to Claude Code, which unfolds it into rows', async ($, on) => {
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

describe('leaves what it does not know to Claude Code', () => {
  test('an unknown tool keeps Claude Code\'s own row', async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row('BrandNewTool', { anything: 1 }) })
      expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
      await ui.unmount()
    }
  })

  test('an unexpected input shape keeps Claude Code\'s own row', async ($, on) => {
    engineRows(on)
    for (const surface of SURFACES) {
      for (const props of [row('Bash', { cmd: 'ls' }), row('Read', 'not an object'), row('Edit', null)]) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props })
        expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
        await ui.unmount()
      }
    }
  })

  test('a group holding an unknown tool keeps Claude Code\'s own line', async ($, on) => {
    engineRows(on)
    const calls = [row('Read', { file_path: '/repo/a.ts' }), row('BrandNewTool', {})]
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
    expect((await ui.find({ type: 'Text' }))?.text).toBe(ENGINE_ROW)
  })
})

describe('privacy', () => {
  test('secret-looking values never reach an English line', async ($, on) => {
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
