/**
 * The /config values as the hooks use them: three independent switches for the
 * motion effects. Pure, no `$`.
 */

export type Effects = {
  /** A light over the running step. */
  shimmer: boolean;
  /** A finished step's line fades from dim into its color. */
  settle: boolean;
  /** New lines roll into the story pane. */
  storyRoll: boolean;
};

export const DEFAULT_EFFECTS: Effects = {
  shimmer: true,
  settle: true,
  storyRoll: true,
};

/** Each effect is on unless its setting says `off`; a missing or unknown value is the default, on. */
export function normalizeEffects(options: Readonly<Record<string, unknown>>): Effects {
  return {
    shimmer: options.shimmer !== 'off',
    settle: options.settle !== 'off',
    storyRoll: options.storyRoll !== 'off',
  };
}

export function anyEffect(effects: Effects): boolean {
  return effects.shimmer || effects.settle || effects.storyRoll;
}
