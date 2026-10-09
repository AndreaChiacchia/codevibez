import type { Line } from './types.ts';

export type FlairLevel = 'full' | 'minimal' | 'off';

interface VoiceSet {
  canonical: string;
  variants: readonly string[];
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result;
}

export const VOICE: Readonly<Record<string, VoiceSet>> = {
  'bash.test': {
    canonical: 'Checking everything still works…',
    variants: [
      'Checking everything still works…',
      'Making sure nothing broke…',
      'Running the checks…',
    ],
  },
  'bash.install.ci': {
    canonical: "Setting up the project's building blocks",
    variants: [
      "Setting up the project's building blocks",
      'Getting the project ready to run',
    ],
  },
  'bash.install.pkg': {
    canonical: 'Adding a ready-made tool to the project',
    variants: [
      'Adding a ready-made tool to the project',
      'Bringing in a tool someone else built',
    ],
  },
  'bash.build': {
    canonical: 'Assembling the app',
    variants: ['Assembling the app', 'Putting the app together'],
  },
  'bash.commit': {
    canonical: 'Saving a checkpoint of the work',
    variants: [
      'Saving a checkpoint of the work',
      'Banking the progress so far',
    ],
  },
  'bash.search': {
    canonical: 'Searching through the project',
    variants: [
      'Searching through the project',
      'Hunting through the project',
    ],
  },
  'file.read': {
    canonical: 'Looking at existing code',
    variants: [
      'Looking at existing code',
      'Getting familiar with the code',
    ],
  },
  'file.write.new': {
    canonical: 'Writing new code',
    variants: ['Writing new code', 'Putting new code on the page'],
  },
  'file.edit': {
    canonical: "Updating the app's code",
    variants: ["Updating the app's code", "Tweaking the app's code"],
  },
};

const MOOD: Readonly<
  Record<Line['severity'], NonNullable<Line['mood']>>
> = {
  danger: 'alarm',
  failure: 'oops',
  success: 'win',
  info: 'busy',
};

export const PULSE = ['·', '✢', '✳', '✻', '✽', '✻', '✳', '✢'] as const;
export const PULSE_ASCII = ['.', 'o', 'O', '0', 'O', 'o', '.', ' '] as const;
export const GLYPH_ASCII: Readonly<Record<Line['glyph'], string>> = {
  '→': '->',
  '✎': '*',
  '⚠': '!!',
  '✗': 'x',
  '✓': 'ok',
  '●': '#',
};
export const BREATH_PERIOD_MS = 2400 as const;

export interface BreathFrame {
  glyph: string;
  intensity: number;
  phase: number;
}

export function breath(timeMs: number): BreathFrame {
  const time = Number.isFinite(timeMs) ? timeMs : 0;
  const phase =
    (((time % BREATH_PERIOD_MS) + BREATH_PERIOD_MS) %
      BREATH_PERIOD_MS) /
    BREATH_PERIOD_MS;
  const intensity = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const index = Math.min(
    PULSE.length - 1,
    Math.floor(phase * PULSE.length),
  );
  return {
    glyph: PULSE[index] ?? PULSE[0],
    intensity,
    phase,
  };
}

export function decorate(
  line: Line,
  seed: string,
  flair: FlairLevel,
  timeMs = 0,
): Line {
  try {
    if (flair === 'off') return line;

    const mood =
      line.glyph === '●' ? 'kickoff' : MOOD[line.severity];
    const decorated: Line = { ...line, mood };
    if (line.severity === 'danger' || line.severity === 'failure') {
      return decorated;
    }
    if (flair === 'minimal') return decorated;

    const stem = line.stem ?? line.text;
    const voice = line.id === undefined ? undefined : VOICE[line.id];
    if (voice !== undefined && stem === voice.canonical) {
      const index = hash(`${seed}|${line.id}`) % voice.variants.length;
      decorated.stem = voice.variants[index] ?? stem;
    }
    const selectedStem = decorated.stem ?? stem;
    decorated.text =
      line.facts === undefined
        ? selectedStem
        : `${selectedStem} ${line.facts}`;
    decorated.pulse = breath(timeMs).phase;
    return decorated;
  } catch {
    return line;
  }
}
