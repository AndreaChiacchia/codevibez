import type { DangerHint } from './rules/bash-rules.ts';
import { formatPrompt } from './prompt.ts';
import { translateBash } from './rules/bash-rules.ts';
import { translateFileTool } from './rules/file-rules.ts';
import { translateOutcome } from './rules/outcome-rules.ts';
import type { Level, Line, CodevibezEvent } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dangerHint(value: unknown): DangerHint | undefined {
  if (
    !isRecord(value) ||
    typeof value.count !== 'number' ||
    typeof value.cap !== 'boolean'
  ) {
    return undefined;
  }
  return { count: value.count, cap: value.cap };
}

function serialize(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return '[unavailable tool input]';
  }
}

function genericToolLine(
  tool: unknown,
  raw: Record<string, unknown>,
  level: Level,
): Line {
  const name = typeof tool === 'string' && tool !== '' ? tool : 'unknown';
  const stem =
    level === 'plain'
      ? 'Using one of its built-in tools'
      : `Doing something with a helper tool (${name})`;
  return {
    glyph: '→',
    id: 'tool.generic',
    level,
    stem,
    text: stem,
    severity: 'info',
    tier: 'action',
    raw: serialize(raw),
    generic: true,
  };
}

export function translate(
  event: CodevibezEvent,
  level: Level,
): Line | null {
  try {
    switch (event.kind) {
      case 'prompt': {
        const original = typeof event.text === 'string' ? event.text : '';
        const prompt = formatPrompt(original);
        const stem = `Working on: "${prompt}"`;
        return {
          glyph: '●',
          id: 'prompt.chapter',
          level,
          stem,
          text: stem,
          severity: 'info',
          tier: 'action',
          raw: original.slice(0, 200),
        };
      }

      case 'tool.pre': {
        const raw = isRecord(event.raw) ? event.raw : {};
        if (event.tool === 'Bash' && typeof raw.command === 'string') {
          return {
            ...translateBash(
              raw.command,
              level,
              dangerHint(raw.hint),
            ),
            level,
          };
        }
        const fileLine =
          typeof event.tool === 'string'
            ? translateFileTool(event.tool, raw, level)
            : null;
        return fileLine === null
          ? genericToolLine(event.tool, raw, level)
          : { ...fileLine, level };
      }

      case 'tool.post':
        {
          const outcome = translateOutcome(event, level);
          return outcome === null ? null : { ...outcome, level };
        }

      case 'agent.done':
        return null;
      default:
        return null;
    }
  } catch {
    if (event.kind === 'tool.pre') {
      return genericToolLine(event.tool, {}, level);
    }
    return null;
  }
}
