export type Agent = 'claude-code' | 'codex';
export type EventKind = 'prompt' | 'tool.pre' | 'tool.post' | 'agent.done';
export type Level = 'plain' | 'developer';
export type Tier = 'read' | 'action' | 'danger';

export interface CodevibezOutcome {
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface CodevibezEvent {
  v: 1;
  ts: string;
  session: string;
  agent: Agent;
  kind: EventKind;
  tool?: string;
  raw?: Record<string, unknown>;
  outcome?: CodevibezOutcome;
  text?: string;
}

export interface Line {
  glyph: '→' | '✎' | '⚠' | '✗' | '✓' | '●';
  text: string;
  stem?: string;
  facts?: string;
  level?: Level;
  severity: 'info' | 'success' | 'failure' | 'danger';
  tier: Tier;
  raw: string;
  generic?: true;
  id?: string;
  mood?: 'neutral' | 'busy' | 'win' | 'oops' | 'alarm' | 'kickoff';
  accent?: 'dim' | 'normal' | 'bold';
  pulse?: number;
}
