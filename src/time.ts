import { PPQ, type Tempo, type Project, type Note, endTick } from './model';
export class TempoMap {
  segments: { tick: number; bpm: number; seconds: number }[];
  constructor(tempos: Tempo[]) { let seconds = 0; this.segments = tempos.map((t, i) => { if (i) seconds += (t.tick - tempos[i - 1].tick) / PPQ * 60 / tempos[i - 1].bpm; return { ...t, seconds }; }); }
  atTick(tick: number) { return this.segments.findLast(t => t.tick <= tick) ?? this.segments[0]; }
  seconds(tick: number) { const t = this.atTick(tick); return t.seconds + (tick - t.tick) / PPQ * 60 / t.bpm; }
  tick(seconds: number) { const t = this.segments.findLast(t => t.seconds <= seconds) ?? this.segments[0]; return t.tick + (seconds - t.seconds) * PPQ * t.bpm / 60; }
}
export function effectiveEnd(p: Project, n: Note) {
  const end = n.startTick + n.durationTick;
  const pedals = p.pedals.filter(e => !e.partId || e.partId === n.partId).sort((a, b) => a.tick - b.tick);
  if ((pedals.findLast(e => e.tick <= end)?.value ?? 0) < 64) return end;
  return pedals.find(e => e.tick > end && e.value < 64)?.tick ?? Math.max(end, endTick(p));
}
export interface Scheduled { note: Note; time: number; duration: number; cycle: number; offset?: number }
export function planWindow(p: Project, notes: Note[], map: TempoMap, originTick: number, from: number, to: number, loop: { enabled: boolean; start: number; end: number }): Scheduled[] {
  const out: Scheduled[] = [], origin = map.seconds(originTick);
  if (from <= 0 && to > 0) for (const n of notes) {
    const finish = effectiveEnd(p, n);
    if (n.startTick < originTick && finish > originTick && (!loop.enabled || n.startTick >= loop.start)) {
      out.push({ note: n, time: 0, duration: map.seconds(loop.enabled ? Math.min(finish, loop.end) : finish) - origin, cycle: 0, offset: origin - map.seconds(n.startTick) });
    }
  }
  if (!loop.enabled) {
    for (const n of notes) { const time = map.seconds(n.startTick) - origin; if (n.startTick >= originTick && time >= from && time < to) out.push({ note: n, time, duration: map.seconds(effectiveEnd(p, n)) - map.seconds(n.startTick), cycle: 0 }); }
    return out;
  }
  const start = map.seconds(loop.start), finish = map.seconds(loop.end), length = finish - start;
  if (length <= 0) return out;
  // cycle zero may start halfway through the loop; subsequent cycles start at its left edge.
  const firstLength = finish - origin;
  const cMin = Math.max(0, Math.floor((from - firstLength) / length) + 1), cMax = Math.max(0, Math.floor((to - firstLength) / length) + 1);
  for (let cycle = cMin; cycle <= cMax; cycle++) for (const n of notes) {
    if (n.startTick < (cycle === 0 ? originTick : loop.start) || n.startTick >= loop.end) continue;
    const time = cycle === 0 ? map.seconds(n.startTick) - origin : firstLength + (cycle - 1) * length + map.seconds(n.startTick) - start;
    if (time >= from && time < to) out.push({ note: n, time, duration: Math.max(.002, map.seconds(Math.min(effectiveEnd(p, n), loop.end)) - map.seconds(n.startTick)), cycle });
  }
  return out;
}
