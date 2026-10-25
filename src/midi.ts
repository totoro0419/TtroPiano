import { PPQ, MAX_TICK, uid, newProject, validateProject, type Project, type Note, type Tempo, type Meter, type Pedal, type Part } from './model';
const str = new TextEncoder(), decoder = new TextDecoder();
const be16 = (n: number) => [n >> 8 & 255, n & 255];
const be32 = (n: number) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
function vlq(n: number) { if (!Number.isSafeInteger(n) || n < 0 || n > 0x0fffffff) throw Error('MIDIのデルタ時刻が範囲外です。'); const a = [n & 127]; while ((n = Math.floor(n / 128))) a.unshift(n & 127 | 128); return a; }
const chunk = (name: string, b: number[]) => [...str.encode(name), ...be32(b.length), ...b];
interface E { tick: number; priority: number; bytes: number[] }
function track(events: E[]) {
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority); let prev = 0; const bytes: number[] = [];
  for (const e of events) { bytes.push(...vlq(e.tick - prev), ...e.bytes); prev = e.tick; }
  bytes.push(0, 0xff, 0x2f, 0); return chunk('MTrk', bytes);
}
const meta = (kind: number, b: number[]) => [0xff, kind, ...vlq(b.length), ...b];
export function exportMidi(p: Project): Uint8Array {
  validateProject(p);
  const conductor: E[] = [{ tick: 0, priority: 0, bytes: meta(3, [...str.encode(p.name)]) }];
  for (const t of p.tempos) { const us = Math.round(60000000 / t.bpm); conductor.push({ tick: t.tick, priority: 1, bytes: meta(0x51, [us >> 16 & 255, us >> 8 & 255, us & 255]) }); }
  for (const t of p.meters) conductor.push({ tick: t.tick, priority: 1, bytes: meta(0x58, [t.numerator, Math.log2(t.denominator), 24, 8]) });
  const tracks = [track(conductor)];
  p.parts.forEach((part, i) => {
    const slot = i % 15, channel = slot >= 9 ? slot + 1 : slot;
    const events: E[] = [
      { tick: 0, priority: 0, bytes: meta(3, [...str.encode(part.name)]) },
      { tick: 0, priority: 0, bytes: meta(0x21, [Math.floor(i / 15)]) },
      { tick: 0, priority: 0, bytes: [0xc0 | channel, 0] },
    ];
    for (const n of p.notes.filter(n => n.partId === part.id)) events.push({ tick: n.startTick, priority: 3, bytes: [0x90 | channel, n.pitch, n.velocity] }, { tick: n.startTick + n.durationTick, priority: 2, bytes: [0x80 | channel, n.pitch, 0] });
    for (const e of p.pedals.filter(e => !e.partId || e.partId === part.id)) events.push({ tick: e.tick, priority: 1, bytes: [0xb0 | channel, 64, e.value] });
    tracks.push(track(events));
  });
  return new Uint8Array([...str.encode('MThd'), ...be32(6), ...be16(1), ...be16(tracks.length), ...be16(PPQ), ...tracks.flat()]);
}
class Reader {
  pos = 0; end: number;
  constructor(public bytes: Uint8Array) { this.end = bytes.length; }
  byte() { if (this.pos >= this.end) throw Error('MIDIが途中で切れています。'); return this.bytes[this.pos++]; }
  u16() { return this.byte() * 256 + this.byte(); }
  u32() { return this.byte() * 0x1000000 + this.byte() * 65536 + this.byte() * 256 + this.byte(); }
  data(n: number) { if (!Number.isSafeInteger(n) || n < 0 || n > this.end - this.pos) throw Error('MIDIのデータ長が不正です。'); const a = this.bytes.subarray(this.pos, this.pos + n); this.pos += n; return a; }
  variable() { let n = 0; for (let i = 0; i < 4; i++) { const b = this.byte(); n = n * 128 + (b & 127); if (!(b & 128)) return n; } throw Error('MIDIの時刻が不正です。'); }
  tag() { return decoder.decode(this.data(4)); }
}
export function importMidi(bytes: Uint8Array, filename = '読み込んだピアノ曲'): { project: Project; warnings: string[] } {
  if (bytes.byteLength > 20000000) throw Error('MIDIは20MBまで読み込めます。');
  const r = new Reader(bytes); if (r.tag() !== 'MThd') throw Error('標準MIDIファイルではありません。');
  const headerLength = r.u32(); if (headerLength < 6) throw Error('MIDIヘッダーが不正です。');
  const format = r.u16(), count = r.u16(), division = r.u16(); r.data(headerLength - 6);
  if (format > 1 || division & 0x8000 || division === 0 || count === 0 || count > 1024) throw Error('MIDI形式0/1・拍単位時刻に対応しています。形式2・SMPTEは未対応です。');
  const p = newProject(filename.replace(/\.mid[i]?$/i, '')); p.parts = []; p.notes = []; p.pedals = [];
  const tempos: Tempo[] = [], meters: Meter[] = [], warnings = new Set<string>();
  const toTick = (n: number) => { const t = Math.round(n * PPQ / division); if (t > MAX_TICK) throw Error('曲が長すぎます。'); return t; };
  for (let tr = 0; tr < count; tr++) {
    if (r.tag() !== 'MTrk') throw Error('MIDIトラックが不正です。'); const size = r.u32(), end = r.pos + size; if (end > bytes.length) throw Error('MIDIトラックが切れています。');
    r.end = end; let tick = 0, running = 0, name = '', lastTick = 0;
    const partByChannel = new Map<number, Part>(), pendingPedals: { channel: number; tick: number; value: number }[] = [];
    const active = new Map<string, { tick: number; pitch: number; velocity: number; channel: number }[]>();
    const part = (channel: number) => { let x = partByChannel.get(channel); if (!x) { if (p.parts.length >= 16) throw Error('16声部を超えるMIDIは読み込めません。'); x = { id: uid(), name: name || `声部 ${p.parts.length + 1}`, hand: 'unspecified', role: 'other', color: ['#7755bd', '#27847f', '#b4742d', '#b05078'][p.parts.length % 4], mute: false, solo: false }; partByChannel.set(channel, x); p.parts.push(x); } return x; };
    const finish = (channel: number, pitch: number) => { const key = `${channel}:${pitch}`, n = active.get(key)?.shift(); if (!n) { warnings.add('対応する開始音のないNote Offを無視しました。'); return; } const start = toTick(n.tick); p.notes.push({ id: uid(), partId: part(channel).id, pitch, velocity: n.velocity, startTick: start, durationTick: Math.max(1, toTick(tick) - start) }); if (p.notes.length > 100000) throw Error('10万音を超えるMIDIは読み込めません。'); };
    while (r.pos < end) {
      tick += r.variable(); if (!Number.isSafeInteger(tick)) throw Error('時刻が不正です。'); lastTick = tick;
      let status = r.byte(); if (status < 128) { if (!running) throw Error('MIDIのランニングステータスが不正です。'); r.pos--; status = running; }
      if (status === 0xff) {
        const kind = r.byte(), data = r.data(r.variable());
        if (kind === 3) { name = decoder.decode(data).replaceAll('\0', '').slice(0, 200) || name; for (const x of partByChannel.values()) x.name = name || x.name; if (tr === 0 && name) p.name = name; }
        if (kind === 0x51 && data.length === 3) { const us = data[0] * 65536 + data[1] * 256 + data[2]; const bpm = 60000000 / us; if (!us || bpm < 10 || bpm > 1000) throw Error('対応範囲外のテンポです（10〜1000 BPM）。'); tempos.push({ tick: toTick(tick), bpm }); }
        if (kind === 0x58 && data.length >= 2) { if (data[1] > 5 || data[0] < 1 || data[0] > 32) throw Error('対応範囲外の拍子です。'); meters.push({ tick: toTick(tick), numerator: data[0], denominator: 2 ** data[1] }); }
        if (kind === 0x2f) { r.pos = end; break; } continue;
      }
      if (status === 0xf0 || status === 0xf7) { running = 0; r.data(r.variable()); warnings.add('SysExは保存しません。'); continue; }
      if (status >= 0xf0) throw Error('未対応のMIDIシステムイベントです。');
      running = status; const kind = status >> 4, channel = status & 15, a = r.byte(), b = kind === 0xc || kind === 0xd ? 0 : r.byte(); if (a > 127 || b > 127) throw Error('MIDIの音符値が不正です。');
      if (kind === 9 && b > 0) { part(channel); const key = `${channel}:${a}`, q = active.get(key) ?? []; q.push({ tick, pitch: a, velocity: b, channel }); active.set(key, q); }
      else if (kind === 8 || kind === 9) finish(channel, a);
      else if (kind === 0xb && a === 64) pendingPedals.push({ channel, tick: toTick(tick), value: b });
      else if (kind === 0xc && a !== 0) warnings.add('すべての音色をピアノとして読み込みました。');
      else if (kind !== 0xc) warnings.add('ペダル以外のCC・ピッチベンド・アフタータッチは保存しません。');
    }
    tick = lastTick;
    for (const [key, q] of active) while (q.length) { const [channel, pitch] = key.split(':').map(Number); finish(channel, pitch); warnings.add('終端のない音符をトラック終端で閉じました。'); }
    for (const e of pendingPedals) { const x = partByChannel.get(e.channel); if (x) p.pedals.push({ id: uid(), partId: x.id, tick: e.tick, value: e.value }); }
    r.pos = end; r.end = bytes.length;
  }
  if (!p.parts.length) p.parts = newProject().parts;
  p.tempos = [...new Map([{ tick: 0, bpm: 120 }, ...tempos].map(t => [t.tick, t])).values()].sort((a, b) => a.tick - b.tick);
  p.meters = [...new Map([{ tick: 0, numerator: 4, denominator: 4 }, ...meters].map(t => [t.tick, t])).values()].sort((a, b) => a.tick - b.tick);
  p.notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch); validateProject(p);
  return { project: p, warnings: [...warnings] };
}
