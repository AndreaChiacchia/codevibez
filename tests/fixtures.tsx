import type {
  BuiltinToolInputs,
  BuiltinToolResults,
  On,
  RenderPropsOf,
} from 'claude-code'
import type { Engine, TestOptions } from 'claude-code/testing'

/**
 * Tool rows shaped like this build's generated types: each input is typed by
 * BuiltinToolInputs and each output by BuiltinToolResults, so a change in a
 * future build's tool shapes fails the type check before it fails a user.
 */

export const PLUGIN = 'codevibez'
export const SURFACES = ['terminal', 'desktop'] as const
export const ENGINE_ROW = 'CLAUDE CODE OWN ROW'

/**
 * Every motion effect off: the tests that check what a row says run with these
 * settings, so they see the still rows and never read a clock. The effects have
 * their own tests (effects.test.tsx).
 */
export const STILL: TestOptions = {
  options: { shimmer: 'off', settle: 'off', storyRoll: 'off' },
}

type ToolUseProps = RenderPropsOf['ToolUse']

let counter = 0

export function row(
  tool: string,
  input: unknown,
  rest: Partial<Omit<ToolUseProps, 'tool' | 'input'>> = {},
): ToolUseProps {
  counter += 1
  return {
    tool_use_id: `toolu_${counter}`,
    tool,
    input,
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    ...rest,
  }
}

const bash = (command: string, more: Partial<BuiltinToolInputs['Bash']> = {}): BuiltinToolInputs['Bash'] => ({
  command,
  description: 'Run a command',
  ...more,
})

const bashOutput = (stdout: string, stderr = ''): BuiltinToolResults['Bash'] => ({
  stdout,
  stderr,
  interrupted: false,
})

const read: BuiltinToolInputs['Read'] = { file_path: '/repo/src/app.ts' }
const readOutput: BuiltinToolResults['Read'] = {
  type: 'text',
  file: { filePath: '/repo/src/app.ts', content: 'export {}', numLines: 1, startLine: 1, totalLines: 1 },
}

const edit: BuiltinToolInputs['Edit'] = {
  file_path: '/repo/src/app.ts',
  old_string: 'a',
  new_string: 'b',
}
const editOutput: BuiltinToolResults['Edit'] = {
  filePath: '/repo/src/app.ts',
  oldString: 'a',
  newString: 'b',
  originalFile: 'a',
  structuredPatch: [],
  userModified: false,
  replaceAll: false,
}

const write: BuiltinToolInputs['Write'] = { file_path: '/repo/src/login.ts', content: 'export {}' }
const writeOutput = (type: 'create' | 'update'): BuiltinToolResults['Write'] => ({
  type,
  filePath: '/repo/src/login.ts',
  content: 'export {}',
  structuredPatch: [],
  originalFile: type === 'update' ? 'old' : null,
})

const webFetch: BuiltinToolInputs['WebFetch'] = {
  url: 'https://docs.example.com/guide',
  prompt: 'Summarize the guide',
}
const webSearch: BuiltinToolInputs['WebSearch'] = { query: 'how to add a login page', mode: 'standard' }
const agent: BuiltinToolInputs['Agent'] = {
  description: 'Find the login code',
  prompt: 'Look through the project and find where login happens.',
  subagent_type: 'Explore',
}
const todos: BuiltinToolInputs['TodoWrite'] = {
  todos: [
    { content: 'Add the page', status: 'completed', activeForm: 'Adding the page' },
    { content: 'Add the form', status: 'in_progress', activeForm: 'Adding the form' },
    { content: 'Test it', status: 'pending', activeForm: 'Testing it' },
  ],
}
const taskCreate: BuiltinToolInputs['TaskCreate'] = { subject: 'Add the login form', description: 'A form' }
const taskUpdate: BuiltinToolInputs['TaskUpdate'] = { taskId: '1', status: 'completed' }
const notebook: BuiltinToolInputs['NotebookEdit'] = {
  notebook_path: '/repo/analysis.ipynb',
  new_source: 'print(1)',
  edit_mode: 'replace',
}
const skill: BuiltinToolInputs['Skill'] = { skill: 'pdf' }
const toolSearch: BuiltinToolInputs['ToolSearch'] = { query: 'select:WebFetch', max_results: 1 }

/**
 * Every covered tool, with the English its finished row must show. Grep and
 * Glob are not registered by this build (its native search replaces them),
 * so their rows use the inputs other builds send.
 */
export const COVERED: ReadonlyArray<{ name: string; props: () => ToolUseProps; expected: string }> = [
  { name: 'Bash', props: () => row('Bash', bash('npm install express'), { output: bashOutput('added 1 package') }), expected: 'Adding a ready-made tool to the project' },
  { name: 'Read', props: () => row('Read', read, { output: readOutput }), expected: 'Looking at existing code' },
  { name: 'Edit', props: () => row('Edit', edit, { output: editOutput }), expected: "Updating the app's code (1 file)" },
  { name: 'Write (new file)', props: () => row('Write', write, { output: writeOutput('create') }), expected: 'Writing new code (1 new file)' },
  { name: 'Write (existing file)', props: () => row('Write', write, { output: writeOutput('update') }), expected: "Rewriting one of the app's files" },
  { name: 'Grep', props: () => row('Grep', { pattern: 'handleLogin', path: 'src' }), expected: 'Searching through the code' },
  { name: 'Glob', props: () => row('Glob', { pattern: '**/*.ts' }), expected: 'Searching through the code' },
  { name: 'WebFetch', props: () => row('WebFetch', webFetch), expected: 'Reading a web page (docs.example.com)' },
  { name: 'WebSearch', props: () => row('WebSearch', webSearch), expected: 'Searching the web for "how to add a login page"' },
  { name: 'Agent', props: () => row('Agent', agent), expected: 'Handing a task to a helper: "Find the login code"' },
  { name: 'TodoWrite', props: () => row('TodoWrite', todos), expected: 'Updating its to-do list (1 of 3 items done)' },
  { name: 'TaskCreate', props: () => row('TaskCreate', taskCreate), expected: 'Adding a to-do: "Add the login form"' },
  { name: 'TaskUpdate', props: () => row('TaskUpdate', taskUpdate), expected: 'Marking a to-do as done' },
  { name: 'NotebookEdit', props: () => row('NotebookEdit', notebook), expected: 'Updating a section of a notebook' },
  { name: 'Skill', props: () => row('Skill', skill), expected: 'Following a saved set of instructions (pdf)' },
  { name: 'ToolSearch', props: () => row('ToolSearch', toolSearch), expected: 'Looking for the right tool for the job' },
  { name: 'MCP tool', props: () => row('mcp__github__create_issue', { title: 'Bug' }), expected: 'Using the connected service "github" (create issue)' },
]

export const failedTests = () =>
  row('Bash', bash('npm test'), {
    isErrored: true,
    output: 'Exit code 1\n\n Test Files  1 failed | 4 passed (5)\n      Tests  3 failed | 39 passed (42)\n',
  })

export const failedCommand = () =>
  row('Bash', bash('node build.js'), {
    isErrored: true,
    output: 'Exit code 2\nError: Cannot find module "./config"',
  })

export const deletion = () =>
  row('Bash', bash('rm -rf dist/'), { output: bashOutput('') })

export { bash, bashOutput }

/**
 * Stands in for Claude Code's own drawing beneath the mod: what a row looks
 * like when codevibez passes it on.
 */
export function engineRows(on: On): void {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{ENGINE_ROW}</Text>
  })
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{ENGINE_ROW}</Text>
  })
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{ENGINE_ROW}</Text>
  })
}

export async function englishView($: Engine): Promise<void> {
  await $.command.run({ command: 'codevibez', args: 'english' } as never)
}
