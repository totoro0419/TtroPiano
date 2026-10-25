import { audibleNotes, bounds, endTick, type Note, type Project, type Session } from './model';
import { TempoMap, planWindow, effectiveEnd } from './time';
interface Sample { file: string; root: number; layer: 'soft' | 'hard'; cents: number; bytes: number }
interface Bank { samples: Sample[]; name: string; bytes: number }
export const appRoot = new URL(document.querySelector<HTMLMetaElement>('meta[name="ttropiano-root"]')?.content ?? './', document.baseURI);
const sampleBase = new URL('piano/', appRoot);
export interface Voice { source: AudioBufferSourceNode; gain: GainNode; when: number; end: number; release: (at?: number) => void; cancel: () => void }
export class Piano extends EventTarget {
  context?: AudioContext;
  master?: GainNode;
  bank?: Bank;
  loading?: Promise<Bank>;
  buffers = new Map<string, { buffer: AudioBuffer; touched: number }>();
  pending = new Map<string, Promise<AudioBuffer>>();
  voices = new Set<Voice>();
  status = 'ピアノ音源';
  totalBytes = 0;
  maxBytes = 48 * 1024 * 1024;
  manifest() { return this.loading ??= fetch(new URL('manifest.json', sampleBase)).then(r => { if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw Error('ピアノ音源を取得できません。接続を確認して再試行してください。'); return r.json(); }).then((b: Bank) => this.bank = b).catch(e => { this.loading = undefined; throw e; }); }
  // All assets are same-origin and bundled. No third-party requests are made while composing.
  async ensure() {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) throw Error('このブラウザーでは音声再生を利用できません。');
      this.context = new Ctor({ latencyHint: 'interactive' }) as AudioContext;
      this.master = this.context.createGain(); this.master.gain.value = .7;
      const limiter = this.context.createDynamicsCompressor(); limiter.threshold.value = -5; limiter.knee.value = 6; limiter.ratio.value = 8; limiter.attack.value = .003; limiter.release.value = .15;
      this.master.connect(limiter); limiter.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
    await this.manifest(); return this.context;
  }
  sample(pitch: number, velocity: number) { const layer = velocity >= 90 ? 'hard' : 'soft'; return this.bank!.samples.filter(s => s.layer === layer).reduce((a, b) => Math.abs(b.root - pitch) < Math.abs(a.root - pitch) ? b : a); }
  async buffer(sample: Sample): Promise<AudioBuffer> {
    const cached = this.buffers.get(sample.file); if (cached) { cached.touched = performance.now(); return cached.buffer; }
    const pending = this.pending.get(sample.file); if (pending) return pending;
    const promise = (async () => {
      const response = await fetch(new URL(sample.file, sampleBase)); if (!response.ok) throw Error('ピアノのサンプルを読み込めません。');
      let buffer: AudioBuffer;
      try { buffer = await this.context!.decodeAudioData(await response.arrayBuffer()); }
      catch (error) { throw Error(`ピアノサンプル ${sample.file} のデコードに失敗：${error instanceof Error ? error.message : String(error)}`); }
      const bytes = buffer.length * buffer.numberOfChannels * 4;
      // Voices retain their own AudioBuffer references until release; idle cache is bounded.
      while (this.totalBytes + bytes > this.maxBytes && this.buffers.size) { const [key, value] = [...this.buffers].sort((a, b) => a[1].touched - b[1].touched)[0]; this.buffers.delete(key); this.totalBytes -= value.buffer.length * value.buffer.numberOfChannels * 4; }
      this.buffers.set(sample.file, { buffer, touched: performance.now() }); this.totalBytes += bytes; return buffer;
    })().finally(() => this.pending.delete(sample.file)); this.pending.set(sample.file, promise); return promise;
  }
  async prepare(notes: Note[]) { await this.ensure(); const unique = new Map(notes.map(n => { const s = this.sample(n.pitch, n.velocity); return [s.file, s]; })); const list = [...unique.values()]; let next = 0; await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => { while (next < list.length) await this.buffer(list[next++]); })); }
  async play(pitch: number, velocity = 80, duration = .5, when?: number, startOffset = 0): Promise<Voice> {
    const context = await this.ensure(), sample = this.sample(pitch, velocity), buffer = await this.buffer(sample);
    return this.playBuffer(context, this.master!, sample, buffer, pitch, velocity, duration, when ?? context.currentTime, startOffset);
  }
  playBuffer(context: BaseAudioContext, destination: AudioNode, sample: Sample, buffer: AudioBuffer, pitch: number, velocity: number, duration: number, desired: number, startOffset = 0): Voice {
    const now = context.currentTime, when = Math.max(now, desired), offset = Math.max(0, now - desired) + startOffset;
    const rate = 2 ** ((pitch - sample.root - sample.cents / 100) / 12);
    const source = context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = Math.min(context.sampleRate * .45, 2600 + (velocity / 127) ** 1.2 * 11500); filter.Q.value = .25;
    const gain = context.createGain(), level = .72 * (velocity / 127) ** 1.5;
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(level, when + .004);
    source.connect(filter); filter.connect(gain); gain.connect(destination);
    const available = Math.max(.001, buffer.duration / rate - offset);
    const end = Math.max(when + .006, desired + duration);
    let released = false;
    const voice: Voice = { source, gain, when, end,
      release: (at = context.currentTime) => { if (released && at >= end) return; released = true; const t = Math.max(context.currentTime, at); gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(level, t); gain.gain.exponentialRampToValueAtTime(.00001, t + .2); try { source.stop(t + .22); } catch {} },
      cancel: () => { try { source.stop(); } catch {} this.voices.delete(voice); },
    };
    gain.gain.setValueAtTime(level, end); gain.gain.exponentialRampToValueAtTime(.00001, end + .2);
    const offsetFrames = Math.min(Math.max(0, offset * rate), Math.max(0, buffer.duration - .001));
    source.start(when, offsetFrames); source.stop(Math.min(when + available + .01, end + .22));
    this.voices.add(voice); source.onended = () => { this.voices.delete(voice); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    return voice;
  }
  silence() { for (const v of this.voices) v.cancel(); this.voices.clear(); }
}
export class Transport extends EventTarget {
  playing = false;
  preparing = false;
  originTick = 0;
  baseTime = 0;
  until = 0;
  map: TempoMap;
  timer = 0;
  generation = 0;
  requestGeneration = 0;
  scheduled = new Map<string, { time: number; voice?: Voice; cancelled: boolean }>();
  preview?: { ids?: Set<string>; notes?: Note[]; start: number; end: number };
  constructor(public piano: Piano, public project: () => Project, public session: () => Session, public notify: (message: string) => void) { super(); this.map = new TempoMap(project().tempos); }
  async toggle() { if (this.playing || this.preparing) this.pause(); else await this.start(); }
  playbackProject() { const p = this.project(); return this.preview ? { ...p, notes: this.preview.notes ?? p.notes.filter(n => this.preview!.ids!.has(n.id)) } : p; }
  playbackLoop() { return this.preview ? { enabled: false, start: this.preview.start, end: this.preview.end } : this.session().loop; }
  async startSelection(notes: Note[], detached = false) {
    if (!notes.length) return; this.pause(); const p = this.project(), b = bounds(notes);
    this.preview = { ...(detached ? { notes: structuredClone(notes) } : { ids: new Set(notes.map(n => n.id)) }), start: b.start, end: notes.reduce((end, n) => Math.max(end, effectiveEnd(p,n)), b.end) };
    this.session().cursor = b.start; await this.start();
  }
  async start() {
    const request = ++this.requestGeneration; this.preparing = true; this.dispatchEvent(new Event('state'));
    try {
      const s = this.session(), p = this.playbackProject(), loop = this.playbackLoop(); this.map = new TempoMap(p.tempos);
      this.originTick = loop.enabled ? Math.max(loop.start, Math.min(s.cursor, loop.end - 1)) : s.cursor;
      if (this.preview && (this.originTick < this.preview.start || this.originTick >= this.preview.end)) this.originTick = this.preview.start;
      else if (!this.preview && !loop.enabled && this.originTick >= endTick(p)) this.originTick = 0;
      const seconds = this.map.seconds(this.originTick);
      await this.piano.prepare(audibleNotes(p).filter(n => n.startTick >= this.originTick && this.map.seconds(n.startTick) < seconds + 3));
      if (request !== this.requestGeneration) return;
      this.baseTime = this.piano.context!.currentTime + .06; this.until = 0; this.playing = true; this.preparing = false; this.scheduled.clear();
      this.schedule(); this.timer = window.setInterval(() => this.schedule(), 25); this.dispatchEvent(new Event('state'));
    } catch (error) { if (request === this.requestGeneration) { this.preparing = false; this.notify(error instanceof Error ? error.message : String(error)); this.dispatchEvent(new Event('state')); } }
  }
  position() {
    if (!this.playing) return this.session().cursor;
    const seconds = Math.max(0, this.piano.context!.currentTime - this.baseTime), loop = this.playbackLoop();
    let target = this.map.seconds(this.originTick) + seconds;
    if (loop.enabled) { const a = this.map.seconds(loop.start), b = this.map.seconds(loop.end); if (target >= b && b > a) target = a + (target - b) % (b - a); }
    return this.map.tick(target);
  }
  pause() { this.requestGeneration++; if (this.playing) this.session().cursor = Math.round(this.position()); this.playing = false; this.preparing = false; clearInterval(this.timer); this.generation++; this.piano.silence(); this.scheduled.clear(); this.dispatchEvent(new Event('state')); }
  stop() { this.pause(); this.preview = undefined; this.session().cursor = this.session().loop.enabled ? this.session().loop.start : 0; this.dispatchEvent(new Event('state')); }
  seek(tick: number) { const wasPlaying = this.playing; this.pause(); this.preview = undefined; this.session().cursor = Math.round(tick); if (wasPlaying) void this.start(); }
  changed(tempoChanged = false) {
    if (!this.playing) { this.map = new TempoMap(this.project().tempos); return; }
    if (tempoChanged) { const tick = this.position(); this.pause(); this.session().cursor = Math.round(tick); void this.start(); return; }
    const elapsed = Math.max(0, this.piano.context!.currentTime - this.baseTime);
    // Preserve notes already sounding. Retract only future notes from the look-ahead window.
    for (const [key, x] of this.scheduled) if (this.baseTime + x.time > this.piano.context!.currentTime + .005) { x.cancelled = true; x.voice?.cancel(); this.scheduled.delete(key); }
    this.until = Math.max(0, this.piano.context!.currentTime - this.baseTime + .005); this.schedule();
  }
  schedule() {
    if (!this.playing) return;
    const p = this.playbackProject(), loop = this.playbackLoop(), elapsed = Math.max(0, this.piano.context!.currentTime - this.baseTime);
    const to = elapsed + .18, generation = this.generation;
    for (const event of planWindow(p, audibleNotes(p), this.map, this.originTick, this.until, to, loop)) {
      const key = event.cycle + ':' + event.note.id; if (this.scheduled.has(key)) continue;
      const entry = { time: event.time, voice: undefined as Voice | undefined, cancelled: false }; this.scheduled.set(key, entry);
      void this.piano.play(event.note.pitch, event.note.velocity, event.duration, this.baseTime + event.time, event.offset ?? 0).then(voice => { entry.voice = voice; if (entry.cancelled || generation !== this.generation || !this.playing) voice.cancel(); }).catch(e => { this.notify(e.message); this.pause(); });
    }
    this.until = to;
    for (const [key, x] of this.scheduled) if (elapsed - x.time > 60) this.scheduled.delete(key);
    if (!loop.enabled && this.position() > (this.preview?.end ?? endTick(p)) + 600) this.pause();
  }
}
