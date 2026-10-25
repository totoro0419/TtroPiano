import { PPQ, MAX_TICK, clamp, snapTick, uid, noteName, bounds, endTick, type Note, type View, type Session, type ProjectStore } from './model';
export const KEY_WIDTH = 58, RULER_HEIGHT = 36;
interface Point { x: number; y: number }
interface Touch extends Point { id: number; kind: string }
interface Gesture {
  action: 'pending' | 'move' | 'resize' | 'pan' | 'select' | 'selected' | 'scrub' | 'time-select' | 'pick';
  origin: Point; view: View; target?: Note; handle?: boolean; affordance?: boolean; moved: boolean; time: number;
  originals: Note[]; selection: Set<string>; anchor?: { tick: number; pitch: number }; shift: boolean; scrubbing?: boolean;
}
interface TwoFingerTap { started: number; starts: Map<number, Point>; valid: boolean }
interface Navigation { view: View; center: Point; distance: number; tick: number; pitch: number }
export interface RollOptions { changed: () => void; audition: (pitch: number, velocity: number, held?: boolean, keyId?: number) => void; release: (keyId?: number) => void; seek: (tick: number) => void; scrub: (tick: number, phase: 'start' | 'move' | 'end' | 'cancel') => void; undo: () => void; dismiss: () => boolean; notify: (message: string) => void }
export class PianoRoll extends EventTarget {
  context: CanvasRenderingContext2D;
  width = 0; height = 0;
  selected = new Set<string>();
  draft = new Map<string, Note>();
  noteById = new Map<string, Note>();
  phraseRanges: { id: string; name: string; noteIds: string[]; start: number; end: number }[] = [];
  byPitch: Note[][] = Array.from({ length: 128 }, () => []);
  pointers = new Map<number, Touch>();
  gesture?: Gesture;
  navigation?: Navigation;
  navigationLatch = false;
  twoFingerTap?: TwoFingerTap;
  longTimer = 0;
  frame = 0;
  cursor = 0;
  playing = false;
  marquee?: { a: Point; b: Point };
  keyPointers = new Map<number, number>();
  picking = false;
  suspended?: { draft: Map<string, Note>; originals: Note[]; label: string };
  metrics: { kind: string; ms: number; notes: number }[] = [];
  lastInput = 0;
  dirty = true;
  keyboardPitch = 60;
  onResize?: () => void;
  constructor(public canvas: HTMLCanvasElement, public store: ProjectStore, public session: () => Session, public options: RollOptions) {
    super(); this.context = canvas.getContext('2d', { alpha: false })!;
    canvas.addEventListener('pointerdown', e => this.down(e)); canvas.addEventListener('pointermove', e => this.move(e)); canvas.addEventListener('pointerup', e => this.up(e)); canvas.addEventListener('pointercancel', e => this.cancelPointer(e)); canvas.addEventListener('lostpointercapture', e => { if (this.pointers.has(e.pointerId) || this.keyPointers.has(e.pointerId)) this.cancelPointer(e); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); if (this.options.dismiss()) return; const p = this.point(e); if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * .008), p); else { this.view.startTick += e.deltaX / this.view.beatWidth * PPQ; this.view.topPitch -= e.deltaY / this.view.rowHeight; this.constrain(); this.paintNow('wheel'); } this.options.changed(); }, { passive: false });
    canvas.addEventListener('keydown', e => this.key(e));
    new ResizeObserver(() => this.resize()).observe(canvas);
    store.addEventListener('change', () => { this.cancel(false, true); this.reindex(); const ids = new Set(store.project.notes.map(n => n.id)); this.select(new Set([...this.selected].filter(id => ids.has(id))), false); this.invalidate(); });
    this.reindex(); this.resize();
  }
  get view() { return this.session().view; }
  point(event: { clientX: number; clientY: number }): Point { const r = this.canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  tickAt(x: number) { return this.view.startTick + (x - KEY_WIDTH) / this.view.beatWidth * PPQ; }
  pitchAt(y: number) { return clamp(Math.ceil(this.view.topPitch - (y - RULER_HEIGHT) / this.view.rowHeight), 0, 127); }
  xAt(tick: number) { return KEY_WIDTH + (tick - this.view.startTick) / PPQ * this.view.beatWidth; }
  yAt(pitch: number) { return RULER_HEIGHT + (this.view.topPitch - pitch) * this.view.rowHeight; }
  rect(note: Note) { return { x: this.xAt(note.startTick), y: this.yAt(note.pitch) + 2, w: Math.max(3, note.durationTick / PPQ * this.view.beatWidth), h: Math.max(3, this.view.rowHeight - 4) }; }
  reindex() { this.noteById = new Map(this.store.project.notes.map(n => [n.id, n])); this.phraseRanges = this.store.project.phrases.map(f => { const ns = f.noteIds.map(id => this.noteById.get(id)).filter((n): n is Note => !!n); return {...f, ...bounds(ns)}; }).filter(f => f.noteIds.length); this.byPitch = Array.from({ length: 128 }, () => []); for (const n of this.store.project.notes) this.byPitch[n.pitch].push(n); for (const a of this.byPitch) a.sort((a, b) => a.startTick - b.startTick); }
  select(ids: Set<string>, announce = true) { this.selected = ids; if (announce) this.dispatchEvent(new Event('selection')); this.invalidate(); }
  pick() { this.picking = !this.picking; this.dispatchEvent(new Event('selection')); this.invalidate(); }
  hit(p: Point): { note: Note; handle: boolean; affordance?: boolean } | undefined {
    if (p.x < KEY_WIDTH || p.y < RULER_HEIGHT) return;
    // Visible note bodies always win over a neighbouring note's expanded handle.
    for (const pitch of [this.pitchAt(p.y), this.pitchAt(p.y) + 1, this.pitchAt(p.y) - 1]) {
      for (const original of (this.byPitch[pitch] ?? []).toReversed()) {
        const n = this.draft.get(original.id) ?? original, r = this.rect(n), right = r.x + r.w;
        if (p.x >= r.x - 2 && p.x <= right + 3 && p.y >= r.y - 2 && p.y <= r.y + r.h + 2) return { note: original, handle: r.w >= 28 && p.x >= right - Math.min(12, r.w / 3) };
      }
    }
    const n = this.noteById.get(this.selected.values().next().value ?? '');
    if (n) { const r = this.rect(n); if (r.w < 30 && Math.abs(p.y - (r.y + r.h / 2)) <= 14) { const left = Math.abs(p.x - (r.x - 12)), right = Math.abs(p.x - (r.x + r.w + 12)); if (Math.min(left,right) <= 14) return { note: n, handle: right < left, affordance: true }; } }
    // A tolerant target is safe for explicit picking: it cannot delete or move a neighbour.
    if (this.picking) { let closest: Note | undefined, distance = 12; for (const n of this.byPitch[this.pitchAt(p.y)]) { const r = this.rect(n), d = Math.max(r.x-p.x, p.x-r.x-r.w, 0); if (d < distance) { closest = n; distance = d; } } if (closest) return {note: closest,handle:false}; }
  }
  phraseAt(p: Point) { if (p.y < 24 || p.y >= RULER_HEIGHT || p.x < KEY_WIDTH) return; const tick = this.tickAt(p.x); return this.phraseRanges.find(f => tick >= f.start && tick < f.end); }
  cancelPointer(e: PointerEvent) { if (this.keyPointers.has(e.pointerId)) { this.keyPointers.delete(e.pointerId); this.options.release(e.pointerId); this.invalidate(); } else { this.cancel(false, true); this.dispatchEvent(new Event('selection')); } }
  suspendEdit() {
    const g = this.gesture;
    if (g && this.draft.size && g.originals.some(n => JSON.stringify(n) !== JSON.stringify(this.draft.get(n.id) ?? n))) {
      // Never commit a possibly accidental edit when a second canvas finger arrives.
      // Keep the last proposal available as an explicit, undoable action after navigation.
      if (this.suspended) this.options.notify('前の保留を置き換えました。新しい移動を「適用」で確定できます。');
      this.suspended = { draft: new Map(this.draft), originals: g.originals, label: g.action === 'resize' ? '音符を伸縮' : '音符を移動' };
    }
  }
  applySuspended() {
    const s = this.suspended; if (!s) return;
    const current = new Map(this.store.project.notes.map(n => [n.id, n]));
    if (s.originals.some(n => JSON.stringify(current.get(n.id)) !== JSON.stringify(n))) { this.options.notify('保留した音符が後で変更されています。保留は適用せず残しています。'); return; }
    this.suspended = undefined; this.store.update(new Set(s.draft.keys()), s.label, n => s.draft.get(n.id)!); this.select(new Set(s.draft.keys()));
  }
  discardSuspended() { this.suspended = undefined; this.dispatchEvent(new Event('selection')); this.options.changed(); this.invalidate(); }
  down(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType !== 'touch') return; e.preventDefault();
    if (this.options.dismiss()) return;
    this.canvas.focus({ preventScroll: true });
    const p = this.point(e); if (e.isTrusted) this.canvas.setPointerCapture(e.pointerId);
    // Keys have independent lifetimes and never count as viewport fingers.
    if (p.x < KEY_WIDTH && p.y >= RULER_HEIGHT) { const pitch = this.pitchAt(p.y); this.keyPointers.set(e.pointerId, pitch); this.options.audition(pitch, 88, true, e.pointerId); this.paintNow('key-down'); return; }
    this.pointers.set(e.pointerId, { ...p, id: e.pointerId, kind: e.pointerType });
    if (this.pointers.size >= 2) {
      // Two touch fingers tapped briefly = Undo. Movement, a third finger and an
      // interrupted one-finger edit must never be mistaken for a tap.
      if (this.pointers.size === 2 && !this.navigationLatch) {
        const g = this.gesture, points = [...this.pointers.values()];
        this.twoFingerTap = g && !g.moved && performance.now() - g.time <= 190
          && points.every(t => t.kind === 'touch') && Math.hypot(points[0].x - g.origin.x, points[0].y - g.origin.y) <= 7
          ? { started: performance.now(), starts: new Map(points.map(t => [t.id, { x: t.x, y: t.y }])), valid: true }
          : undefined;
      } else if (this.twoFingerTap) this.twoFingerTap.valid = false;
      this.beginNavigation(); return;
    }
    if (this.navigationLatch) return;
    this.lastInput = performance.now(); const hit = this.hit(p), selection = new Set(this.selected);
    let action: Gesture['action'] = 'pending';
    const phrase = this.phraseAt(p);
    if (p.y < RULER_HEIGHT && p.x >= KEY_WIDTH) {
      if (e.shiftKey || this.picking) action = 'time-select';
      else if (phrase) { this.select(new Set(phrase.noteIds)); action = 'selected'; }
      else action = 'scrub';
    } else if (this.picking) { action = hit ? 'pick' : 'select'; if (!hit) this.select(new Set()); }
    this.gesture = { action, origin: p, view: { ...this.view }, target: hit?.note, handle: hit?.handle, affordance: hit?.affordance, moved: false, time: performance.now(), originals: hit ? this.selected.has(hit.note.id) ? this.store.project.notes.filter(n => this.selected.has(n.id)) : [hit.note] : [], selection, shift: e.shiftKey };
    if (action === 'pending') this.longTimer = window.setTimeout(() => {
      const g = this.gesture; if (!g || g.moved || this.pointers.size !== 1 || this.navigationLatch) return;
      if (g.target) { const ids = g.shift ? new Set(this.selected) : this.selected.has(g.target.id) ? new Set(this.selected) : new Set<string>(); ids.add(g.target.id); this.select(ids); g.action = 'selected'; this.dispatchEvent(new Event('details')); }
      else { g.action = 'select'; g.anchor = { tick: this.tickAt(p.x), pitch: this.pitchAt(p.y) }; this.marquee = { a: p, b: p }; this.select(new Set()); }
      this.paintNow('longpress');
    }, e.pointerType === 'mouse' ? 420 : 460);
    this.paintNow('down');
  }
  beginNavigation() {
    clearTimeout(this.longTimer);
    if (this.gesture?.scrubbing) this.options.scrub(this.session().cursor, 'end');
    this.suspendEdit(); this.draft.clear(); this.marquee = undefined;
    this.gesture = undefined; this.navigationLatch = true;
    const [a, b] = [...this.pointers.values()], center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.navigation = { view: { ...this.view }, center, distance: Math.max(12, Math.hypot(a.x - b.x, a.y - b.y)), tick: this.tickAt(center.x), pitch: this.view.topPitch - (center.y - RULER_HEIGHT) / this.view.rowHeight };
    this.paintNow('navigation-start'); this.dispatchEvent(new Event('selection'));
  }
  move(e: PointerEvent) {
    if (this.keyPointers.has(e.pointerId)) { e.preventDefault(); const p = this.point(e), pitch = this.pitchAt(p.y); if (p.x < 0 || p.x >= KEY_WIDTH || p.y < RULER_HEIGHT || p.y > this.height) { this.options.release(e.pointerId); this.keyPointers.set(e.pointerId, -1); } else if (pitch !== this.keyPointers.get(e.pointerId)) { this.options.release(e.pointerId); this.keyPointers.set(e.pointerId, pitch); this.options.audition(pitch, 88, true, e.pointerId); } this.paintNow('key-move'); return; }
    if (!this.pointers.has(e.pointerId)) return; e.preventDefault(); this.lastInput = performance.now();
    const p = this.point(e); this.pointers.set(e.pointerId, { ...p, id: e.pointerId, kind: e.pointerType });
    if (this.twoFingerTap?.valid) {
      const start = this.twoFingerTap.starts.get(e.pointerId);
      if (!start || Math.hypot(p.x - start.x, p.y - start.y) > 8) this.twoFingerTap.valid = false;
      if (this.navigation && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (Math.hypot(center.x - this.navigation.center.x, center.y - this.navigation.center.y) > 8
          || Math.abs(Math.hypot(a.x - b.x, a.y - b.y) / this.navigation.distance - 1) > .05) this.twoFingerTap.valid = false;
      }
    }
    if (this.navigationLatch) {
      if (this.pointers.size >= 2 && this.navigation) {
        const [a, b] = [...this.pointers.values()], n = this.navigation, center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, scale = Math.hypot(a.x - b.x, a.y - b.y) / n.distance;
        this.view.beatWidth = clamp(n.view.beatWidth * scale, 14, 240); this.view.rowHeight = clamp(n.view.rowHeight * scale, 7, 42);
        this.view.startTick = n.tick - (center.x - KEY_WIDTH) / this.view.beatWidth * PPQ; this.view.topPitch = n.pitch + (center.y - RULER_HEIGHT) / this.view.rowHeight;
        this.constrain(); this.paintNow('pinch'); this.options.changed();
      } return;
    }
    const g = this.gesture; if (!g) return;
    const dx = p.x - g.origin.x, dy = p.y - g.origin.y, distance = Math.hypot(dx, dy);
    const threshold = e.pointerType === 'mouse' || e.pointerType === 'pen' ? 4 : 8;
    if (distance > threshold && !g.moved) { g.moved = true; clearTimeout(this.longTimer); if (g.action === 'pending') g.action = g.target ? g.handle ? 'resize' : 'move' : 'pan'; }
    // Dragging the ruler moves the playhead. Shift+drag or explicit picking
    // retains the former time-range selection workflow.
    if (g.moved && g.action === 'selected' && g.origin.y < RULER_HEIGHT) g.action = 'scrub';
    if (g.action === 'scrub' && g.moved) {
      this.options.scrub(clamp(Math.round(this.tickAt(p.x)), 0, MAX_TICK), g.scrubbing ? 'move' : 'start');
      g.scrubbing = true;
    }
    if (g.action === 'pan') { this.view.startTick = g.view.startTick - dx / g.view.beatWidth * PPQ; this.view.topPitch = g.view.topPitch + dy / g.view.rowHeight; this.constrain(); this.options.changed(); }
    if (g.action === 'move' && g.target) {
      const b = bounds(g.originals), dt = snapTick(g.target.startTick + dx / this.view.beatWidth * PPQ, this.session().snap) - g.target.startTick, dp = Math.round(-dy / this.view.rowHeight);
      const tick = clamp(dt, -b.start, MAX_TICK - b.end), pitch = clamp(dp, -b.low, 127 - b.high);
      this.draft = new Map(g.originals.map(n => [n.id, { ...n, startTick: n.startTick + tick, pitch: n.pitch + pitch }]));
    }
    if (g.action === 'resize' && g.target) {
      const delta = dx / this.view.beatWidth * PPQ;
      if (g.originals.length > 1) {
        const b = bounds(g.originals), span = b.end - b.start, end = snapTick(Math.max(b.start + (this.session().snap || 1), b.end + delta), this.session().snap), factor = (end - b.start) / span;
        this.draft = new Map(g.originals.map(n => [n.id, { ...n, startTick: Math.round(b.start + (n.startTick - b.start) * factor), durationTick: Math.max(1, Math.round(n.durationTick * factor)) }]));
      } else { const n = g.target, length = Math.max(1, snapTick(n.startTick + n.durationTick + delta, this.session().snap) - n.startTick); this.draft.set(n.id, { ...n, durationTick: Math.min(MAX_TICK - n.startTick, length) }); }
    }
    if (g.action === 'select') {
      this.marquee = { a: g.origin, b: p }; const x1 = Math.min(this.tickAt(g.origin.x), this.tickAt(p.x)), x2 = Math.max(this.tickAt(g.origin.x), this.tickAt(p.x)), lo = Math.min(this.pitchAt(g.origin.y), this.pitchAt(p.y)), hi = Math.max(this.pitchAt(g.origin.y), this.pitchAt(p.y));
      this.selected = new Set(this.store.project.notes.filter(n => n.startTick <= x2 && n.startTick + n.durationTick >= x1 && n.pitch >= lo && n.pitch <= hi).map(n => n.id));
    }
    if (g.action === 'time-select') { const start = Math.max(0, Math.min(this.tickAt(g.origin.x), this.tickAt(p.x))), end = Math.max(this.tickAt(g.origin.x), this.tickAt(p.x)); this.marquee = { a: { x: this.xAt(start), y: RULER_HEIGHT }, b: { x: this.xAt(end), y: this.height } }; this.selected = new Set(this.store.project.notes.filter(n => n.startTick < end && n.startTick + n.durationTick > start).map(n => n.id)); }
    this.paintNow('move');
  }
  up(e: PointerEvent) {
    if (this.keyPointers.has(e.pointerId)) { e.preventDefault(); this.keyPointers.delete(e.pointerId); this.options.release(e.pointerId); this.paintNow('key-up'); return; }
    if (!this.pointers.has(e.pointerId)) return; e.preventDefault(); clearTimeout(this.longTimer); const p = this.point(e); this.pointers.delete(e.pointerId);
    if (this.navigationLatch) {
      const undo = !this.pointers.size && !!this.twoFingerTap?.valid && performance.now() - this.twoFingerTap.started <= 280;
      if (!this.pointers.size) { this.navigation = undefined; this.navigationLatch = false; this.twoFingerTap = undefined; }
      else if (this.pointers.size >= 2) this.beginNavigation();
      this.invalidate(); this.dispatchEvent(new Event('selection')); this.options.changed();
      if (undo) this.options.undo();
      return;
    }
    const g = this.gesture; this.gesture = undefined; if (!g) return;
    try {
      if ((g.action === 'move' || g.action === 'resize') && this.draft.size) {
        const draft = this.draft; this.draft = new Map(); this.store.update(new Set(draft.keys()), g.action === 'move' ? '音符を移動' : '音符を伸縮', n => draft.get(n.id)!);
        this.select(new Set(draft.keys())); const n = draft.get(g.target!.id); if (n && n.pitch !== g.target!.pitch && !this.playing) this.options.audition(n.pitch, n.velocity);
      } else if (g.action === 'pending' && !g.moved) {
        const releaseHit = this.hit(p);
        if (g.target && releaseHit?.note.id === g.target.id) {
          if (g.affordance) this.select(new Set(this.selected));
          else if (g.shift) { const ids = new Set(this.selected); ids.has(g.target.id) ? ids.delete(g.target.id) : ids.add(g.target.id); this.select(ids); }
          else this.store.delete(new Set([g.target.id]));
        } else if (!g.target && p.x >= KEY_WIDTH && p.y >= RULER_HEIGHT) {
          const s = this.session(), note: Note = { id: uid(), partId: s.activePart, pitch: this.pitchAt(p.y), startTick: snapTick(this.tickAt(p.x), s.snap), durationTick: s.noteLength, velocity: 80 }; this.store.insert([note]); this.select(new Set([note.id])); if (!this.playing) this.options.audition(note.pitch, note.velocity);
        }
      } else if (g.action === 'pick' && g.target) this.select(new Set([g.target.id]));
      else if (g.action === 'select' || g.action === 'time-select') this.dispatchEvent(new Event('selection'));
      else if (g.action === 'scrub') {
        const tick = clamp(Math.round(this.tickAt(p.x)), 0, MAX_TICK);
        if (g.scrubbing) this.options.scrub(tick, 'end');
        else this.options.seek(snapTick(tick, this.session().snap));
      }
      this.picking = false; this.dispatchEvent(new Event('selection'));
    } catch (error) { this.options.notify(error instanceof Error ? error.message : String(error)); }
    this.draft.clear(); this.marquee = undefined; this.paintNow('up'); this.options.changed();
  }
  cancel(releaseKeys = true, preserveSuspended = false) { if (this.gesture?.scrubbing) this.options.scrub(this.session().cursor, 'cancel'); clearTimeout(this.longTimer); this.twoFingerTap = undefined; this.gesture = undefined; this.draft.clear(); this.marquee = undefined; this.pointers.clear(); this.navigation = undefined; this.navigationLatch = false; this.picking = false; if (!preserveSuspended) this.suspended = undefined; if (releaseKeys) { this.options.release(); this.keyPointers.clear(); } this.invalidate(); }
  zoom(scale: number, center: Point = { x: this.width / 2, y: this.height / 2 }) { const tick = this.tickAt(center.x), pitch = this.view.topPitch - (center.y - RULER_HEIGHT) / this.view.rowHeight; this.view.beatWidth = clamp(this.view.beatWidth * scale, 14, 240); this.view.rowHeight = clamp(this.view.rowHeight * scale, 7, 42); this.view.startTick = tick - (center.x - KEY_WIDTH) / this.view.beatWidth * PPQ; this.view.topPitch = pitch + (center.y - RULER_HEIGHT) / this.view.rowHeight; this.constrain(); this.paintNow('zoom'); this.options.changed(); }
  fit(notes = this.store.project.notes) { if (!notes.length) { this.view.startTick = 0; this.view.topPitch = 84; this.view.beatWidth = 56; this.view.rowHeight = 20; } else { const b = bounds(notes); this.view.startTick = Math.max(0, b.start - PPQ / 2); this.view.beatWidth = clamp((this.width - KEY_WIDTH - 36) / ((b.end - this.view.startTick) / PPQ + 1), 14, 180); this.view.rowHeight = clamp((this.height - RULER_HEIGHT) / Math.max(20, b.high - b.low + 5), 7, 26); this.view.topPitch = Math.min(127, b.high + 2); } this.constrain(); this.invalidate(); this.options.changed(); }
  constrain() { this.view.startTick = clamp(this.view.startTick, 0, MAX_TICK - PPQ * 100); this.view.topPitch = clamp(this.view.topPitch, Math.min(127, (this.height - RULER_HEIGHT) / this.view.rowHeight - 1), 127); }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (rect.width <= 0 || rect.height <= 0) return;
    if (this.width === rect.width && this.height === rect.height && this.canvas.width === width && this.canvas.height === height) return;
    this.width = rect.width; this.height = rect.height;
    // Intrinsic-size writes erase the bitmap, even when the value is unchanged.
    // ResizeObserver runs after rAF: paint here, before the browser can present a cleared frame.
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0); this.constrain();
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    this.draw(); this.onResize?.();
  }
  invalidate() { this.dirty = true; if (this.frame) return; this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); }
  paintNow(kind: string) { const started = this.lastInput || performance.now(); this.draw(); this.metrics.push({ kind, ms: performance.now() - started, notes: this.store.project.notes.length }); if (this.metrics.length > 500) this.metrics.shift(); this.lastInput = 0; }
  draw() {
    this.dirty = false;
    const c = this.context, w = this.width, h = this.height, v = this.view, p = this.store.project;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    const lo = Math.max(0, this.pitchAt(h)), hi = Math.min(127, Math.ceil(v.topPitch));
    for (let pitch = lo; pitch <= hi; pitch++) { const y = this.yAt(pitch), black = [1, 3, 6, 8, 10].includes(pitch % 12); c.fillStyle = black ? '#f6f5f9' : '#fdfdfe'; c.fillRect(KEY_WIDTH, y, w - KEY_WIDTH, v.rowHeight); c.strokeStyle = pitch % 12 === 0 ? '#dad6e5' : '#efedf4'; c.lineWidth = 1; c.beginPath(); c.moveTo(KEY_WIDTH, y + v.rowHeight); c.lineTo(w, y + v.rowHeight); c.stroke(); }
    const startBeat = Math.floor(v.startTick / PPQ), endBeat = Math.ceil(this.tickAt(w) / PPQ), step = v.beatWidth >= 40 ? PPQ / 4 : PPQ;
    for (let tick = Math.floor(v.startTick / step) * step; tick <= endBeat * PPQ; tick += step) {
      const x = this.xAt(tick); if (x < KEY_WIDTH) continue; const meter = p.meters.findLast(m => m.tick <= tick) ?? p.meters[0]; const bar = meter.numerator * PPQ * 4 / meter.denominator, major = (tick - meter.tick) % bar === 0;
      c.strokeStyle = major ? '#d8d3e4' : tick % PPQ === 0 ? '#e5e1ed' : '#f0edf5'; c.lineWidth = major ? 1.3 : 1; c.beginPath(); c.moveTo(x, RULER_HEIGHT); c.lineTo(x, h); c.stroke();
    }
    c.save(); c.beginPath(); c.rect(KEY_WIDTH, RULER_HEIGHT, w - KEY_WIDTH, h - RULER_HEIGHT); c.clip();
    const partById = new Map(p.parts.map(x => [x.id, x])), from = v.startTick, to = this.tickAt(w);
    for (let pitch = lo; pitch <= hi; pitch++) for (const original of this.byPitch[pitch]) {
      if (this.draft.has(original.id)) continue; if (original.startTick > to) break; if (original.startTick + original.durationTick < from) continue; this.drawNote(original, partById.get(original.partId)!.color, partById.get(original.partId)!.mute);
    }
    for (const n of this.draft.values()) this.drawNote(n, partById.get(n.partId)!.color, false, true);
    if (this.marquee) { const { a, b } = this.marquee; c.fillStyle = '#7755bd18'; c.strokeStyle = '#7755bd'; c.lineWidth = 1.5; c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    const s = this.session(); if (s.loop.enabled) { const x = this.xAt(s.loop.start), end = this.xAt(s.loop.end); c.fillStyle = '#7755bd08'; c.fillRect(x, RULER_HEIGHT, end - x, h - RULER_HEIGHT); c.strokeStyle = '#9d82cc'; c.setLineDash([3, 5]); for (const xx of [x, end]) { c.beginPath(); c.moveTo(xx, RULER_HEIGHT); c.lineTo(xx, h); c.stroke(); } c.setLineDash([]); }
    if (p.pedals.length) { const a = p.pedals.filter(e => !e.partId || e.partId === s.activePart).sort((a, b) => a.tick - b.tick); c.fillStyle = '#27847f55'; for (let i = 0; i < a.length; i++) if (a[i].value >= 64) c.fillRect(this.xAt(a[i].tick), h - 5, this.xAt(a[i + 1]?.tick ?? endTick(p)) - this.xAt(a[i].tick), 4); }
    c.restore();
    // Keyboard and ruler are drawn last so clipped notes cannot cover their hit targets.
    c.fillStyle = '#fcfbfe'; c.fillRect(0, 0, KEY_WIDTH, h); c.fillStyle = '#f9f8fc'; c.fillRect(KEY_WIDTH, 0, w - KEY_WIDTH, RULER_HEIGHT);
    for (let pitch = lo; pitch <= hi; pitch++) { const y = this.yAt(pitch), black = [1, 3, 6, 8, 10].includes(pitch % 12); if (y + v.rowHeight < RULER_HEIGHT) continue;
      c.fillStyle = [...this.keyPointers.values()].includes(pitch) ? '#c8b8e3' : black ? '#34303e' : '#ffffff'; c.fillRect(0, Math.max(RULER_HEIGHT, y), black ? KEY_WIDTH - 15 : KEY_WIDTH - 1, v.rowHeight - 1);
      if (v.rowHeight >= 12 && (!black || v.rowHeight >= 22)) { c.fillStyle = black ? '#e3deed' : '#797083'; c.font = `${pitch % 12 === 0 ? '600' : '400'} 10px system-ui`; c.textAlign = 'right'; c.fillText(noteName(pitch), black ? KEY_WIDTH - 22 : KEY_WIDTH - 7, y + v.rowHeight * .65); }
    }
    c.fillStyle = '#81788e'; c.font = '10px system-ui'; c.textAlign = 'center'; c.fillText('音程', KEY_WIDTH / 2, 23);
    for (let beat = startBeat; beat <= endBeat; beat++) { const tick = beat * PPQ, x = this.xAt(tick); if (x < KEY_WIDTH + 3) continue; const meter = p.meters.findLast(m => m.tick <= tick) ?? p.meters[0], barTicks = meter.numerator * PPQ * 4 / meter.denominator; const major = (tick - meter.tick) % barTicks === 0;
      if (major || v.beatWidth >= 48) { c.fillStyle = major ? '#4a405b' : '#a49bb0'; c.font = major ? '600 11px system-ui' : '10px system-ui'; c.textAlign = 'left'; c.fillText(major ? this.barLabel(tick) : '·', x + 5, 23); }
    }
    for (const f of this.phraseRanges) { const x1 = Math.max(KEY_WIDTH, this.xAt(f.start)), x2 = Math.min(w, this.xAt(f.end)); if (x2 <= x1) continue; c.fillStyle = f.noteIds.every(id => this.selected.has(id)) ? '#7755bd' : '#d5c7e9'; c.fillRect(x1, 26, x2-x1-1, 10); if (x2-x1>50) { c.fillStyle = '#fff'; c.font = '9px system-ui'; c.textAlign = 'left'; c.fillText(f.name, x1+4, 34, x2-x1-8); } }
    const x = this.xAt(this.playing ? this.cursor : s.cursor); if (x >= KEY_WIDTH && x <= w) { c.fillStyle = '#7755bd'; c.beginPath(); c.moveTo(x - 5, 28); c.lineTo(x + 5, 28); c.lineTo(x, 34); c.fill(); c.strokeStyle = '#7755bdaa'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, RULER_HEIGHT); c.lineTo(x, h); c.stroke(); }
    if (!p.notes.length) { c.fillStyle = '#635974'; c.font = '500 18px system-ui'; c.textAlign = 'center'; c.fillText('音を置くところから。', (w + KEY_WIDTH) / 2, h * .44); c.fillStyle = '#94899f'; c.font = '12px system-ui'; c.fillText('空いている場所をタップして、最初の音を。', (w + KEY_WIDTH) / 2, h * .44 + 27); }
    if (this.navigationLatch || this.picking || this.draft.size) { const n = this.draft.values().next().value; const text = this.navigationLatch ? '2本指 · 画面を移動' : this.picking ? '音符をタップ / 空白を囲んで選択' : `${noteName(n!.pitch)} · ${(n!.startTick / PPQ).toFixed(2)}拍 · 長さ ${(n!.durationTick / PPQ).toFixed(2)}拍`; c.fillStyle = '#f9f8fc'; c.fillRect(KEY_WIDTH+4, 0, Math.min(300,w-KEY_WIDTH-4),24); c.fillStyle = '#5d3c9e'; c.font = '11px system-ui'; c.textAlign = 'left'; c.fillText(text, KEY_WIDTH+12,17); }
  }
  barLabel(tick: number) { let bars = 1, at = 0, meter = this.store.project.meters[0]; for (const m of this.store.project.meters.slice(1)) { if (m.tick > tick) break; bars += Math.ceil((m.tick - at) / (meter.numerator * PPQ * 4 / meter.denominator)); at = m.tick; meter = m; } return String(Math.floor(bars + (tick - at) / (meter.numerator * PPQ * 4 / meter.denominator))); }
  drawNote(n: Note, color: string, muted: boolean, draft = false) {
    const c = this.context, r = this.rect(n), selected = this.selected.has(n.id);
    c.globalAlpha = muted ? .25 : .68 + n.velocity / 127 * .32; c.fillStyle = color; c.beginPath(); c.roundRect(r.x + .5, r.y, Math.max(2, r.w - 1), r.h, Math.min(4, r.h / 3, r.w / 3)); c.fill(); c.globalAlpha = 1;
    if (selected || draft || this.gesture?.target?.id === n.id) { c.strokeStyle = draft ? '#2d213f' : '#3d275c'; c.lineWidth = 2; c.strokeRect(r.x + .5, r.y - .5, r.w - 1, r.h + 1); }
    if (r.w > 28 && r.h >= 12) { c.fillStyle = '#fff'; c.font = '500 10px system-ui'; c.textAlign = 'left'; c.fillText(noteName(n.pitch), r.x + 6, r.y + r.h * .73, r.w - 15); c.fillStyle = '#ffffff65'; c.fillRect(r.x + r.w - 7, r.y + r.h * .22, 2, r.h * .56); }
    if (selected && this.selected.values().next().value === n.id && r.w < 30) { c.strokeStyle = color; c.lineWidth = 2; const y = r.y+r.h/2; for (const x of [r.x-12,r.x+r.w+12]) { c.beginPath(); c.moveTo(x,y); c.lineTo(x < r.x ? r.x : r.x+r.w,y); c.stroke(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x,y,8,0,Math.PI*2); c.fill(); c.stroke(); c.beginPath(); c.moveTo(x-3,y); c.lineTo(x+3,y); if (x < r.x) { c.moveTo(x,y-3); c.lineTo(x,y+3); } c.stroke(); } }
  }
  key(e: KeyboardEvent) {
    if (e.key === 'Escape') { this.cancel(); this.select(new Set()); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.select(new Set(this.store.project.notes.map(n => n.id))); return; }
    if (!this.selected.size) {
      if (e.key === 'Enter') { e.preventDefault(); const s = this.session(); this.store.insert([{ id: uid(), partId: s.activePart, pitch: this.keyboardPitch, startTick: Math.round(s.cursor), durationTick: s.noteLength, velocity: 80 }]); this.options.audition(this.keyboardPitch, 80); this.options.notify(`${noteName(this.keyboardPitch)} を追加`); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.options.seek(Math.max(0, this.session().cursor + (e.key === 'ArrowLeft' ? -1 : 1) * (this.session().snap || 1))); else { this.keyboardPitch = clamp(this.keyboardPitch + (e.key === 'ArrowUp' ? 1 : -1), 0, 127); this.options.notify(`${noteName(this.keyboardPitch)} · Enter で追加`); } this.invalidate(); this.options.changed(); }
      return;
    }
    try {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.store.delete(this.selected); }
      const horizontal = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0, vertical = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      if (horizontal || vertical) { e.preventDefault(); this.store.move(this.selected, horizontal * (this.session().snap || 1) * (e.shiftKey ? 4 : 1), vertical * (e.shiftKey ? 12 : 1)); }
    } catch (error) { this.options.notify((error as Error).message); }
  }
}
