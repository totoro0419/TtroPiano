import './style.css';
import { PPQ, clamp, uid, noteName, newProject, exampleProject, initialSession, validateProject, bounds, endTick, setEvent, ProjectStore, type Project, type Session, type Note, type Phrase } from './model';
import { Piano, Transport, appRoot, type Voice } from './audio';
import { PianoRoll, KEY_WIDTH, RULER_HEIGHT } from './roll';
import { Persistence } from './persistence';
import { exportMidi, importMidi } from './midi';
import { TempoMap } from './time';
import { icon } from './icons';
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const button = (id: string, name: string, glyph = '', cls = '') => `<button type="button" id="${id}" class="${cls}" title="${name}" aria-label="${name}">${glyph ? icon(glyph) : ''}<span>${name}</span></button>`;
export class App {
  store: ProjectStore; session: Session; storage = new Persistence(); piano = new Piano(); transport: Transport; roll!: PianoRoll;
  root: HTMLElement; ready: Promise<void>; held?: Voice; auditionId = 0; lastSaveTimer = 0; toastTimer = 0;
  pane: 'selection' | 'expression' | 'phrases' | null = null;
  lastTempos = '';
  destroyed = false;
  constructor(root: HTMLElement, public test = false) {
    this.root = root; root.classList.add('app-shell'); this.store = new ProjectStore(newProject()); this.session = initialSession(this.store.project);
    this.transport = new Transport(this.piano, () => this.store.project, () => this.session, message => this.notify(message));
    root.innerHTML = `<header class="topbar">
      <div class="identity">${button('works', '作品', 'folder', 'quiet labeled')}<span class="brand">TtroPiano</span><div class="document-title"><button id="rename" title="作品名を変更"><span id="project-name"></span><span class="pencil">⌄</span></button><button id="save-status" class="save-status" aria-live="polite">作品を読込中</button></div></div>
      <div class="transport">${button('undo', '元に戻す', 'undo', 'icon-button')}${button('redo', 'やり直す', 'redo', 'icon-button')}<span class="divider"></span>${button('stop', '曲頭へ戻る', 'stop', 'icon-button')}${button('play', '再生', 'play', 'primary play-button')}<button id="tempo" class="tempo-button" title="テンポ・拍子を設定"><strong>100</strong><small>BPM · 4/4</small></button></div>
      <div class="header-end">${button('settings', '曲の設定', 'settings', 'quiet labeled')}</div>
    </header>
    <div class="overview"><span id="position" class="position">1.1</span><canvas id="overview" aria-label="曲全体。タップしてその位置へ移動" tabindex="0"></canvas>${button('loop', 'ループ', 'loop', 'loop-button')}${button('phrase-pane', 'フレーズ', 'phrase', 'quiet labeled')}</div>
    <main class="workspace"><section class="roll-area" aria-label="ピアノロール"><canvas id="roll" tabindex="0" aria-label="音符エディター。空白タップで音符追加、音符タップで削除、ドラッグで移動、右端で伸縮、長押しで選択、2本指で移動と拡大。キーボード操作はヘルプ参照。"></canvas></section><aside id="inspector" class="inspector" hidden aria-label="音符と演奏表現"></aside></main>
    <footer class="bottombar"><label class="part-control"><i id="part-dot"></i><select id="active-part" aria-label="入力する声部"></select></label>${button('expression', '表現', '', 'quiet')}<span class="footer-spacer"></span><label class="compact-control"><span>音の長さ</span><select id="note-length" aria-label="新しい音符の長さ"><option value="240">¼拍</option><option value="480">½拍</option><option value="960" selected>1拍</option><option value="1920">2拍</option><option value="3840">4拍</option><option value="120">⅛拍</option><option value="320">⅓拍</option></select></label><label class="compact-control"><span>吸着</span><select id="snap" aria-label="拍グリッド吸着"><option value="0">なし</option><option value="120">⅛拍</option><option value="240" selected>¼拍</option><option value="480">½拍</option><option value="960">1拍</option><option value="320">⅓拍</option></select></label>${button('fit', '全体', 'fit', 'quiet labeled')}<div class="zoom-controls"><button id="zoom-out" title="縮小" aria-label="縮小">−</button><button id="zoom-in" title="拡大" aria-label="拡大">＋</button></div><button id="help" class="help-button" title="操作のヒント" aria-label="操作のヒント">?</button></footer>
    <div id="toast" class="toast" role="status" hidden></div><div id="floating" class="floating" popover="auto" role="dialog" aria-label="曲と操作の設定"></div>
    <dialog id="library-dialog" class="library-dialog" aria-label="作品一覧"></dialog><dialog id="ask-dialog" class="ask-dialog" aria-label="確認"></dialog>
    <input id="file-input" type="file" accept=".mid,.midi,.ttropiano,.json" hidden>`;
    this.ready = this.boot();
  }
  $(selector: string) { return this.root.querySelector<HTMLElement>(selector)!; }
  input(selector: string) { return this.root.querySelector<HTMLInputElement>(selector)!; }
  get selected() { return this.store.project.notes.filter(n => this.roll.selected.has(n.id)); }
  async boot() {
    try {
      const last = this.test ? null : localStorage.getItem('ttropiano-last');
      const row = last ? await this.storage.load(last) : null;
      if (row) { this.session = this.safeSession(row.session, row.project); this.store.replace(row.project); if (row.recovered) this.notify('直前の正常な保存から復元しました。内容を確認してください。'); }
    } catch (error) { this.notify('端末内の作品を開けませんでした。' + (error as Error).message); }
    this.roll = new PianoRoll(this.$('#roll') as HTMLCanvasElement, this.store, () => this.session, {
      changed: () => { this.saveView(); this.drawOverview(); }, audition: (pitch, velocity, held) => this.audition(pitch, velocity, held), release: () => this.release(), seek: tick => { this.transport.seek(tick); this.roll.invalidate(); this.saveView(); }, dismiss: () => this.dismissFloating(), notify: m => this.notify(m),
    });
    this.roll.addEventListener('selection', () => { this.pane = this.roll.selected.size ? 'selection' : null; this.renderPane(); });
    this.roll.onResize = () => this.drawOverview();
    this.store.addEventListener('change', () => {
      const key = JSON.stringify(this.store.project.tempos); this.transport.changed(this.lastTempos !== key); this.lastTempos = key;
      this.renderControls(); this.renderPane(); this.save(); this.drawOverview();
    });
    this.storage.addEventListener('status', () => this.renderSave());
    this.transport.addEventListener('state', () => { this.renderControls(); this.roll.playing = this.transport.playing; this.roll.invalidate(); this.saveView(); });
    this.bind(); this.renderControls(); this.renderSave(); this.drawOverview();
    if (!this.test) {
      document.addEventListener('visibilitychange', () => { if (document.hidden) { this.roll.cancel(); this.transport.pause(); this.save(); } });
      window.addEventListener('pagehide', () => this.save());
      window.addEventListener('beforeunload', e => { if (this.storage.status !== 'saved') { this.save(); e.preventDefault(); } });
      document.addEventListener('keydown', e => this.shortcut(e));
      if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(new URL('sw.js', appRoot), { scope: appRoot.pathname }).then(() => this.offlineStatus()).catch(() => this.notify('オフライン用の準備に失敗しました。接続中は編集できます。'));
    }
    const animate = () => { if (this.destroyed) return; if (this.transport.playing) { this.roll.cursor = this.transport.position(); this.roll.invalidate(); this.renderPosition(); this.drawOverview(); } requestAnimationFrame(animate); }; requestAnimationFrame(animate);
  }
  safeSession(s: Session | undefined, p: Project): Session {
    const d = initialSession(p); if (!s) return d;
    if (s.view && Object.values(s.view).every(Number.isFinite)) d.view = { startTick: clamp(s.view.startTick, 0, 2 ** 30), topPitch: clamp(s.view.topPitch, 0, 127), beatWidth: clamp(s.view.beatWidth, 14, 240), rowHeight: clamp(s.view.rowHeight, 7, 42) };
    if (Number.isFinite(s.cursor)) d.cursor = Math.max(0, Math.round(s.cursor)); if (p.parts.some(x => x.id === s.activePart)) d.activePart = s.activePart;
    if ([0, 120, 240, 320, 480, 960].includes(s.snap)) d.snap = s.snap; if ([120, 240, 320, 480, 960, 1920, 3840].includes(s.noteLength)) d.noteLength = s.noteLength;
    if (s.loop && Number.isSafeInteger(s.loop.start) && Number.isSafeInteger(s.loop.end) && s.loop.start >= 0 && s.loop.end > s.loop.start) d.loop = { ...s.loop, enabled: !!s.loop.enabled }; return d;
  }
  bind() {
    const click = (id: string, fn: () => void | Promise<void>) => this.$('#' + id).addEventListener('click', () => { try { const r = fn(); if (r instanceof Promise) r.catch(e => this.notify(e.message)); } catch (e) { this.notify((e as Error).message); } });
    click('play', () => this.transport.toggle()); click('stop', () => this.transport.stop()); click('undo', () => this.store.undo()); click('redo', () => this.store.redo());
    click('fit', () => this.roll.fit()); click('zoom-in', () => this.roll.zoom(1.25)); click('zoom-out', () => this.roll.zoom(.8));
    click('works', () => this.showLibrary()); click('rename', async () => { const name = await this.ask('作品名', this.store.project.name); if (name) this.store.commit('作品名を変更', p => ({ ...p, name })); });
    click('save-status', () => { if (this.storage.status === 'error') this.storage.retry(); else { this.save(); this.notify('作品はこの端末に自動保存されます。ファイルに残すには「曲の設定」から書き出せます。'); } });
    click('settings', () => this.openFloating('settings')); click('tempo', () => this.openFloating('settings')); click('help', () => this.openFloating('help'));
    click('expression', () => { this.pane = this.pane === 'expression' ? null : 'expression'; this.renderPane(); });
    click('phrase-pane', () => { this.pane = this.pane === 'phrases' ? null : 'phrases'; this.renderPane(); });
    click('loop', () => { if (this.selected.length) this.runAction('loop'); else if (!this.session.loop.enabled) this.openFloating('loop'); else { this.session.loop.enabled = false; this.transport.changed(true); this.renderControls(); this.roll.invalidate(); this.saveView(); } });
    for (const key of ['active-part', 'note-length', 'snap']) this.$('#' + key).addEventListener('change', () => { const value = (this.$('#' + key) as HTMLSelectElement).value; if (key === 'active-part') this.session.activePart = value; if (key === 'note-length') this.session.noteLength = Number(value); if (key === 'snap') this.session.snap = Number(value); this.renderControls(); this.roll.invalidate(); this.saveView(); });
    const mini = this.$('#overview') as HTMLCanvasElement;
    mini.addEventListener('pointerdown', e => { if (this.dismissFloating()) return; const rect = mini.getBoundingClientRect(), tick = clamp((e.clientX - rect.left) / rect.width, 0, 1) * this.overviewEnd(); this.transport.seek(tick); this.session.view.startTick = Math.max(0, tick - (this.roll.width - KEY_WIDTH) / this.roll.view.beatWidth * PPQ / 2); this.roll.invalidate(); this.saveView(); });
    mini.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.transport.seek(Math.max(0, this.session.cursor + (e.key === 'ArrowLeft' ? -1 : 1) * PPQ * 4)); this.roll.invalidate(); this.saveView(); } });
    this.input('#file-input').addEventListener('change', async () => { const file = this.input('#file-input').files?.[0]; if (!file) return; try { await this.loadFile(file); } catch (e) { this.notify((e as Error).message); } this.input('#file-input').value = ''; });
    for (const dialog of this.root.querySelectorAll('dialog')) dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); const x = e as MouseEvent; if (x.clientX < r.left || x.clientX > r.right || x.clientY < r.top || x.clientY > r.bottom) dialog.close(); } });
  }
  save() { if (!this.roll) return; clearTimeout(this.lastSaveTimer); this.storage.save(this.store.project, this.session); if (!this.test) try { localStorage.setItem('ttropiano-last', this.store.project.id); } catch {} }
  saveView() { clearTimeout(this.lastSaveTimer); this.lastSaveTimer = window.setTimeout(() => this.save(), 180); this.renderPosition(); }
  renderSave() { const el = this.$('#save-status'), s = this.storage.status; el.dataset.state = s; el.textContent = s === 'saved' ? 'この端末に保存済み' : s === 'saving' ? '保存中…' : '保存失敗 · 再試行'; el.title = s === 'error' ? this.storage.error : 'この端末への自動保存'; if (s === 'error') this.notify(this.storage.error + ' 「曲の設定」から作品ファイルを書き出せます。', 12000); }
  renderControls() {
    const p = this.store.project; this.$('#project-name').textContent = p.name;
    (this.$('#undo') as HTMLButtonElement).disabled = !this.store.past.length; (this.$('#redo') as HTMLButtonElement).disabled = !this.store.future.length;
    this.$('#undo').title = this.store.past.at(-1) ? '元に戻す：' + this.store.past.at(-1)!.label : '元に戻す'; this.$('#redo').title = this.store.future.at(-1) ? 'やり直す：' + this.store.future.at(-1)!.label : 'やり直す';
    this.$('#play').innerHTML = icon(this.transport.playing || this.transport.preparing ? 'pause' : 'play') + `<span>${this.transport.preparing ? '準備中' : this.transport.playing ? '一時停止' : '再生'}</span>`; this.$('#play').setAttribute('aria-label', this.transport.playing ? '一時停止' : this.transport.preparing ? '再生準備を中止' : '再生'); this.$('#play').title = this.$('#play').getAttribute('aria-label')!; this.$('#play').setAttribute('aria-pressed', String(this.transport.playing));
    const tempo = new TempoMap(p.tempos).atTick(this.session.cursor).bpm, meter = p.meters.findLast(e => e.tick <= this.session.cursor) ?? p.meters[0];
    this.$('#tempo').innerHTML = `<strong>${Math.round(tempo * 100) / 100}</strong><small>BPM · ${meter.numerator}/${meter.denominator}</small>`;
    const select = this.$('#active-part') as HTMLSelectElement;
    select.innerHTML = p.parts.map(part => `<option value="${part.id}">${escape(part.name)}${part.hand === 'left' ? ' · 左手' : part.hand === 'right' ? ' · 右手' : ''}</option>`).join(''); select.value = this.session.activePart;
    this.$('#part-dot').style.backgroundColor = p.parts.find(x => x.id === this.session.activePart)!.color;
    (this.$('#note-length') as HTMLSelectElement).value = String(this.session.noteLength); (this.$('#snap') as HTMLSelectElement).value = String(this.session.snap);
    this.$('#loop').setAttribute('aria-pressed', String(this.session.loop.enabled)); this.$('#expression').setAttribute('aria-expanded', String(this.pane === 'expression')); this.renderPosition();
  }
  renderPosition() { if (!this.roll) return; const tick = this.transport.playing ? this.transport.position() : this.session.cursor; this.$('#position').textContent = `${this.roll.barLabel(tick)}.${Math.floor(tick / PPQ % (this.store.project.meters.findLast(e => e.tick <= tick)?.numerator ?? 4)) + 1}`; }
  async audition(pitch: number, velocity = 80, held = false) {
    const id = ++this.auditionId;
    try { const voice = await this.piano.play(pitch, velocity, held ? 60 : .45); if (held) { if (id !== this.auditionId) voice.cancel(); else this.held = voice; } } catch (e) { this.notify((e as Error).message); }
  }
  release() { this.auditionId++; this.held?.release(); this.held = undefined; }
  notify(message: string, duration = 5000) { clearTimeout(this.toastTimer); const el = this.$('#toast'); el.textContent = message; el.hidden = false; this.toastTimer = window.setTimeout(() => el.hidden = true, duration); }
  dismissFloating() { const el = this.$('#floating'); if (el.matches(':popover-open')) { el.hidePopover(); return true; } return false; }
  openFloating(kind: 'settings' | 'help' | 'loop') {
    const el = this.$('#floating'); if (el.matches(':popover-open') && el.dataset.kind === kind) { el.hidePopover(); return; } if (el.matches(':popover-open')) el.hidePopover(); el.dataset.kind = kind;
    const p = this.store.project, meter = p.meters.findLast(e => e.tick <= this.session.cursor) ?? p.meters[0], tempo = new TempoMap(p.tempos).atTick(this.session.cursor).bpm;
    el.innerHTML = `<div class="pane-heading"><h2>${kind === 'help' ? '音楽に、直接ふれる。' : kind === 'loop' ? '聴きたい範囲' : '曲の設定'}</h2><button data-close aria-label="閉じる">${icon('close')}</button></div>`;
    if (kind === 'help') el.insertAdjacentHTML('beforeend', `<div class="help-copy"><dl><dt>音を置く / 消す</dt><dd>空白 / 音符をタップ。間違えたら ↶ で戻せます。</dd><dt>動かす / 伸ばす</dt><dd>音符をつかむ / 右端を引く。短い音は長押しすると大きな丸いハンドルが現れます。</dd><dt>移動 / 拡大</dt><dd>空白をドラッグ / 2本指で動かす・開閉。音符の上からも操作できます。</dd><dt>まとめて編集</dt><dd>空白を長押しし、そのまま囲みます。音符を長押しすると数値での編集や和音・フレーズ操作もできます。</dd><dt>聴く</dt><dd>鍵盤を押して試聴。目盛りで再生位置を指定。選択して「ループ」でその部分を繰り返します。</dd><dt>キーボード</dt><dd>Space：再生/一時停止 · Ctrl/⌘ Z：Undo · Shift Z：Redo · A：全音選択 · C/V：コピー/貼付 · D：複製。選択後の矢印：移動、Shift＋上下：オクターブ。Delete：削除。未選択の矢印：入力する拍と音高を指定、Enter：音符を追加（初期C4）。</dd><dt>保存とオフライン</dt><dd>作品はこの端末に自動保存。サイトのデータを消すと作品も消えます。「作品ファイル」で外部に残せます。初回は接続して音源を保存してください。</dd></dl><p class="muted">タップ削除の初見での使いやすさ、Android/iPad実機の音声遅延は未検証です。</p></div>`);
    else if (kind === 'loop') {
      el.insertAdjacentHTML('beforeend', `<form id="loop-form" class="field-stack"><label>開始（1拍目から）<input name="start" type="number" min="1" step="0.25" value="${this.session.loop.start / PPQ + 1}" required></label><label>終了（この拍の直前まで）<input name="end" type="number" min="1.25" step="0.25" value="${this.session.loop.end / PPQ + 1}" required></label><button class="primary" type="submit">この範囲をループ</button></form>`);
      el.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.currentTarget as HTMLFormElement), start = Math.round((Number(f.get('start')) - 1) * PPQ), end = Math.round((Number(f.get('end')) - 1) * PPQ); if (end <= start || start < 0) { this.notify('終了を開始より後にしてください。'); return; } this.session.loop = { enabled: true, start, end }; this.transport.changed(true); this.renderControls(); this.roll.invalidate(); this.saveView(); el.hidePopover(); });
    } else {
      el.insertAdjacentHTML('beforeend', `<form id="settings-form" class="field-stack"><div class="form-row"><label>テンポ <small>BPM</small><input name="bpm" type="number" min="10" max="1000" step="0.1" value="${tempo}" required></label><label>拍子<div class="inline"><input name="num" aria-label="拍子の分子" type="number" min="1" max="32" value="${meter.numerator}" required><span>/</span><select name="den" aria-label="拍子の分母">${[1,2,4,8,16,32].map(n => `<option ${n === meter.denominator ? 'selected' : ''}>${n}</option>`).join('')}</select></div></label></div><label class="check-row"><input name="here" type="checkbox">再生位置から変更（曲の途中）</label><button class="primary" type="submit">適用</button></form><div class="section-line"></div><div class="action-grid"><button data-export="midi">${icon('download')} MIDIを書き出す</button><button data-export="project">${icon('download')} 作品ファイル</button><button data-import>ファイルを読み込む</button><button data-demo>作例を開く</button></div><p class="muted small">MIDI：音符・強弱・テンポ・拍子・ペダル。フレーズと別案は作品ファイルに保存。</p><p id="offline-status" class="muted small">ピアノ：Splendid Grand（2段階サンプル）</p><a class="small muted" href="./piano/LICENSE.txt" target="_blank" rel="noopener">音源のライセンス</a><details class="event-details"><summary>テンポ・拍子の変更点</summary><div id="time-events"></div></details>`);
      el.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.currentTarget as HTMLFormElement), bpm = Number(f.get('bpm')), numerator = Number(f.get('num')), denominator = Number(f.get('den')), tick = f.has('here') ? Math.round(this.session.cursor) : 0; try { this.store.commit('テンポ・拍子を変更', p => ({ ...p, tempos: setEvent(p.tempos, { tick, bpm }), meters: setEvent(p.meters, { tick, numerator, denominator }) })); el.hidePopover(); } catch (error) { this.notify((error as Error).message); } });
      el.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(b => b.onclick = () => b.dataset.export === 'midi' ? this.downloadMidi() : this.downloadProject());
      el.querySelector<HTMLButtonElement>('[data-import]')!.onclick = () => { el.hidePopover(); this.input('#file-input').click(); };
      el.querySelector<HTMLButtonElement>('[data-demo]')!.onclick = () => { el.hidePopover(); void this.openProject(exampleProject(), true).catch(e => this.notify(e.message)); };
      const events = el.querySelector('#time-events')!; events.innerHTML = [...p.tempos.map(t => `<div>第 ${(t.tick / PPQ + 1).toFixed(2)} 拍 · ${Math.round(t.bpm * 100) / 100} BPM ${t.tick ? `<button data-del-tempo="${t.tick}" aria-label="このテンポ変更を削除">×</button>` : ''}</div>`), ...p.meters.map(m => `<div>第 ${(m.tick / PPQ + 1).toFixed(2)} 拍 · ${m.numerator}/${m.denominator} ${m.tick ? `<button data-del-meter="${m.tick}" aria-label="この拍子変更を削除">×</button>` : ''}</div>`)].join('');
      events.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => { const tempo = b.dataset.delTempo; this.store.commit('変更点を削除', p => tempo ? { ...p, tempos: p.tempos.filter(t => t.tick !== Number(tempo)) } : { ...p, meters: p.meters.filter(m => m.tick !== Number(b.dataset.delMeter)) }); el.hidePopover(); });
    }
    el.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => el.hidePopover(); el.showPopover();
  }
  overviewEnd() { return Math.max(endTick(this.store.project), this.session.loop.enabled ? this.session.loop.end : 0, this.session.view.startTick + (this.roll?.width ?? 800) / this.session.view.beatWidth * PPQ); }
  drawOverview() {
    if (!this.roll) return; const canvas = this.$('#overview') as HTMLCanvasElement, rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
    const c = canvas.getContext('2d')!, w = rect.width, h = rect.height, p = this.store.project, end = this.overviewEnd(); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = '#f0edf6'; c.fillRect(0, 0, w, h); if (p.notes.length) { const b = bounds(p.notes); const range = Math.max(24, b.high - b.low + 3), colors = new Map(p.parts.map(x => [x.id, x.color])); for (const n of p.notes) { c.fillStyle = colors.get(n.partId)!; c.globalAlpha = .65; c.fillRect(n.startTick / end * w, h - 4 - (n.pitch - b.low) / range * (h - 8), Math.max(2, n.durationTick / end * w), 2); } c.globalAlpha = 1; }
    const from = this.session.view.startTick / end * w, to = this.roll.tickAt(this.roll.width) / end * w; c.strokeStyle = '#9b87be'; c.fillStyle = '#b9a6d518'; c.fillRect(from, 1, to - from, h - 2); c.strokeRect(from + .5, 1.5, Math.min(w - from - 1, to - from), h - 3); const x = (this.transport.playing ? this.transport.position() : this.session.cursor) / end * w; c.fillStyle = '#7755bd'; c.fillRect(x, 0, 2, h);
  }
  renderPane() {
    const pane = this.$('#inspector'); if (!this.pane) { pane.hidden = true; return; } pane.hidden = false;
    const p = this.store.project, notes = this.selected, first = notes[0];
    if (this.pane === 'selection' && !notes.length) { this.pane = null; pane.hidden = true; return; }
    pane.innerHTML = `<div class="pane-heading"><h2>${this.pane === 'selection' ? notes.length + '音を選択' : this.pane === 'expression' ? '演奏の表情' : 'フレーズ'}</h2><button data-pane-close aria-label="パネルを閉じる">${icon('close')}</button></div><div class="pane-content"></div>`;
    pane.querySelector<HTMLButtonElement>('[data-pane-close]')!.onclick = () => { this.pane = null; this.renderPane(); this.roll.canvas.focus(); };
    const content = pane.querySelector('.pane-content')!;
    if (this.pane === 'selection' && first) {
      const b = bounds(notes), phrase = this.currentPhrase();
      content.innerHTML = `<div class="selection-actions"><button data-action="listen">${icon('play', 16)}聴く</button><button data-action="duplicate">${icon('copy', 16)}複製</button><button data-action="delete">${icon('trash', 16)}削除</button></div><form id="precision-form" class="field-stack"><div class="form-row"><label>音高 <small>MIDI</small><input name="pitch" type="number" min="0" max="127" value="${first.pitch}" required></label><label>開始 <small>拍目</small><input name="start" type="number" min="1" step="any" value="${b.start / PPQ + 1}" required></label></div><div class="form-row"><label>長さ <small>各音・拍</small><input name="length" type="number" min="${1 / PPQ}" step="any" value="${first.durationTick / PPQ}" required></label><label>強弱 <small>1–127</small><input name="velocity" type="number" min="1" max="127" value="${first.velocity}" required></label></div><label>声部<select name="part">${p.parts.map(x => `<option value="${x.id}" ${x.id === first.partId ? 'selected' : ''}>${escape(x.name)}</option>`).join('')}</select></label><button type="submit" class="apply-button">数値を適用</button></form><div class="nudge-grid"><button data-move="0,1" aria-label="半音上げる">↑ 半音</button><button data-move="0,-1" aria-label="半音下げる">↓ 半音</button><button data-move="-${this.session.snap || 1},0">← 移動</button><button data-move="${this.session.snap || 1},0">移動 →</button></div><details><summary>和音・フレーズ</summary><div class="action-grid"><button data-action="chord">同時に鳴る和音を選択</button><button data-action="group">フレーズにする</button><button data-action="invert-up">転回 ↑</button><button data-action="invert-down">転回 ↓</button><button data-action="stretch-half">長さ ½</button><button data-action="stretch-double">長さ ×2</button><button data-action="copy">コピー</button><button data-action="paste">再生位置に貼付</button><button data-action="insert">再生位置に挿入</button><button data-action="loop">選択範囲をループ</button><button data-action="pedal">範囲にペダル</button></div></details>${phrase ? this.phraseHTML(phrase) : ''}`;
      const form = content.querySelector('form')!; form.addEventListener('submit', e => { e.preventDefault(); const data = new FormData(form), deltaPitch = Number(data.get('pitch')) - first.pitch, deltaTick = Math.round((Number(data.get('start')) - 1) * PPQ) - b.start, length = Math.round(Number(data.get('length')) * PPQ), velocity = Number(data.get('velocity')), partId = String(data.get('part')); try { this.store.update(this.roll.selected, '音符の詳細を変更', n => ({ ...n, pitch: n.pitch + deltaPitch, startTick: n.startTick + deltaTick, durationTick: length, velocity, partId })); } catch (error) { this.notify((error as Error).message); } });
      content.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => button.onclick = () => { const [t, pitch] = button.dataset.move!.split(',').map(Number); this.action(() => this.store.move(this.roll.selected, t, pitch)); });
    } else if (this.pane === 'expression') {
      const part = p.parts.find(x => x.id === this.session.activePart)!;
      content.innerHTML = `<p class="muted small">${notes.length ? `${notes.length}音の強弱` : `「${escape(part.name)}」全音の強弱`}。音符を選ぶと対象を絞れます。</p><form id="velocity-form"><label>強弱 <output id="velocity-output">${first?.velocity ?? 80}</output><input name="velocity" type="range" min="1" max="127" value="${first?.velocity ?? 80}"></label><button type="submit" class="apply-button">強弱を適用</button></form><div class="section-line"></div><h3>サステインペダル</h3><div class="action-grid"><button data-action="pedal-on">ここで踏む</button><button data-action="pedal-off">ここで離す</button>${notes.length ? '<button data-action="pedal">選択範囲にペダル</button>' : ''}</div><p class="muted small">再生位置に追加。ペダルは全声部に作用します。</p><div class="pedal-list">${p.pedals.toSorted((a,b) => a.tick - b.tick).slice(0, 60).map(e => `<div><span>第 ${(e.tick / PPQ + 1).toFixed(2)} 拍 · ${e.value >= 64 ? '踏む' : '離す'}${e.partId ? ' · 声部別' : ''}</span><button data-pedal-delete="${e.id}" aria-label="このペダル指示を削除">×</button></div>`).join('') || '<p class="muted small">ペダル指示はまだありません。</p>'}</div><div class="section-line"></div><h3>声部と左右の手</h3><form id="part-form" class="field-stack"><label>声部名<input name="name" value="${escape(part.name)}" maxlength="80" required></label><label>手<select name="hand"><option value="unspecified" ${part.hand === 'unspecified' ? 'selected' : ''}>未指定</option><option value="right" ${part.hand === 'right' ? 'selected' : ''}>右手</option><option value="left" ${part.hand === 'left' ? 'selected' : ''}>左手</option></select></label><div class="inline"><label class="check-row"><input name="mute" type="checkbox" ${part.mute ? 'checked' : ''}>ミュート</label><label class="check-row"><input name="solo" type="checkbox" ${part.solo ? 'checked' : ''}>ソロ</label></div><button class="apply-button" type="submit">声部を更新</button></form>${p.parts.length < 16 ? '<button data-action="add-part">声部を追加</button>' : ''}`;
      const slider = content.querySelector<HTMLInputElement>('[name=velocity]')!; slider.oninput = () => content.querySelector('output')!.textContent = slider.value;
      content.querySelector('#velocity-form')!.addEventListener('submit', e => { e.preventDefault(); const ids = this.roll.selected.size ? this.roll.selected : new Set(p.notes.filter(n => n.partId === part.id).map(n => n.id)); this.action(() => this.store.update(ids, '強弱を変更', n => ({ ...n, velocity: Number(slider.value) }))); });
      content.querySelector('#part-form')!.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.currentTarget as HTMLFormElement); this.action(() => this.store.commit('声部を変更', p => ({ ...p, parts: p.parts.map(x => x.id === part.id ? { ...x, name: String(f.get('name')).trim(), hand: String(f.get('hand')) as any, mute: f.has('mute'), solo: f.has('solo') } : x) }))); });
      content.querySelectorAll<HTMLButtonElement>('[data-pedal-delete]').forEach(b => b.onclick = () => this.action(() => this.store.commit('ペダル指示を削除', p => ({ ...p, pedals: p.pedals.filter(e => e.id !== b.dataset.pedalDelete) }))));
    } else {
      content.innerHTML = `<p class="muted small">音符を囲んで選択し「フレーズにする」。小節をまたいでまとめ、元の案を残して試せます。</p>${p.phrases.map(f => `<section class="phrase-card"><button data-select-phrase="${f.id}" class="phrase-name">${escape(f.name)} <small>${f.noteIds.length}音</small></button>${this.phraseHTML(f)}</section>`).join('') || '<div class="empty-small">フレーズはまだありません。</div>'}<button data-action="select-all">曲の全音を選択</button>`;
    }
    content.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b => b.onclick = () => this.runAction(b.dataset.action!));
    content.querySelectorAll<HTMLButtonElement>('[data-select-phrase]').forEach(b => b.onclick = () => { const f = p.phrases.find(f => f.id === b.dataset.selectPhrase)!; this.roll.select(new Set(f.noteIds)); this.roll.fit(this.selected); });
    content.querySelectorAll<HTMLButtonElement>('[data-variant-listen]').forEach(b => b.onclick = () => { const f = p.phrases.find(f => f.id === b.dataset.phrase)!, v = f.variants.find(v => v.id === b.dataset.variantListen)!; void this.listen(v.notes); });
    content.querySelectorAll<HTMLButtonElement>('[data-variant-apply]').forEach(b => b.onclick = () => this.action(() => { const ids = this.store.applyVariant(b.dataset.phrase!, b.dataset.variantApply!); this.roll.select(new Set(ids)); }));
    content.querySelectorAll<HTMLButtonElement>('[data-variant-save]').forEach(b => b.onclick = async () => { const name = await this.ask('別案の名前', '新しい案'); if (name) this.action(() => this.store.saveVariant(b.dataset.variantSave!, name)); });
  }
  phraseHTML(f: Phrase) { return `<div class="variants"><h3>${escape(f.name)} · 別案</h3>${f.variants.map(v => `<div class="variant-row"><span>${escape(v.name)}</span><button data-variant-listen="${v.id}" data-phrase="${f.id}" aria-label="${escape(v.name)}を試聴">${icon('play', 14)}</button><button data-variant-apply="${v.id}" data-phrase="${f.id}">使う</button></div>`).join('')}<button data-variant-save="${f.id}" class="apply-button">今の形を別案として保存</button></div>`; }
  currentPhrase() { return this.store.project.phrases.find(f => f.noteIds.length && f.noteIds.length === this.roll.selected.size && f.noteIds.every(id => this.roll.selected.has(id))); }
  action(fn: () => unknown) { try { fn(); } catch (e) { this.notify((e as Error).message); } }
  clipboard: Note[] = [];
  runAction(action: string) {
    this.action(() => {
      const ids = new Set(this.roll.selected), notes = this.selected;
      if (action === 'listen') void this.listen(notes);
      if (action === 'delete') { this.store.delete(ids); this.roll.select(new Set()); }
      if (action === 'duplicate' || action === 'insert') this.roll.select(new Set(this.store.duplicate(ids, action === 'insert' ? this.session.cursor : undefined, action === 'insert')));
      if (action === 'copy') { this.clipboard = structuredClone(notes); this.notify(`${notes.length}音をコピーしました。再生位置に貼り付けられます。`); }
      if (action === 'paste') this.paste();
      if (action === 'chord' && notes.length) { const tick = notes[0].startTick; this.roll.select(new Set(this.store.project.notes.filter(n => n.startTick <= tick && n.startTick + n.durationTick > tick).map(n => n.id))); }
      if (action === 'invert-up' || action === 'invert-down') this.store.invert(ids, action === 'invert-up' ? 1 : -1);
      if (action === 'stretch-half' || action === 'stretch-double') this.store.stretch(ids, action === 'stretch-half' ? .5 : 2);
      if (action === 'select-all') this.roll.select(new Set(this.store.project.notes.map(n => n.id)));
      if (action === 'group') void this.ask('フレーズ名', `フレーズ ${this.store.project.phrases.length + 1}`).then(name => { if (name) this.action(() => this.store.group(ids, name)); });
      if (action === 'loop' && notes.length) { const b = bounds(notes); this.session.loop = { enabled: true, start: b.start, end: b.end }; this.transport.changed(true); this.renderControls(); this.roll.invalidate(); this.saveView(); }
      if (action === 'pedal-on' || action === 'pedal-off' || action === 'pedal') {
        const events = action === 'pedal' && notes.length ? [{ id: uid(), tick: bounds(notes).start, value: 127 }, { id: uid(), tick: bounds(notes).end, value: 0 }] : [{ id: uid(), tick: Math.round(this.session.cursor), value: action === 'pedal-on' ? 127 : 0 }];
        this.store.commit('ペダルを追加', p => ({ ...p, pedals: [...p.pedals.filter(e => e.partId || !events.some(x => x.tick === e.tick)), ...events].sort((a,b) => a.tick - b.tick) }));
      }
      if (action === 'add-part') void this.ask('声部の名前', '新しい声部').then(name => { if (name) this.action(() => { const id = uid(); this.session.activePart = id; this.store.commit('声部を追加', p => ({ ...p, parts: [...p.parts, { id, name, role: 'other', hand: 'unspecified', color: '#b05078', mute: false, solo: false }] })); }); });
    });
  }
  async listen(notes: Note[]) {
    if (!notes.length) return; this.transport.pause(); const id = ++this.auditionId;
    try { await this.piano.prepare(notes); if (id !== this.auditionId) return; const map = new TempoMap(this.store.project.tempos), start = bounds(notes).start, seconds = map.seconds(start), now = this.piano.context!.currentTime + .03;
      for (const n of notes) void this.piano.play(n.pitch, n.velocity, Math.min(15, map.seconds(n.startTick + n.durationTick) - map.seconds(n.startTick)), now + map.seconds(n.startTick) - seconds); }
    catch (e) { this.notify((e as Error).message); }
  }
  paste() { if (!this.clipboard.length) { this.notify('先に音符を選んでコピーしてください。'); return; } const b = bounds(this.clipboard), valid = new Set(this.store.project.parts.map(x => x.id)); const notes = this.clipboard.map(n => ({ ...n, id: uid(), startTick: n.startTick - b.start + Math.round(this.session.cursor), partId: valid.has(n.partId) ? n.partId : this.session.activePart })); this.store.insert(notes); this.roll.select(new Set(notes.map(n => n.id))); }
  shortcut(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input,select,textarea,dialog,[popover]:popover-open')) return;
    if (e.code === 'Space') { e.preventDefault(); void this.transport.toggle(); return; }
    const mod = e.ctrlKey || e.metaKey; if (!mod) return;
    const key = e.key.toLowerCase();
    if (['z','y','a','c','v','d','s'].includes(key)) e.preventDefault();
    if (key === 'z') e.shiftKey ? this.store.redo() : this.store.undo(); if (key === 'y') this.store.redo();
    if (key === 'a') this.roll.select(new Set(this.store.project.notes.map(n => n.id))); if (key === 'c') this.runAction('copy'); if (key === 'v') this.action(() => this.paste()); if (key === 'd') this.runAction('duplicate'); if (key === 's') { this.save(); this.downloadProject(); }
  }
  async ask(title: string, value = '', confirm = false): Promise<string | null> {
    const dialog = this.$('#ask-dialog') as HTMLDialogElement;
    if (dialog.open) return null;
    dialog.innerHTML = `<form method="dialog" class="field-stack"><h2>${escape(title)}</h2>${confirm ? `<p>${escape(value)}</p>` : `<input name="value" aria-label="${escape(title)}" value="${escape(value)}" maxlength="100" required>`}<div class="dialog-actions"><button value="cancel" formnovalidate ${confirm ? 'autofocus' : ''}>キャンセル</button><button value="ok" class="${confirm ? 'danger' : 'primary'}">${confirm ? '削除する' : '保存'}</button></div></form>`;
    return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? confirm ? 'ok' : (dialog.querySelector('input')!.value.trim() || null) : null), { once: true }); dialog.returnValue = ''; dialog.showModal(); if (!confirm) { const input = dialog.querySelector('input')!; input.focus(); input.select(); } });
  }
  async openProject(p: Project, fit = false, session?: Session) {
    validateProject(p); this.transport.pause(); this.release(); this.save(); await this.storage.flush();
    this.session = this.safeSession(session, p); this.pane = null; this.roll.select(new Set(), false); this.store.replace(p); this.renderPane(); if (fit) requestAnimationFrame(() => this.roll.fit()); this.save();
  }
  async showLibrary() {
    this.transport.pause(); this.save(); await this.storage.flush(); const dialog = this.$('#library-dialog') as HTMLDialogElement;
    if (dialog.open) { dialog.close(); return; }
    const works = await this.storage.list();
    dialog.innerHTML = `<div class="library-header"><div><small>YOUR PIANO, YOUR IDEAS</small><h1>作品</h1></div><button data-close aria-label="作品一覧を閉じる">${icon('close')}</button></div><div class="library-actions"><button class="primary" data-new>＋ 新しい曲</button><button data-import>ファイルを読み込む</button><button data-demo>作例を試す</button></div><div class="works-grid">${works.map(w => `<article class="work-card"><button class="work-open" data-open="${w.id}"><canvas data-thumbnail="${w.id}" width="500" height="160" aria-hidden="true"></canvas><strong>${escape(w.name)}</strong><small>${w.notes}音 · ${new Date(w.updatedAt).toLocaleString('ja-JP')}</small></button><div class="work-actions"><button data-rename="${w.id}">名前変更</button><button data-copy="${w.id}">複製</button><button data-delete="${w.id}" aria-label="${escape(w.name)}を削除">${icon('trash',16)}</button></div></article>`).join('')}</div><p class="muted small">この端末に保存されています。別の端末へ移すには作品ファイルを書き出してください。</p>`;
    const refresh = async () => { dialog.close(); await this.showLibrary(); };
    dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => dialog.close();
    dialog.querySelector<HTMLButtonElement>('[data-new]')!.onclick = async () => { dialog.close(); await this.openProject(newProject()); };
    dialog.querySelector<HTMLButtonElement>('[data-demo]')!.onclick = async () => { dialog.close(); await this.openProject(exampleProject(), true); };
    dialog.querySelector<HTMLButtonElement>('[data-import]')!.onclick = () => { dialog.close(); this.input('#file-input').click(); };
    for (const w of works) {
      const c = dialog.querySelector<HTMLCanvasElement>(`[data-thumbnail="${w.id}"]`)!.getContext('2d')!; c.fillStyle = '#f4f1f9'; c.fillRect(0,0,500,160); if (w.preview.length) { const b = bounds(w.preview), span = Math.max(b.end, PPQ * 16); for (const n of w.preview) { c.fillStyle = '#9475bf'; c.fillRect(16 + n.startTick / span * 468, 140 - (n.pitch - b.low) / Math.max(24,b.high-b.low+3) * 120, Math.max(3,n.durationTick/span*468),5); } }
    }
    dialog.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b => b.onclick = async () => { try { const row = await this.storage.load(b.dataset.open!); if (row) { dialog.close(); await this.openProject(row.project, false, row.session); } } catch(e) { this.notify((e as Error).message); } });
    dialog.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(b => b.onclick = async () => { try { const row = await this.storage.load(b.dataset.copy!); if (row) { const copy = { ...row.project, id: uid(), name: row.project.name.slice(0, 90) + ' のコピー', revision: 0, updatedAt: new Date().toISOString() }; this.storage.save(copy, row.session); await this.storage.flush(); await refresh(); } } catch(e) { this.notify((e as Error).message); } });
    dialog.querySelectorAll<HTMLButtonElement>('[data-rename]').forEach(b => b.onclick = async () => { const row = await this.storage.load(b.dataset.rename!); if (!row) return; const name = await this.ask('作品名', row.project.name); if (!name) return; if (row.project.id === this.store.project.id) this.store.commit('作品名を変更', p => ({ ...p, name })); else this.storage.save({ ...row.project, name, revision: row.project.revision + 1, updatedAt: new Date().toISOString() }, row.session); await this.storage.flush(); await refresh(); });
    dialog.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(b => b.onclick = async () => { const w = works.find(w => w.id === b.dataset.delete)!; if (!await this.ask('作品を削除しますか？', `「${w.name}」をこの端末から削除します。元に戻せません。`, true)) return; try { await this.storage.delete(w.id); if (w.id === this.store.project.id) { const p = newProject(); this.session = initialSession(p); this.store.replace(p); this.roll.fit(); } await refresh(); } catch (e) { this.notify((e as Error).message); } });
    dialog.showModal();
  }
  async loadFile(file: File) {
    if (file.size > 20000000) throw Error('読み込めるファイルは20MBまでです。');
    if (/\.mid[i]?$/i.test(file.name)) { const { project, warnings } = importMidi(new Uint8Array(await file.arrayBuffer()), file.name); await this.openProject(project, true); if (warnings.length) this.notify(warnings.join(' '), 12000); }
    else { const data = JSON.parse(await file.text()), project = data.project ?? data; validateProject(project); const p = { ...project, id: uid(), updatedAt: new Date().toISOString() }; await this.openProject(p, false, data.session); }
  }
  download(data: BlobPart, type: string, suffix: string) { const url = URL.createObjectURL(new Blob([data], { type })), a = document.createElement('a'); a.href = url; a.hidden = true; document.body.append(a); a.download = this.store.project.name.replace(/[\\/:*?"<>|]/g, '_') + suffix; a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 5000); }
  downloadMidi() { this.download(exportMidi(this.store.project) as unknown as BlobPart, 'audio/midi', '.mid'); }
  downloadProject() { this.download(JSON.stringify({ format: 'TtroPiano', project: this.store.project, session: this.session }), 'application/json', '.ttropiano'); }
  async offlineStatus() { const registration = await navigator.serviceWorker.ready; const worker = registration.active; if (!worker) return; const channel = new MessageChannel(); channel.port1.onmessage = e => { if (e.data.ready) this.notify('オフラインの準備ができました。ピアノ音源もこの端末に保存済みです。'); }; worker.postMessage({ type: 'offline-status' }, [channel.port2]); }
}
const root = document.querySelector<HTMLElement>('#app');
if (root) { const app = new App(root, new URLSearchParams(location.search).has('__qa_layout')); void app.ready.catch(e => { root.textContent = '起動できませんでした：' + e.message; }); }
