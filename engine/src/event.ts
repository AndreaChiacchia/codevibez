import type {
  Agent,
  EventKind,
  CodevibezEvent,
  CodevibezOutcome,
} from './types.ts';

const KINDS: ReadonlySet<string> = new Set([
  'prompt',
  'tool.pre',
  'tool.post',
  'agent.done',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOutcome(value: unknown): value is CodevibezOutcome {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;

  return (
    (value.exitCode === undefined || typeof value.exitCode === 'number') &&
    isOptionalString(value.stdout) &&
    isOptionalString(value.stderr)
  );
}

export function parseEvent(jsonlLine: string): CodevibezEvent | null {
  try {
    const value: unknown = JSON.parse(jsonlLine);
    if (!isRecord(value)) return null;
    if (value.v !== 1) return null;
    if (typeof value.ts !== 'string' || typeof value.session !== 'string') {
      return null;
    }
    if (value.agent !== 'claude-code' && value.agent !== 'codex') return null;
    if (typeof value.kind !== 'string' || !KINDS.has(value.kind)) return null;
    if (!isOptionalString(value.tool) || !isOptionalString(value.text)) {
      return null;
    }
    if (value.raw !== undefined && !isRecord(value.raw)) return null;
    if (value.outcome !== undefined && !isOutcome(value.outcome)) return null;

    return {
      ...value,
      v: 1,
      ts: value.ts,
      session: value.session,
      agent: value.agent as Agent,
      kind: value.kind as EventKind,
    };
  } catch {
    return null;
  }
}
