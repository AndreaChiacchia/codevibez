import { describe, expect, it } from 'vitest';

import { detectDanger } from '../src/bash.ts';
import { translateBash } from '../src/rules/bash-rules.ts';

// Rules added after the engine was vendored (see engine/PROVENANCE.md):
// permission changes and dropped data are destructive, so they get the same
// unsoftened danger line as a deletion.
describe('permission changes', () => {
  it('flags chmod with its target', () => {
    expect(detectDanger('chmod 777 deploy.sh')).toEqual({
      reason: 'permissions',
      target: 'deploy.sh',
      recursive: false,
    });
  });

  it('says when the change reaches everything inside a folder', () => {
    const line = translateBash('sudo chown -R www-data:www-data /var/www', 'plain');
    expect(line.severity).toBe('danger');
    expect(line.text).toBe(
      "Changing who can open or change '/var/www' and everything inside it",
    );
  });

  it('keeps a mode written like an option from hiding the target', () => {
    expect(detectDanger('chmod -x run.sh')?.target).toBe('run.sh');
  });

  it('names permissions plainly for a developer too', () => {
    const line = translateBash('chmod -R 700 secrets/', 'developer');
    expect(line.text).toBe('Changing permissions on secrets/ (entire folder)');
  });
});

describe('dropped data', () => {
  it('flags a DROP TABLE sent to a database client', () => {
    const line = translateBash('psql -c "DROP TABLE IF EXISTS users;"', 'plain');
    expect(line.severity).toBe('danger');
    expect(line.text).toBe('Permanently erasing stored data (table users)');
  });

  it('flags TRUNCATE in sqlite', () => {
    expect(detectDanger('sqlite3 app.db "TRUNCATE TABLE orders"')).toEqual({
      reason: 'drop-data',
      target: 'table orders',
    });
  });

  it('flags dropdb, a Redis flush and a Prisma reset', () => {
    expect(detectDanger('dropdb shop_dev')?.reason).toBe('drop-data');
    expect(detectDanger('redis-cli FLUSHALL')?.target).toBe('everything stored in Redis');
    expect(detectDanger('npx prisma migrate reset --force')?.reason).toBe('drop-data');
  });

  it('leaves a read-only query alone', () => {
    expect(detectDanger('psql -c "SELECT count(*) FROM users"')).toBeNull();
  });

  it('still lets a deletion outrank a permission change beside it', () => {
    expect(detectDanger('chmod +x a.sh && rm -rf build/')?.reason).toBe('delete');
  });
});
