import type { FxLine, FxLook } from '../types';
import type { CallView, Narration, Sentence, Tone } from './narrate.ts';
import type { Effects } from './settings.ts';
import type { StoryRow } from './story.ts';

/**
 * What moves, and when: pure functions from a row's state and the time to the
 * lines the effects module (effects.tsx) plays. No `$`, no clock read here;
 * the hooks pass the time in. The effects only change how a row is drawn.
 */

/** The effects module's frame clock (20 frames a second). */
export const FRAME_MS = 50;
/**
 * How long past an effect's end a finished row's wake waits before it draws the row plain. The host's frame clock beats
 * every 16 ms, so a tick asked every 50 ms arrives every 64 ms or later: the effects module's time lags the hook's, and the
 * wake must not replace the module before it has played its last frames (the module rests on its last frame meanwhile).
 */
export const WAKE_LINGER_MS = 3 * FRAME_MS;
/** How long each of the three steps of the settle into color lasts. */
export const SETTLE_STEP_MS = 100;
/** The whole settle into color. */
export const SETTLE_MS = 300;
/** How long one story line takes to type itself out. */
export const ROLL_LINE_MS = 200;
/** The delay between one rolling story line and the next. */
export const ROLL_STAGGER_MS = 60;
/** The most story lines that roll in at once. */
export const ROLL_MAX = 8;
/** How many calls the per-call records keep. */
export const SEEN_LIMIT = 500;

export type Look = { color?: string; bold?: boolean; dimColor?: boolean };

// Failures and destructive steps are bold and colored; routine reading is dim.
export const LOOK: Readonly<Record<Tone, Look>> = {
  info: {},
  read: { dimColor: true },
  success: { color: 'success' },
  failure: { color: 'error', bold: true },
  danger: { color: 'warning', bold: true },
  stopped: { color: 'warning' },
};

/** Failures and destructive steps appear whole: no shimmer, no roll. */
const NO_MOTION: ReadonlySet<Tone> = new Set<Tone>(['danger', 'failure']);
/** Only routine lines shimmer. */
const SHIMMERS: ReadonlySet<Tone> = new Set<Tone>(['info', 'read']);
/** The lines that fade into their color when a step finishes. */
const SETTLES: ReadonlySet<Tone> = new Set<Tone>(['success', 'failure', 'stopped']);

export function fxLook(look: Look): FxLook {
  return { color: look.color ?? null, bold: look.bold === true, dimColor: look.dimColor === true };
}

/** A drawn line: the glyph and the words, with `…` after the words of a running step. */
export function rowText(sentence: Sentence, isRunning: boolean): string {
  const words = isRunning && !sentence.text.endsWith('…') ? `${sentence.text}…` : sentence.text;
  return `${sentence.glyph} ${words}`;
}

/** What the hooks remember of one call, from its first draw in this process. */
export type Seen = {
  /** True when the call's first draw here had it unresolved: only such a row ever moves. */
  live: boolean;
  firstAt: number;
  runningAt: number | null;
  finishedAt: number | null;
};

export function isResolved(view: CallView): boolean {
  return !view.isRunning && (view.output !== undefined || view.isErrored || view.isInterrupted);
}

export function noteSeen(seen: Seen | undefined, view: CallView, now: number): Seen {
  const record: Seen = seen === undefined
    ? { live: !isResolved(view), firstAt: now, runningAt: null, finishedAt: null }
    : { ...seen };
  if (record.runningAt === null && view.isRunning) record.runningAt = now;
  if (record.finishedAt === null && record.live && isResolved(view)) record.finishedAt = now;
  return record;
}

function settleFrom(tone: Tone, seen: Seen, now: number, effects: Effects): number | null {
  return effects.settle &&
    seen.live &&
    seen.finishedAt !== null &&
    SETTLES.has(tone) &&
    now - seen.finishedAt < SETTLE_MS
    ? seen.finishedAt
    : null;
}

/** The lines of one call's row while an effect plays, or null when the row is still. */
export function rowFx(input: {
  view: CallView;
  narration: Narration;
  seen: Seen;
  now: number;
  effects: Effects;
  mainScreen: boolean;
}): FxLine[] | null {
  const { view, narration, seen, now, effects, mainScreen } = input;
  // A finished row on the main screen goes into the scrollback and cannot be redrawn.
  if (mainScreen && isResolved(view)) return null;
  const { action, outcome } = narration;
  const shimmerFrom =
    effects.shimmer && view.isRunning && SHIMMERS.has(action.tone) ? (seen.runningAt ?? now) : null;
  const lines: FxLine[] = [
    {
      text: rowText(action, view.isRunning),
      look: fxLook(LOOK[action.tone]),
      indent: false,
      reveal: null,
      settleFrom: settleFrom(action.tone, seen, now, effects),
      shimmerFrom,
    },
  ];
  if (outcome !== undefined) {
    lines.push({
      text: rowText(outcome, false),
      look: fxLook(LOOK[outcome.tone]),
      indent: true,
      reveal: null,
      settleFrom: settleFrom(outcome.tone, seen, now, effects),
      shimmerFrom: null,
    });
  }
  return lines.some(line => line.shimmerFrom !== null || line.settleFrom !== null) ? lines : null;
}

/** When the lines stop moving by themselves; null while a shimmer runs (it ends when the step does). */
export function fxEnd(lines: readonly FxLine[]): number | null {
  if (lines.some(line => line.shimmerFrom !== null)) return null;
  let end: number | null = null;
  for (const line of lines) {
    if (line.settleFrom !== null) end = Math.max(end ?? 0, line.settleFrom + SETTLE_MS);
  }
  return end;
}

/** The lines of a group's count line while one of its calls runs, or null when it is still. */
export function groupFx(input: {
  narrations: readonly Narration[];
  running: boolean;
  since: number;
  effects: Effects;
}): FxLine[] | null {
  const { narrations, running, since, effects } = input;
  const first = narrations[0];
  if (!effects.shimmer || !running || first === undefined || !SHIMMERS.has(first.action.tone)) return null;
  const lines: FxLine[] = [];
  narrations.forEach((narration, index) => {
    lines.push({
      text: rowText(narration.action, false),
      look: fxLook(LOOK[narration.action.tone]),
      indent: index > 0,
      reveal: null,
      settleFrom: null,
      shimmerFrom: index === 0 ? since : null,
    });
    if (narration.outcome !== undefined) {
      lines.push({
        text: rowText(narration.outcome, false),
        look: fxLook(LOOK[narration.outcome.tone]),
        indent: true,
        reveal: null,
        settleFrom: null,
        shimmerFrom: null,
      });
    }
  });
  return lines;
}

/** The story pane's roll-in: how many rows it held when it last grew, which rows are new, and when. */
export type Roll = { total: number; from: number; at: number };

export const ROLL_START: Roll = { total: -1, from: 0, at: 0 };

export function nextRoll(roll: Roll, total: number, now: number): Roll {
  // The first draw since the pane opened: everything is already there.
  if (roll.total < 0) return { total, from: total, at: now };
  if (total > roll.total) return { total, from: Math.max(roll.total, total - ROLL_MAX), at: now };
  // The chapter cap dropped the oldest rows.
  if (total < roll.total) return { total, from: total, at: now };
  return roll;
}

/** The line of one story row while it rolls in (`index` counts from the story's first row), or null when it is still. */
export function rollFx(row: StoryRow, index: number, roll: Roll, now: number): FxLine | null {
  if (index < roll.from) return null;
  if (row.kind === 'line' && row.tone !== undefined && NO_MOTION.has(row.tone)) return null;
  const start = roll.at + (index - roll.from) * ROLL_STAGGER_MS;
  if (now >= start + ROLL_LINE_MS) return null;
  const look = row.kind === 'heading' ? fxLook({ bold: true }) : row.kind === 'note' ? fxLook(LOOK.read) : fxLook(LOOK[row.tone ?? 'info']);
  return {
    text: row.text,
    look,
    indent: false,
    reveal: { from: start, ms: ROLL_LINE_MS },
    settleFrom: null,
    shimmerFrom: null,
  };
}
