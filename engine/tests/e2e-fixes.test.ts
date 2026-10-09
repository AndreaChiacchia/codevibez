import { describe, expect, it } from './kit.ts';

import { translateBash } from '../src/rules/bash-rules.ts';

// Wording fixed after the end-to-end test of the mod (see engine/PROVENANCE.md).
describe('chains and overwrites', () => {
  it('names a chain by its meaningful step, not the filler before it', () => {
    expect(translateBash("git add math.js && git commit -m 'First version'", 'plain').text).toBe(
      'Saving a checkpoint of the work (+1 more step)',
    );
    expect(translateBash('sleep 15 && node --test', 'plain').text).toBe(
      'Checking everything still works… (+1 more step)',
    );
    expect(translateBash('npm ci && npm test', 'plain').text).toBe(
      "Setting up the project's building blocks (+1 more step)",
    );
  });

  it('does not count moving to a folder as a step', () => {
    expect(translateBash('cd /tmp/project&& grep -rn multiply math.js test', 'plain').text).toBe(
      'Searching through the project',
    );
    expect(translateBash('cd /tmp/project && node --test', 'plain').text).toBe(
      'Checking everything still works…',
    );
    expect(translateBash('cd /tmp/project', 'plain').text).not.toBe('');
  });

  it('never claims an overwritten file had contents it may not have had', () => {
    const line = translateBash('mkdir -p build && echo bundle > build/app.js', 'plain');
    expect(line.severity).toBe('danger');
    expect(line.text).toBe("Writing over 'build/app.js'; anything already in it is lost");
  });
});
