/**
 * English lines quote bits of what the agent ran: a deletion's target, a
 * search query, a helper's task. Those bits can carry a secret, so every line
 * is scrubbed before it is drawn.
 *
 * This is deliberately best-effort, ported from the July event-log privacy
 * fix: common carriers are scrubbed, but arbitrary commands and text can
 * encode secrets in forms no pattern can recognize. Nothing here is written
 * anywhere; the mod keeps no log.
 */
const REDACTED = '[REDACTED]';

/** Scrub common secret carriers from one string. */
export function redactSecrets(value: string): string {
  try {
    return value
      .replace(
        /(\b(?:proxy-)?authorization\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n"']+)/gi,
        `$1${REDACTED}`,
      )
      .replace(
        /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi,
        `$1${REDACTED}@`,
      )
      .replace(
        /((?:^|\s)--(?:access[-_]?token|auth[-_]?token|token|api[-_]?key|password|secret|client[-_]?secret)\b(?:\s*=\s*|\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi,
        `$1${REDACTED}`,
      )
      .replace(
        /(\b(?:[a-z][a-z0-9_-]*?)?(?:token|password|secret|api[_-]?key)\b\s*=\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
        `$1${REDACTED}`,
      )
      // Known token formats are useful coverage, but still cannot make this
      // best-effort scrubber complete.
      .replace(
        /\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|xox[bpar]-[A-Za-z0-9_-]+|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]+|glpat-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)(?![A-Za-z0-9_-])/g,
        REDACTED,
      );
  } catch {
    return REDACTED;
  }
}
