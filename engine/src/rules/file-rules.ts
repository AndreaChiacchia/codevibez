import type { Level, Line } from '../types.ts';

function baseName(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0) return 'a file';
  return path.split(/[\\/]/).pop() || 'a file';
}

function rawText(raw: Record<string, unknown>): string {
  try {
    return JSON.stringify(raw).slice(0, 200);
  } catch {
    return '[unavailable tool input]';
  }
}

function makeLine(
  raw: Record<string, unknown>,
  glyph: Line['glyph'],
  tier: Line['tier'],
  stem: string,
  facts?: string,
  id = 'file.edit',
): Line {
  return {
    glyph,
    id,
    stem,
    ...(facts === undefined ? {} : { facts }),
    text: facts === undefined ? stem : `${stem} ${facts}`,
    tier,
    severity: 'info',
    raw: rawText(raw),
  };
}

export function translateFileTool(
  tool: string,
  raw: Record<string, unknown>,
  level: Level,
): Line | null {
  switch (tool) {
    case 'Read':
      return makeLine(
        raw,
        '→',
        'read',
        level === 'plain'
          ? 'Looking at existing code'
          : `Reading ${baseName(raw.file_path)}`,
        undefined,
        'file.read',
      );

    case 'Grep':
      return makeLine(
        raw,
        '→',
        'read',
        level === 'plain'
          ? 'Searching through the code'
          : `Searching for ${
              typeof raw.pattern === 'string'
                ? `'${raw.pattern}'`
                : 'a pattern'
            }`,
        undefined,
        'file.search',
      );

    case 'Glob':
      return makeLine(
        raw,
        '→',
        'read',
        level === 'plain'
          ? 'Searching through the code'
          : `Finding files matching ${
              typeof raw.pattern === 'string' ? raw.pattern : 'a pattern'
            }`,
        undefined,
        'file.search',
      );

    case 'Write': {
      const exists = raw.codevibez_exists === true;
      if (level === 'plain') {
        return exists
          ? makeLine(
              raw,
              '✎',
              'action',
              "Rewriting one of the app's files",
              undefined,
              'file.write.over',
            )
          : makeLine(
              raw,
              '✎',
              'action',
              'Writing new code',
              '(1 new file)',
              'file.write.new',
            );
      }
      return exists
        ? makeLine(
            raw,
            '✎',
            'action',
            `Rewriting ${baseName(raw.file_path)}`,
            undefined,
            'file.write.over',
          )
        : makeLine(
            raw,
            '✎',
            'action',
            `Writing ${baseName(raw.file_path)}`,
            '(new file)',
            'file.write.new',
          );
    }

    case 'Edit':
    case 'MultiEdit':
      return level === 'plain'
        ? makeLine(
            raw,
            '✎',
            'action',
            "Updating the app's code",
            '(1 file)',
          )
        : makeLine(
            raw,
            '✎',
            'action',
            `Updating ${baseName(raw.file_path)}`,
          );

    default:
      return null;
  }
}
