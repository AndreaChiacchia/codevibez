import { describe, expect, it } from './kit.ts';

import { detectDanger, splitSegments } from '../src/bash.ts';
import { translateBash } from '../src/rules/bash-rules.ts';

// 0.2.3 (see engine/PROVENANCE.md): a `>` redirect is a write, not a loss.
// Shell writes read like the Write tool's rows, and ⚠ stays only where the
// command itself guarantees that something is lost.
function plain(command: string) {
  return translateBash(command, 'plain');
}

describe('shell writes read like the Write tool', () => {
  it('a heredoc that creates a file is writing a file, never showing one', () => {
    for (const command of ["cat > notes.md <<'EOF'\nhello\nEOF", 'cat <<EOF > notes.md\nhello\nEOF', 'tee notes.md <<EOF\nhello\nEOF']) {
      const line = plain(command);
      expect(line.glyph).toBe('✎');
      expect(line.severity).toBe('info');
      expect(line.text).toBe('Writing a file (notes.md)');
    }
  });

  it('echo and printf to a file are writes; >> adds to one', () => {
    expect(plain('echo hi > a.txt').text).toBe('Writing a file (a.txt)');
    expect(plain('printf "%s\\n" a > list.txt').text).toBe('Writing a file (list.txt)');
    expect(plain('echo hi >> app.log').text).toBe('Adding to a file (app.log)');
    expect(plain('echo x | sudo tee /etc/hosts').text).toBe('Writing a file (hosts)');
    expect(plain('cat file.txt > copy.txt').text).toBe('Writing a file (copy.txt)');
  });

  it('a test run with its output in a log is still a test run', () => {
    for (const command of ['npm test > test.log 2>&1', 'npm test > test.log 2>&1 &', 'npm test 2>&1 | tee test.log', 'npm test &> test.log']) {
      const line = plain(command);
      expect(line.severity).toBe('info');
      expect(line.text).toBe('Checking everything still works… (output saved to test.log)');
    }
  });

  it('keeps 2>&1 and &> inside one step', () => {
    expect(splitSegments('npm test > test.log 2>&1')).toEqual(['npm test > test.log 2>&1']);
    expect(splitSegments('npm test &> out.log')).toEqual(['npm test &> out.log']);
    expect(splitSegments('npm run dev > dev.log 2>&1 & echo started')).toEqual(['npm run dev > dev.log 2>&1', 'echo started']);
  });

  it('shell-variable and temp targets are routine', () => {
    expect(plain('echo $X > $OUT').text).toBe('Writing a file');
    expect(detectDanger(': > $TMPDIR/scratch.txt')).toBeNull();
    expect(detectDanger(': > "$LOG"')).toBeNull();
    expect(detectDanger('truncate -s 0 /tmp/run.log')).toBeNull();
    expect(plain('truncate -s 0 /tmp/run.log').text).toBe('Emptying a file (run.log)');
    expect(detectDanger('echo hi > /tmp/scratch/a.txt')).toBeNull();
  });
});

describe('⚠ stays where the command guarantees a loss', () => {
  it('emptying a named file', () => {
    for (const command of [': > data.csv', '> data.csv', 'cat /dev/null > data.csv', 'truncate -s 0 data.csv']) {
      const line = plain(command);
      expect(line.severity).toBe('danger');
      expect(line.text).toBe("Emptying 'data.csv'");
    }
  });

  it('dd writing over a file or device', () => {
    expect(plain('dd if=/dev/zero of=disk.img bs=1m count=1').text).toBe(
      "Writing over 'disk.img'; anything already in it is lost",
    );
  });

  it('writing over a file the same command reads first', () => {
    for (const [command, target] of [
      ['sort list.txt > list.txt', 'list.txt'],
      ["sed 's/a/b/' f.txt > f.txt", 'f.txt'],
      ['cat f.txt | sort > f.txt', 'f.txt'],
    ] as const) {
      const line = plain(command);
      expect(line.severity).toBe('danger');
      expect(line.text).toBe(`Emptying '${target}' before it is read, so what was in it is lost`);
    }
    expect(detectDanger('sort list.txt > sorted.txt')).toBeNull();
    expect(detectDanger('cat a.txt && echo hi > a.txt')).toBeNull();
  });

  it('a redirect never hides a deletion beside it', () => {
    expect(plain('echo hi > a.txt && rm -rf build').text).toBe("Deleting 'build' and everything inside it");
    expect(plain('rm -rf node_modules > /dev/null 2>&1').text).toBe("Deleting 'node_modules' and everything inside it");
  });

  it('a heredoc fed to a shell is still read for danger', () => {
    expect(plain('bash <<EOF\nrm -rf build\nEOF').text).toBe("Deleting 'build' and everything inside it");
  });
});

describe('redirects are read the way the shell reads them', () => {
  it('a file fed in with < and written back with > is lost', () => {
    expect(plain('sort < list.txt > list.txt').text).toBe("Emptying 'list.txt' before it is read, so what was in it is lost");
  });

  it('a backslash line break continues the same command', () => {
    expect(plain('npm run build \\\n  --prod').text).toBe('Assembling the app');
    expect(plain('sort \\\n  data.txt > data.txt').severity).toBe('danger');
  });

  it('only truncating to size 0 empties a file', () => {
    expect(detectDanger('truncate -s 10M disk.img')).toBeNull();
    expect(plain('truncate -s 10M disk.img').text.startsWith('Emptying')).toBe(false);
    expect(plain('truncate --size=0 data.csv').text).toBe("Emptying 'data.csv'");
  });

  it('a > inside a comment, quotes, (( )) or [[ ]] is no redirect', () => {
    expect(detectDanger('cat notes.txt # > notes.txt')).toBeNull();
    expect(plain('npm test # > out.log').text).toBe('Checking everything still works…');
    for (const command of ['grep -n ">" index.html', '(( n > 5 )) && echo big', '[[ $a > $b ]] && echo later']) {
      expect(detectDanger(command)).toBeNull();
      expect(plain(command).text.includes('saved to')).toBe(false);
      expect(plain(command).glyph).not.toBe('✎');
    }
  });

  it('echo and printf read no file, so writing their words is no loss', () => {
    expect(detectDanger('echo notes > notes')).toBeNull();
    expect(detectDanger('printf x > x')).toBeNull();
  });

  it('home and project folders are real files, even with temp in the path', () => {
    expect(plain(': > "$HOME/.bashrc"').text).toBe("Emptying '$HOME/.bashrc'");
    expect(plain(': > src/temp/data.json').text).toBe("Emptying 'src/temp/data.json'");
    expect(detectDanger(': > tmp/run.log')).toBeNull();
    expect(detectDanger(': > $(mktemp)')).toBeNull();
    expect(detectDanger(': > "$dir/out.txt"')).toBeNull();
  });

  it('errors sent to a file are not a write of the command\'s output', () => {
    expect(plain('cat missing.txt 2> err.log').glyph).not.toBe('✎');
    expect(plain('npm test 2> err.log').text).toBe('Checking everything still works… (errors saved to err.log)');
  });

  it('tee to a terminal stream is no file, and --append adds', () => {
    expect(plain('npm test | tee /dev/stderr').text).toBe('Checking everything still works…');
    expect(plain('echo hi | tee --append log.txt').text).toBe('Adding to a file (log.txt)');
  });

  it('process substitution is read as its own command', () => {
    expect(plain('diff <(sort a.txt) <(sort b.txt) > diff.txt').text).toBe('Comparing two files (output saved to diff.txt)');
  });
});
