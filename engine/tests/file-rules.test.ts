import { describe, expect, it } from './kit.ts';
import { translateFileTool } from '../src/rules/file-rules.ts';

describe('translateFileTool', () => {
  it('renders Read as read tier and names files only for developers', () => {
    expect(
      translateFileTool(
        'Read',
        { file_path: '/project/src/auth.ts' },
        'developer',
      ),
    ).toMatchObject({
      glyph: '→',
      tier: 'read',
      text: 'Reading auth.ts',
    });
    expect(
      translateFileTool(
        'Read',
        { file_path: '/project/src/auth.ts' },
        'plain',
      )?.text,
    ).toBe('Looking at existing code');
  });

  it('renders Grep and Glob as read tier searches', () => {
    expect(
      translateFileTool('Grep', { pattern: 'TODO' }, 'plain'),
    ).toMatchObject({
      tier: 'read',
      text: 'Searching through the code',
    });
    expect(
      translateFileTool('Glob', { pattern: '**/*.ts' }, 'developer')?.text,
    ).toBe('Finding files matching **/*.ts');
  });

  it('distinguishes a new Write from an overwrite', () => {
    const fresh = translateFileTool(
      'Write',
      {
        file_path: '/project/src/limit.ts',
        codevibez_exists: false,
      },
      'plain',
    );
    expect(fresh).toMatchObject({
      glyph: '✎',
      tier: 'action',
      stem: 'Writing new code',
      facts: '(1 new file)',
      text: 'Writing new code (1 new file)',
    });

    expect(
      translateFileTool(
        'Write',
        {
          file_path: '/project/src/limit.ts',
          codevibez_exists: true,
        },
        'developer',
      )?.text,
    ).toBe('Rewriting limit.ts');
  });

  it('keeps Edit counts separate from the canonical stem', () => {
    const plain = translateFileTool(
      'Edit',
      { file_path: '/project/src/server.ts' },
      'plain',
    );
    expect(plain).toMatchObject({
      stem: "Updating the app's code",
      facts: '(1 file)',
      text: "Updating the app's code (1 file)",
    });
    expect(
      translateFileTool(
        'Edit',
        { file_path: '/project/src/server.ts' },
        'developer',
      )?.text,
    ).toBe('Updating server.ts');
  });

  it('handles MultiEdit as one updated file', () => {
    expect(
      translateFileTool(
        'MultiEdit',
        { file_path: '/project/src/server.ts' },
        'plain',
      ),
    ).toMatchObject({
      facts: '(1 file)',
      text: "Updating the app's code (1 file)",
    });
  });

  it('returns null for an unknown tool so the dispatcher can use its generic line', () => {
    expect(translateFileTool('WebFetch', {}, 'plain')).toBeNull();
  });

  it('handles missing and unusual values without throwing', () => {
    expect(() => translateFileTool('Edit', {}, 'plain')).not.toThrow();
    expect(() =>
      translateFileTool('Read', { file_path: 42 }, 'developer'),
    ).not.toThrow();
  });
});
