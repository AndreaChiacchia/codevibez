import { describe, expect, it } from './kit.ts';

import { translateBash } from '../src/rules/bash-rules.ts';

// Broader rules added for 0.2.2 (see engine/PROVENANCE.md), so most routine
// steps read in codevibez's own words instead of falling to the catch-all.
const golden: Array<[string, string]> = [
  ['echo hello', 'Showing a message'],
  ['echo $HOME', "Checking the computer's settings"],
  ['which node', 'Checking where something is on the computer'],
  ['pwd', 'Checking which folder it is working in'],
  ['wc -l README.md', 'Counting what is in a file'],
  ['tail -f server.log', 'Watching a log as it grows'],
  ['node --version', 'Checking which version of node is installed'],
  ['git --version', 'Checking which version of git is installed'],
  ['npm run test:unit', 'Checking everything still works…'],
  ['npm run lint', 'Checking the code for mistakes'],
  ['npm run dev', 'Starting the app'],
  ['npm run db:migrate', "Running the project's 'db:migrate' task"],
  ['npm outdated', 'Checking for newer versions of its building blocks'],
  ['npx prettier --write src', "Tidying the code's layout"],
  ['npx create-next-app@latest web', 'Running a helper tool (create-next-app)'],
  ['pip install requests', 'Adding a ready-made tool to the project'],
  ['python3 -m pip install -e .', 'Adding a ready-made tool to the project'],
  ['brew install jq', 'Adding a ready-made tool to the project'],
  ['make', 'Assembling the app'],
  ['make test', 'Checking everything still works…'],
  ['python3 -m venv .venv', 'Setting up a separate Python workspace'],
  ["python3 - <<'PY'\nprint(1)\nPY", 'Running a quick snippet of code'],
  ['node scripts/seed.js', 'Running a script (seed.js)'],
  ['node -e "console.log(1)"', 'Running a quick snippet of code'],
  ['go run ./cmd/server', 'Starting the program'],
  ['cargo fmt', "Tidying the code's layout"],
  ['xcodebuild -scheme App build', 'Assembling the app'],
  ['NODE_ENV=production npm run build', 'Assembling the app'],
  ['timeout 10 npm test', 'Checking everything still works…'],
  ['/opt/homebrew/bin/node app.js', 'Running a script (app.js)'],
  ['git -C /repo status', 'Checking the state of the work'],
  ['git add src/app.ts', 'Preparing changes for a checkpoint'],
  ['git pull --rebase', 'Bringing in the latest shared work'],
  ['git merge feature/login', 'Combining separate tracks of work'],
  ['git stash', 'Setting unsaved edits aside for later'],
  ['git stash pop', 'Bringing back edits that were set aside'],
  ['du -sh node_modules', 'Checking how much space things take up'],
  ['ps aux | grep node', 'Checking which programs are running'],
  ['kill 12345', 'Stopping a running program'],
  ['docker compose up -d', "Starting the app's services"],
  ['sed -i "" "s/a/b/" f.ts', 'Changing text inside a file'],
  ['jq .dependencies package.json', 'Pulling details out of a data file'],
  ['if [ -f .env ]; then echo yes; fi', 'Checking whether something is there'],
  ['for f in src/*.ts; do echo $f; done', 'Repeating a step'],
  ['clear', 'Clearing the screen'],
  ['sysctl -n hw.ncpu hw.memsize', 'Checking details about the computer'],
  ['system_profiler SPHardwareDataType | head -12', 'Checking details about the computer'],
];

describe('0.2.2 rules', () => {
  for (const [command, text] of golden) {
    it(`plain: ${command.replace(/\n/g, ' ')}`, () => {
      const line = translateBash(command, 'plain');
      expect(line.text).toBe(text);
      expect(line.generic).toBeUndefined();
    });
  }

  it('keeps a commit chain named by the commit, not by git add', () => {
    expect(translateBash("git add math.js && git commit -m 'Fix'", 'plain').text).toBe(
      'Saving a checkpoint of the work (+1 more step)',
    );
  });

  it('still falls to the catch-all for a command it cannot name', () => {
    const line = translateBash('qq-tool --x', 'plain');
    expect(line.generic).toBe(true);
    expect(line.text).toBe("Running one of the project's own tools");
  });

  it('never lets a new rule hide a destructive step', () => {
    expect(translateBash('sudo rm -rf /var/www/app', 'plain').severity).toBe('danger');
    expect(translateBash('NODE_ENV=x rm -rf dist', 'plain').severity).toBe('danger');
    expect(translateBash('timeout 5 git reset --hard HEAD', 'plain').severity).toBe('danger');
    expect(translateBash('timeout -s KILL 10 rm -rf dist', 'plain').text).toBe(
      "Deleting 'dist' and everything inside it",
    );
    expect(translateBash('nohup rm -rf build', 'plain').severity).toBe('danger');
  });
});
