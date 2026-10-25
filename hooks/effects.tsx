import type { ClientModule, ClientSurface } from 'claude-code'

import type { FxLine, FxLook, FxProps } from '../types'

// A surface module: it runs on the drawing thread with no `$` and none of the plugin's modules, so it imports types only
// and carries its own constants (a test checks they equal hooks/motion.ts's), as claudefolder's shineClient.tsx does.
// It plays the effects on English lines: the plugin hands the lines as they look at rest, with the times the effects began
// (a story line's typewriter reveal, a settle into color, a shimmer), and this module draws each frame from those times on its own clock.
// It stops its clock as soon as no line has an effect frame left. No pointer, and no posts except the debug trace's reports
// (only while `props.debug` is on): the plugin ends the effects by drawing plain Text again.
// The host's frame clock beats every 16 ms, so `surface.every(FRAME_MS, ...)` ticks every 64 ms or later, not every 50:
// this module's time (`drawnAt` plus a frame per tick) lags the hook's, which is why the hook's wake waits a while past
// an effect's end (motion.ts's `WAKE_LINGER_MS`) and the module rests on its last frame until then.

/** The frame clock (20 fps). */
export const FRAME_MS = 50
/** The settle into color: three steps of 100 ms; the same numbers as motion.ts's `SETTLE_*` (a test checks it). */
export const SETTLE_STEP_MS = 100
export const SETTLE_MS = 300
/** The shimmer's light is its centre plus or minus this many cells wide (3 cells in all). */
export const SHIMMER_HALF = 1
/** The dark frames between one sweep and the next. */
export const SHIMMER_GAP = 12

/** `n` counts the redraws a clock tick asked for. */
type State = { n: number }

type Surface = ClientSurface<State>

const INITIAL: State = { n: 0 }

const latest = new WeakMap<object, FxProps>()
const mirror = new WeakMap<object, State>()
const started = new WeakSet<object>()
/** The frames each instance has counted since its `drawnAt` last changed. */
const clocks = new WeakMap<object, { key: string; ticks: number }>()
const timers = new WeakMap<object, () => void>()
/** The frame each instance last drew. */
const painted = new WeakMap<object, string>()

const DIM: FxLook = { color: null, bold: false, dimColor: true }

const cpsOf = (line: FxLine): number => Array.from(line.text).length

// ---- the frames --------------------------------------------------------------------------------

/** How many code points of the line show at `t`: null before its reveal begins (a blank line), all of them after. */
export function revealed(line: FxLine, t: number): number | null {
  const cps = cpsOf(line)
  const reveal = line.reveal
  if (reveal === null) return cps
  if (t < reveal.from) return null
  if (t >= reveal.from + reveal.ms) return cps
  // The glyph shows from the first frame.
  return Math.max(1, Math.ceil((cps * (t - reveal.from)) / reveal.ms))
}

/** How far the settle into color has come at `t`: 0 (grey) to 3 (the line's own look). */
export function settleStep(line: FxLine, t: number): 0 | 1 | 2 | 3 {
  const from = line.settleFrom
  if (from === null || t - from >= SETTLE_MS) return 3
  const step = Math.floor(Math.max(0, t - from) / SETTLE_STEP_MS)
  return step <= 0 ? 0 : step === 1 ? 1 : 2
}

/** The look of a settling line at a step: grey, dim in its color, its color, then as it rests. */
export function settleLook(look: FxLook, step: 0 | 1 | 2 | 3): FxLook {
  if (step === 0) return { color: null, bold: false, dimColor: true }
  if (step === 1) return { color: look.color, bold: false, dimColor: true }
  if (step === 2) return { color: look.color, bold: false, dimColor: false }
  return look
}

/**
 * The cell the light is centred on at `t`, or null before its start and while the line types in. The centre runs past the
 * line's end into the gap, where no cell is lit and the line rests dark until the next sweep.
 */
export function shimmerCenter(line: FxLine, t: number): number | null {
  const from = line.shimmerFrom
  if (from === null || t < from) return null
  const cps = cpsOf(line)
  if (revealed(line, t) !== cps) return null
  const period = cps + 2 * SHIMMER_HALF + 1 + SHIMMER_GAP
  const pos = Math.floor((t - from) / FRAME_MS) % period
  return pos - SHIMMER_HALF
}

const sameLook = (a: FxLook, b: FxLook): boolean => a.color === b.color && a.bold === b.bold && a.dimColor === b.dimColor

/** The line at `t` as runs of one look each. */
export function lineRuns(line: FxLine, t: number): { text: string; look: FxLook }[] {
  const n = revealed(line, t)
  if (n === null) return [{ text: ' ', look: line.look }]
  const cells = Array.from(line.text).slice(0, n)
  const centre = shimmerCenter(line, t)
  const rest = settleLook(line.look, settleStep(line, t))
  const runs: { text: string; look: FxLook }[] = []
  cells.forEach((cell, index) => {
    const look: FxLook =
      centre === null
        ? rest
        : Math.abs(index - centre) <= SHIMMER_HALF
          ? { color: 'text', bold: index === centre, dimColor: false }
          : DIM
    const last = runs[runs.length - 1]
    if (last !== undefined && sameLook(last.look, look)) last.text += cell
    else runs.push({ text: cell, look })
  })
  return runs
}

/** Whether the line has a frame left to play at `t`. */
export function lineActive(line: FxLine, t: number): boolean {
  if (line.shimmerFrom !== null) return true
  if (line.reveal !== null && t < line.reveal.from + line.reveal.ms) return true
  return settleStep(line, t) < 3
}

/** What the frame at `t` looks like, as a key: the instance repaints only when it changes. */
export function frameKey(lines: readonly FxLine[], t: number): string {
  return lines
    .map(line => {
      const centre = shimmerCenter(line, t)
      // A light past the line's end changes nothing on screen, so it counts as one frame.
      const lit = centre === null ? -99 : centre - SHIMMER_HALF > cpsOf(line) - 1 ? -98 : centre
      return [revealed(line, t) ?? -1, settleStep(line, t), lit].join(',')
    })
    .join(';')
}

// ---- the instance's clock ----------------------------------------------------------------------

const stateOf = (surface: Surface): State => mirror.get(surface) ?? surface.state ?? INITIAL

function commit(surface: Surface, next: State): void {
  mirror.set(surface, next)
  surface.setState(next)
}

/** The frames this instance has counted since its `drawnAt` last changed: a new `key` starts the count again. */
function ticksOf(surface: Surface, key: string): number {
  const c = clocks.get(surface)
  if (c === undefined || c.key !== key) {
    clocks.set(surface, { key, ticks: 0 })

    return 0
  }

  return c.ticks
}

const timeOf = (surface: Surface, props: FxProps): number => props.drawnAt + FRAME_MS * ticksOf(surface, String(props.drawnAt))

function stopClock(surface: Surface): void {
  const stop = timers.get(surface)
  if (stop === undefined) return
  timers.delete(surface)
  stop()
}

// ---- the debug trace ---------------------------------------------------------------------------

/** The `drawnAt` each instance last reported (debug only): a report goes out when it changes, not on every frame. */
const reported = new WeakMap<object, string>()

/**
 * Debug trace only (`props.debug`, set while CODEVIBEZ_DEBUG is on): tells the plugin what this instance is doing, so its
 * trace shows that the module loaded, drew, and that its clock ticked. A few reports per effect, never one per frame.
 */
function report(surface: Surface, props: FxProps, what: 'props' | 'tick' | 'stop'): void {
  if (!props.debug) return
  const key = String(props.drawnAt)
  const counted = clocks.get(surface)
  const ticks = counted !== undefined && counted.key === key ? counted.ticks : 0
  if (what === 'props') {
    if (reported.get(surface) === key) return
    reported.set(surface, key)
  }
  if (what === 'tick' && ticks > 3 && ticks % 10 !== 0) return
  try {
    surface.post({
      type: 'cv',
      what,
      ticks,
      sinceDraw: timeOf(surface, props) - props.drawnAt,
      drawnAt: props.drawnAt,
      columns: surface.columns,
      rows: surface.rows,
      lines: props.lines.length,
      frame: painted.get(surface) ?? '',
    })
  } catch {
    // The trace is a convenience; a refused post changes nothing on screen.
  }
}

function startClock(surface: Surface): void {
  if (timers.has(surface)) return
  timers.set(
    surface,
    surface.every(FRAME_MS, () => onTick(surface)),
  )
}

/** One frame: time moves on; a redraw only when the frame changed; the clock stops when no line has a frame left. */
function onTick(surface: Surface): void {
  const props = latest.get(surface)
  if (props === undefined) return
  ticksOf(surface, String(props.drawnAt))
  const c = clocks.get(surface)
  if (c !== undefined) c.ticks += 1
  const t = timeOf(surface, props)
  if (frameKey(props.lines, t) !== painted.get(surface)) commit(surface, { n: stateOf(surface).n + 1 })
  report(surface, props, 'tick')
  if (!props.lines.some(line => lineActive(line, t))) {
    stopClock(surface)
    report(surface, props, 'stop')
  }
}

// ---- the lines ---------------------------------------------------------------------------------

/** The lines at their frame: a column of lines, each a Text of runs of one look. */
const drawLines: ClientModule<FxProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const t = timeOf(surface, props)
  painted.set(surface, frameKey(props.lines, t))

  return (
    <Box flexDirection="column">
      {props.lines.map(line => (
        <Box paddingLeft={line.indent ? 2 : 0}>
          <Text>
            {lineRuns(line, t).map(run => (
              <Text
                color={run.look.color ?? undefined}
                bold={run.look.bold ? true : undefined}
                dimColor={run.look.dimColor ? true : undefined}
              >
                {run.text}
              </Text>
            ))}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// ---- the entry ---------------------------------------------------------------------------------

const client: ClientModule<FxProps, State> = (props, surface) => {
  // Test seam and fault path: props that are not lines make the module fail for real (`ui.fault`).
  if (props.kind !== 'lines') throw new Error('codevibez: unknown effect props')
  latest.set(surface, props)
  if (!started.has(surface)) {
    started.add(surface)
    surface.setState(INITIAL)
  }
  // The clock runs only while a line has a frame left.
  const t = timeOf(surface, props)
  if (props.lines.some(line => lineActive(line, t))) startClock(surface)
  const drawn = drawLines(props, surface)
  report(surface, props, 'props')

  return drawn
}

export default client
