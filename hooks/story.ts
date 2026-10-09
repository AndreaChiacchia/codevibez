import type { Chapter, StoryLine } from '../types';
import type { Narration } from './narrate.ts';
import { redactSecrets } from './redact.ts';

/**
 * The session told in plain English: one chapter per prompt you typed, its
 * steps in order, and the turn's summary line. Pure functions over plain data,
 * kept in the session's memory only.
 */

const MAX_CHAPTERS = 50;
const MAX_LINES = 200;

export function startChapter(story: readonly Chapter[], prompt: string): Chapter[] {
  const chapter: Chapter = { prompt: redactSecrets(prompt), lines: [], more: 0 };
  return [...story, chapter].slice(-MAX_CHAPTERS);
}

function lastChapter(story: readonly Chapter[]): Chapter[] {
  return story.length > 0 ? [...story] : [{ prompt: '', lines: [], more: 0 }];
}

const ALWAYS_KEPT: ReadonlySet<StoryLine['tone']> = new Set(['failure', 'danger']);

/**
 * Adds lines to the newest chapter. Past the chapter's room, routine lines
 * are counted exactly instead of kept; a failure, a destructive step and the
 * turn's summary are always kept.
 */
export function addLines(
  story: readonly Chapter[],
  lines: readonly StoryLine[],
  isSummary = false,
): Chapter[] {
  if (lines.length === 0) return [...story];
  const next = lastChapter(story);
  const index = next.length - 1;
  const chapter = next[index];
  if (chapter === undefined) return next;
  const kept = [...chapter.lines];
  let more = chapter.more;
  for (const line of lines) {
    if (isSummary || ALWAYS_KEPT.has(line.tone) || kept.length < MAX_LINES) kept.push(line);
    else more += 1;
  }
  next[index] = { ...chapter, lines: kept, more };
  return next;
}

export function linesOf(narration: Narration): StoryLine[] {
  return narration.outcome === undefined
    ? [narration.action]
    : [narration.action, narration.outcome];
}

export type StoryRow = { kind: 'heading' | 'line' | 'note'; text: string; tone?: StoryLine['tone'] };

/** How many terminal lines a row takes at this width, wrapped. */
function heightOf(row: StoryRow, columns: number): number {
  const room = Math.max(10, columns - (row.kind === 'heading' ? 0 : 2));
  return Math.max(1, Math.ceil(row.text.length / room)) + (row.kind === 'heading' ? 1 : 0);
}

/**
 * The newest rows that fit the pane, and how many earlier rows are left out,
 * so the latest step is always in view.
 */
export function fitNewest(
  rows: readonly StoryRow[],
  columns: number,
  height: number,
): { shown: StoryRow[]; hidden: number } {
  let used = 0;
  let start = rows.length;
  while (start > 0) {
    const next = rows[start - 1];
    if (next === undefined) break;
    const cost = heightOf(next, columns);
    // Keep one line free to say how much is above, unless everything fits.
    if (used + cost > height - (start > 1 ? 1 : 0) && start < rows.length) break;
    used += cost;
    start -= 1;
  }
  return { shown: rows.slice(start), hidden: start };
}

/** The story as rows to draw, oldest first. */
export function storyRows(story: readonly Chapter[]): StoryRow[] {
  const rows: StoryRow[] = [];
  for (const chapter of story) {
    rows.push({
      kind: 'heading',
      text: chapter.prompt === '' ? 'Before your first prompt' : chapter.prompt,
    });
    if (chapter.lines.length === 0 && chapter.more === 0) {
      rows.push({ kind: 'note', text: 'No steps.' });
    }
    for (const line of chapter.lines) {
      rows.push({ kind: 'line', text: `${line.glyph} ${line.text}`, tone: line.tone });
    }
    if (chapter.more > 0) {
      rows.push({
        kind: 'note',
        text: `and ${chapter.more} more routine ${chapter.more === 1 ? 'line' : 'lines'} not shown here`,
      });
    }
  }
  return rows;
}
