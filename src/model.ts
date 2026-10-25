export const PPQ = 960;
export const MAX_TICK = 2 ** 31 - 1;
export type Hand = 'right' | 'left' | 'unspecified';
export interface Note { id: string; partId: string; startTick: number; durationTick: number; pitch: number; velocity: number }
export interface Part { id: string; name: string; hand: Hand; role: string; color: string; mute: boolean; solo: boolean }
export interface Tempo { tick: number; bpm: number }
export interface Meter { tick: number; numerator: number; denominator: number }
export interface Pedal { id: string; tick: number; value: number; partId?: string }
export interface Variant { id: string; name: string; notes: Note[] }
export interface Phrase { id: string; name: string; noteIds: string[]; variants: Variant[] }
export interface Project {
  schemaVersion: 1; id: string; name: string; revision: number; updatedAt: string;
  ppq: 960; notes: Note[]; parts: Part[]; tempos: Tempo[]; meters: Meter[]; pedals: Pedal[]; phrases: Phrase[];
}
export interface View { startTick: number; topPitch: number; beatWidth: number; rowHeight: number }
export interface Session { editSound?: boolean; pendingEdit?: { originals: Note[]; draft: Note[]; label: string }; view: View; cursor: number; activePart: string; snap: number; noteLength: number; loop: { enabled: boolean; start: number; end: number } }
export const uid = () => { if (crypto.randomUUID) return crypto.randomUUID(); const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128; const s = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; };
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const snapTick = (n: number, grid: number) => Math.max(0, Math.round(grid ? n / grid : n) * (grid || 1));
export const noteName = (p: number) => ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
export const initialView = (): View => ({ startTick: 0, topPitch: 84, beatWidth: 56, rowHeight: 20 });
export const initialSession = (p: Project): Session => ({ view: initialView(), cursor: 0, activePart: p.parts[0].id, snap: 240, noteLength: 960, loop: { enabled: false, start: 0, end: 3840 * 4 } });
export function newProject(name = '無題のピアノ曲'): Project {
  return { schemaVersion: 1, id: uid(), name, revision: 0, updatedAt: new Date().toISOString(), ppq: PPQ,
    notes: [], parts: [
      { id: uid(), name: 'メロディー', hand: 'unspecified', role: 'melody', color: '#7755bd', mute: false, solo: false },
      { id: uid(), name: '伴奏', hand: 'left', role: 'accompaniment', color: '#27847f', mute: false, solo: false },
      { id: uid(), name: '内声', hand: 'unspecified', role: 'inner', color: '#b4742d', mute: false, solo: false },
    ], tempos: [{ tick: 0, bpm: 100 }], meters: [{ tick: 0, numerator: 4, denominator: 4 }], pedals: [], phrases: [] };
}
function integer(v: unknown, lo: number, hi: number): v is number { return Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi; }
function array(v: unknown, limit: number): v is unknown[] { return Array.isArray(v) && v.length <= limit; }
function obj(v: unknown): v is Record<string, any> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
const text = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
export function validateProject(v: unknown): asserts v is Project {
  if (!obj(v) || v.schemaVersion !== 1 || v.ppq !== PPQ || !text(v.id) || !text(v.name) || !integer(v.revision, 0, Number.MAX_SAFE_INTEGER) || !text(v.updatedAt) || !Number.isFinite(Date.parse(v.updatedAt))) throw Error('未対応または壊れた作品形式です。');
  if (!array(v.parts, 16) || !v.parts.length || !array(v.notes, 100000) || !array(v.phrases, 2000) || !array(v.pedals, 100000) || !array(v.tempos, 10000) || !array(v.meters, 10000)) throw Error('作品の件数が不正です（最大10万音・16声部）。');
  const parts = new Set<string>(), notes = new Set<string>(), phrases = new Set<string>(), pedals = new Set<string>();
  for (const p of v.parts) {
    if (!obj(p) || !text(p.id) || parts.has(p.id) || !text(p.name) || !['right', 'left', 'unspecified'].includes(p.hand) || !text(p.role) || !/^#[0-9a-f]{6}$/i.test(p.color) || typeof p.mute !== 'boolean' || typeof p.solo !== 'boolean') throw Error('声部データが不正です。');
    parts.add(p.id);
  }
  const checkNote = (n: unknown) => {
    if (!obj(n) || !text(n.id) || !parts.has(n.partId) || !integer(n.startTick, 0, MAX_TICK) || !integer(n.durationTick, 1, MAX_TICK - n.startTick) || !integer(n.pitch, 0, 127) || !integer(n.velocity, 1, 127)) throw Error('音符の音高・時刻・長さ・強弱が不正です。');
  };
  for (const n of v.notes) { checkNote(n); const id = (n as Note).id; if (notes.has(id)) throw Error('音符IDが重複しています。'); notes.add(id); }
  for (const [key, check] of [['tempos', (e: any) => typeof e.bpm === 'number' && Number.isFinite(e.bpm) && e.bpm >= 10 && e.bpm <= 1000], ['meters', (e: any) => integer(e.numerator, 1, 32) && [1, 2, 4, 8, 16, 32].includes(e.denominator)]] as const) {
    const seen = new Set();
    if (!(v[key] as any[]).length || (v[key] as any[])[0].tick !== 0) throw Error('曲頭のテンポ・拍子が必要です。');
    let prev = -1;
    for (const e of v[key] as any[]) { if (!obj(e) || !integer(e.tick, 0, MAX_TICK) || seen.has(e.tick) || e.tick < prev || !check(e)) throw Error('テンポ・拍子が不正です。'); seen.add(e.tick); prev = e.tick; }
  }
  for (const e of v.pedals) { if (!obj(e) || !text(e.id) || pedals.has(e.id) || !integer(e.tick, 0, MAX_TICK) || !integer(e.value, 0, 127) || (e.partId !== undefined && !parts.has(e.partId))) throw Error('ペダルデータが不正です。'); pedals.add(e.id); }
  for (const f of v.phrases) {
    if (!obj(f) || !text(f.id) || phrases.has(f.id) || !text(f.name) || !array(f.noteIds, 100000) || f.noteIds.some(id => !notes.has(id as string)) || new Set(f.noteIds).size !== f.noteIds.length || !array(f.variants, 40)) throw Error('フレーズデータが不正です。');
    phrases.add(f.id); const variants = new Set<string>();
    for (const a of f.variants) { if (!obj(a) || !text(a.id) || variants.has(a.id) || !text(a.name) || !array(a.notes, 100000)) throw Error('別案データが不正です。'); variants.add(a.id); const ids = new Set<string>(); for (const n of a.notes) { checkNote(n); if (ids.has((n as Note).id)) throw Error('別案の音符IDが重複しています。'); ids.add((n as Note).id); } }
  }
}
export const endTick = (p: Project) => p.pedals.reduce((m, e) => Math.max(m, e.tick), p.notes.reduce((m, n) => Math.max(m, n.startTick + n.durationTick), PPQ * 4));
export function audibleNotes(p: Project): Note[] { const solo = p.parts.some(x => x.solo); const ids = new Set(p.parts.filter(x => !x.mute && (!solo || x.solo)).map(x => x.id)); return p.notes.filter(x => ids.has(x.partId)); }
export function bounds(notes: Note[]) { let start = Infinity, end = -Infinity, low = Infinity, high = -Infinity; for (const n of notes) { start = Math.min(start, n.startTick); end = Math.max(end, n.startTick + n.durationTick); low = Math.min(low, n.pitch); high = Math.max(high, n.pitch); } return { start, end, low, high }; }
export class ProjectStore extends EventTarget {
  project: Project;
  past: { project: Project; label: string }[] = [];
  future: { project: Project; label: string }[] = [];
  lastLabel = '';
  constructor(p: Project) { super(); validateProject(p); this.project = p; }
  replace(p: Project) { validateProject(p); this.project = p; this.past = []; this.future = []; this.lastLabel = ''; this.dispatchEvent(new Event('change')); }
  commit(label: string, change: (p: Project) => Project) {
    const before = this.project, after = change(before);
    if (before === after) return false;
    const next = { ...after, revision: before.revision + 1, updatedAt: new Date().toISOString() };
    validateProject(next);
    this.past.push({ project: before, label }); if (this.past.length > 80) this.past.shift(); this.future = [];
    this.project = next; this.lastLabel = label; this.dispatchEvent(new Event('change')); return true;
  }
  undo() { const x = this.past.pop(); if (!x) return; this.future.push({ project: this.project, label: x.label }); this.restore(x.project, '元に戻す：' + x.label); }
  redo() { const x = this.future.pop(); if (!x) return; this.past.push({ project: this.project, label: x.label }); this.restore(x.project, 'やり直す：' + x.label); }
  private restore(p: Project, label: string) { this.project = { ...p, revision: this.project.revision + 1, updatedAt: new Date().toISOString() }; this.lastLabel = label; this.dispatchEvent(new Event('change')); }
  insert(notes: Note[]) { if (!notes.length) return; this.commit('音符を追加', p => ({ ...p, notes: [...p.notes, ...notes] })); }
  update(ids: Set<string>, label: string, transform: (n: Note) => Note) {
    if (!ids.size) return;
    this.commit(label, p => { let changed = false; const notes = p.notes.map(n => { if (!ids.has(n.id)) return n; const x = transform(n); if (Object.keys(n).some(k => x[k as keyof Note] !== n[k as keyof Note])) changed = true; return x; }); return changed ? { ...p, notes } : p; });
  }
  delete(ids: Set<string>) { this.commit('音符を削除', p => ids.size ? ({ ...p, notes: p.notes.filter(n => !ids.has(n.id)), phrases: p.phrases.map(f => ({ ...f, noteIds: f.noteIds.filter(id => !ids.has(id)) })) }) : p); }
  move(ids: Set<string>, tick: number, pitch: number) { const notes = this.project.notes.filter(n => ids.has(n.id)); if (!notes.length) return; const b = bounds(notes); if (b.start + tick < 0 || b.end + tick > MAX_TICK || b.low + pitch < 0 || b.high + pitch > 127) throw Error('移動先が音域または時間の範囲外です。'); this.update(ids, '音符を移動', n => ({ ...n, startTick: n.startTick + tick, pitch: n.pitch + pitch })); }
  duplicate(ids: Set<string>, at?: number, insert = false) {
    const notes = this.project.notes.filter(n => ids.has(n.id)); if (!notes.length) return [];
    const b = bounds(notes), start = at ?? b.end, span = b.end - b.start;
    const copies = notes.map(n => ({ ...n, id: uid(), startTick: n.startTick - b.start + start }));
    this.commit(insert ? 'フレーズを途中に挿入' : '音符を複製', p => ({ ...p,
      notes: [...p.notes.map(n => insert && n.startTick >= start ? { ...n, startTick: n.startTick + span } : n), ...copies],
      pedals: p.pedals.map(e => insert && e.tick >= start ? { ...e, tick: e.tick + span } : e),
      tempos: insert ? insertTimeEvents(p.tempos, start, span) : p.tempos,
      meters: insert ? insertTimeEvents(p.meters, start, span) : p.meters,
    })); return copies.map(n => n.id);
  }
  stretch(ids: Set<string>, factor: number) { const notes = this.project.notes.filter(n => ids.has(n.id)); if (!notes.length || !Number.isFinite(factor) || factor <= 0) return; const b = bounds(notes); this.update(ids, 'フレーズを伸縮', n => ({ ...n, startTick: Math.round(b.start + (n.startTick - b.start) * factor), durationTick: Math.max(1, Math.round(n.durationTick * factor)) })); }
  invert(ids: Set<string>, direction: 1 | -1) { const notes = this.project.notes.filter(n => ids.has(n.id)).sort((a, b) => a.pitch - b.pitch); if (!notes.length) return; const target = direction === 1 ? notes[0] : notes.at(-1)!; const pitch = target.pitch + direction * 12; if (pitch < 0 || pitch > 127) throw Error('転回先が音域外です。'); this.update(new Set([target.id]), '和音を転回', n => ({ ...n, pitch })); }
  group(ids: Set<string>, name: string) { const ns = this.project.notes.filter(n => ids.has(n.id)); if (!ns.length) return; const b = bounds(ns); const f: Phrase = { id: uid(), name, noteIds: ns.map(n => n.id), variants: [{ id: uid(), name: 'A · 元の案', notes: ns.map(n => ({ ...n, startTick: n.startTick - b.start })) }] }; this.commit('フレーズ化', p => ({ ...p, phrases: [...p.phrases, f] })); return f; }
  saveVariant(phraseId: string, name: string) { this.commit('フレーズの別案を保存', p => ({ ...p, phrases: p.phrases.map(f => { if (f.id !== phraseId) return f; const ns = p.notes.filter(n => f.noteIds.includes(n.id)); if (!ns.length) throw Error('保存する音符がありません。'); if (f.variants.length >= 40) throw Error('別案は1フレーズ40個までです。'); const b = bounds(ns); return { ...f, variants: [...f.variants, { id: uid(), name, notes: ns.map(n => ({ ...n, startTick: n.startTick - b.start })) }] }; }) })); }
  applyVariant(phraseId: string, variantId: string) {
    let selected: string[] = [];
    this.commit('フレーズの別案に切替', p => {
      const f = p.phrases.find(f => f.id === phraseId), a = f?.variants.find(a => a.id === variantId); if (!f || !a) return p;
      const old = p.notes.filter(n => f.noteIds.includes(n.id)); if (!old.length) throw Error('適用先のフレーズが空です。');
      const at = bounds(old).start, fresh = a.notes.map(n => ({ ...n, id: uid(), startTick: n.startTick + at })); selected = fresh.map(n => n.id);
      return { ...p, notes: [...p.notes.filter(n => !f.noteIds.includes(n.id)), ...fresh], phrases: p.phrases.map(x => x.id === f.id ? { ...x, noteIds: selected } : { ...x, noteIds: x.noteIds.filter(id => !f.noteIds.includes(id)) }) };
    }); return selected;
  }
}
function insertTimeEvents<T extends { tick: number }>(events: T[], at: number, span: number): T[] { const active = events.filter(e => e.tick <= at).at(-1)!; const next = events.map(e => e.tick >= at && e.tick !== 0 ? { ...e, tick: e.tick + span } : e); if (at > 0) next.push({ ...active, tick: at }); return [...new Map(next.map(e => [e.tick, e])).values()].sort((a, b) => a.tick - b.tick); }
export function setEvent<T extends { tick: number }>(events: T[], event: T) { return [...events.filter(e => e.tick !== event.tick), event].sort((a, b) => a.tick - b.tick); }
export function exampleProject() {
  const p = newProject('ひかりのスケッチ'); const melody = [72, 76, 79, 76, 74, 77, 81, 77, 71, 74, 79, 74, 72, 76, 79, 84];
  p.notes = melody.map((pitch, i) => ({ id: uid(), partId: p.parts[0].id, startTick: i * 960, durationTick: i === 15 ? 960 : 780, pitch, velocity: 72 + (i % 4) * 6 }));
  [[48, 55, 60], [50, 57, 62], [43, 55, 59], [48, 55, 60]].forEach((chord, i) => chord.forEach(pitch => p.notes.push({ id: uid(), partId: p.parts[1].id, startTick: i * 3840, durationTick: 3480, pitch, velocity: 54 })));
  for (let i = 0; i < 4; i++) p.pedals.push({ id: uid(), tick: i * 3840 + 60, value: 127 }, { id: uid(), tick: (i + 1) * 3840 - 80, value: 0 });
  return p;
}
