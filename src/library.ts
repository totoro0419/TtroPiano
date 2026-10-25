import { bounds, exampleProject, newProject, PPQ, uid, type Project, type Session } from './model';
import type { Persistence, Work } from './persistence';
import { icon } from './icons';

interface LibraryActions {
  current(): Project;
  prepare(): Promise<void>;
  open(project: Project, fit: boolean, session?: Session, wanted?: () => boolean, activate?: boolean): Promise<boolean>;
  ask(title: string, value: string, confirm?: boolean): Promise<string | null>;
  rename(name: string): void;
  import(): void;
  focus(editor: boolean): void;
}
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function drawWorkThumbnail(canvas: HTMLCanvasElement, notes: Work['preview']) {
  const c = canvas.getContext('2d')!; c.fillStyle = '#f4f1f9'; c.fillRect(0,0,500,160); if (!notes.length) return;
  const b = bounds(notes), span = Math.max(b.end,PPQ*16); c.fillStyle = '#9475bf';
  for (const n of notes) c.fillRect(16+n.startTick/span*468,140-(n.pitch-b.low)/Math.max(24,b.high-b.low+3)*120,Math.max(3,n.durationTick/span*468),5);
}

/** Keep one modal and its controls mounted while storage work and card updates run. */
export class WorkLibrary {
  rows: Work[] = [];
  generation = 0;
  busy = false;
  query = '';
  sort = 'updated';
  constructor(public dialog: HTMLDialogElement, private storage: Persistence, private actions: LibraryActions) {
    dialog.innerHTML = `<div class="library-header"><div><small>TtroPiano</small><h1>作品</h1></div><button data-close aria-label="作品一覧を閉じる">${icon('close')}</button></div><div class="library-actions"><button class="primary" data-new>${icon('add',18)} 新しい曲</button><button data-import>${icon('upload',18)} ファイルを読み込む</button><button data-demo>作例を試す</button></div><div class="library-tools"><label class="work-search"><span>作品を検索</span><input id="work-search" type="search" placeholder="作品名で検索" autocomplete="off"></label><label class="work-sort"><span>並び順</span><select id="work-sort"><option value="updated">更新が新しい順</option><option value="name">作品名の順</option></select></label></div><div id="library-status" class="library-status" role="status"></div><div class="works-grid"></div><div class="library-empty" hidden><strong>作品が見つかりません</strong><p>検索する名前を変えてみてください。</p><button data-clear>検索をクリア</button></div><div class="library-error" hidden><p></p><button data-retry>もう一度読み込む</button></div><p class="library-storage">この端末に自動保存。別の端末へ移すときは、メニューから作品ファイルを保存できます。</p>`;
    dialog.querySelector<HTMLInputElement>('#work-search')!.oninput = event => { this.query = (event.target as HTMLInputElement).value; this.renderRows(); };
    dialog.querySelector<HTMLSelectElement>('#work-sort')!.onchange = event => { this.sort = (event.target as HTMLSelectElement).value; this.renderRows(); };
    dialog.addEventListener('click', event => { const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (button) void this.command(button); });
    dialog.addEventListener('close', () => { this.generation++; this.setBusy(false); this.actions.focus(dialog.returnValue === 'editor'); });
  }
  get grid() { return this.dialog.querySelector<HTMLElement>('.works-grid')!; }
  get status() { return this.dialog.querySelector<HTMLElement>('#library-status')!; }
  async show() {
    if (this.dialog.open) { this.dialog.close(); return; }
    const generation = ++this.generation; this.dialog.returnValue = ''; this.dialog.showModal(); this.status.textContent = '作品を読み込んでいます…'; this.setBusy(true);
    try { await this.actions.prepare(); if (!this.wanted(generation)) return; await this.refresh(generation); }
    catch (error) { if (this.wanted(generation)) this.fail(error); }
    finally { if (this.wanted(generation)) this.setBusy(false); }
  }
  wanted(generation: number) { return this.dialog.open && this.generation === generation; }
  setBusy(value: boolean) {
    this.busy = value; this.dialog.setAttribute('aria-busy', String(value));
    this.dialog.querySelectorAll<HTMLButtonElement>('button:not([data-close]):not([data-retry])').forEach(button => button.disabled = value);
  }
  fail(error: unknown) {
    const box = this.dialog.querySelector<HTMLElement>('.library-error')!; box.hidden = false; box.querySelector('p')!.textContent = `作品を更新できませんでした。${error instanceof Error ? error.message : String(error)}`;
    this.status.textContent = '読み込みに失敗しました。表示中の作品はそのままです。';
  }
  async refresh(generation: number, focus?: { id: string; action: string }) {
    const rows = await this.storage.list(); if (!this.wanted(generation)) return;
    this.rows = rows; this.dialog.querySelector<HTMLElement>('.library-error')!.hidden = true; this.renderRows();
    if (focus) {
      this.setBusy(false);
      const card = [...this.grid.querySelectorAll<HTMLElement>('.work-card')].find(card => card.dataset.work === focus.id);
      (card?.querySelector<HTMLButtonElement>(`[data-${focus.action}]`) ?? this.dialog.querySelector<HTMLButtonElement>('[data-new]'))?.focus();
    }
  }
  renderRows() {
    const grid = this.grid, scroll = grid.scrollTop, term = this.query.trim().toLocaleLowerCase('ja-JP');
    const rows = this.rows.filter(row => row.name.toLocaleLowerCase('ja-JP').includes(term)).toSorted((a,b) => this.sort === 'name' ? a.name.localeCompare(b.name,'ja') : b.updatedAt.localeCompare(a.updatedAt));
    const existing = new Map([...grid.querySelectorAll<HTMLElement>('.work-card')].map(card => [card.dataset.work!,card]));
    const visible = new Set(rows.map(row => row.id)); for (const [id, card] of existing) if (!visible.has(id)) card.remove();
    rows.forEach((row, index) => {
      let card = existing.get(row.id);
      if (!card) { card = document.createElement('article'); card.className = 'work-card'; card.dataset.work = row.id; card.innerHTML = `<button class="work-open" data-open="${escape(row.id)}"><canvas width="500" height="160" aria-hidden="true"></canvas><span class="work-meta"><span class="work-current">編集中</span><strong></strong><small></small></span></button><div class="work-actions"><button data-rename="${escape(row.id)}">名前変更</button><button data-copy="${escape(row.id)}">複製</button><button data-delete="${escape(row.id)}">${icon('trash',16)}</button></div>`; }
      const current = row.id === this.actions.current().id; card.dataset.current = String(current);
      card.querySelector('strong')!.textContent = row.name; card.querySelector('small')!.textContent = `${row.notes}音 · ${new Date(row.updatedAt).toLocaleString('ja-JP')}`;
      const opener = card.querySelector<HTMLButtonElement>('[data-open]')!; if (current) opener.setAttribute('aria-current','true'); else opener.removeAttribute('aria-current');
      card.querySelector('[data-delete]')!.setAttribute('aria-label',`${row.name}を削除`);
      if (grid.children[index] !== card) grid.insertBefore(card,grid.children[index] ?? null);
      if (card.dataset.stamp !== row.updatedAt) { this.thumbnail(card.querySelector('canvas')!,row.preview); card.dataset.stamp = row.updatedAt; }
    });
    grid.scrollTop = scroll; if (this.busy) this.setBusy(true); this.dialog.querySelector<HTMLElement>('.library-empty')!.hidden = rows.length > 0;
    this.status.textContent = term ? `${this.rows.length}作品中 ${rows.length}作品` : `${rows.length}作品`;
  }
  thumbnail(canvas: HTMLCanvasElement, notes: Work['preview']) {
    drawWorkThumbnail(canvas,notes);
  }
  async command(button: HTMLButtonElement) {
    const data = button.dataset;
    if ('close' in data) { this.dialog.close(); return; }
    if ('clear' in data) { this.query = ''; this.dialog.querySelector<HTMLInputElement>('#work-search')!.value = ''; this.renderRows(); this.dialog.querySelector<HTMLInputElement>('#work-search')!.focus(); return; }
    if (this.busy) return;
    if ('import' in data) { this.dialog.close('editor'); this.actions.import(); return; }
    const generation = this.generation; this.setBusy(true);
    const wanted = () => this.wanted(generation);
    try {
      if ('retry' in data) { this.storage.retry(); await this.actions.prepare(); await this.refresh(generation); }
      else if ('new' in data || 'demo' in data) { if (await this.actions.open('demo' in data ? exampleProject() : newProject(), 'demo' in data, undefined, wanted) && wanted()) this.dialog.close('editor'); }
      else if (data.open) { this.status.textContent = '作品を開いています…'; const row = await this.storage.load(data.open); if (!wanted()) return; if (!row) throw Error('この作品は見つかりません。もう一度一覧を読み込んでください。'); if (await this.actions.open(row.project,false,row.session,wanted) && wanted()) this.dialog.close('editor'); }
      else if (data.copy) { const row = await this.storage.load(data.copy); if (!wanted()) return; if (!row) throw Error('複製する作品が見つかりません。'); const copy = {...row.project,id:uid(),name:row.project.name.slice(0,90)+' のコピー',revision:0,updatedAt:new Date().toISOString()}; this.storage.save(copy,row.session); await this.storage.flush(); await this.refresh(generation,{id:copy.id,action:'open'}); }
      else if (data.rename) { const row = await this.storage.load(data.rename); if (!wanted() || !row) return; const name = await this.actions.ask('作品名',row.project.name); if (!wanted() || !name) return; if (row.project.id === this.actions.current().id) this.actions.rename(name); else this.storage.save({...row.project,name,revision:row.project.revision+1,updatedAt:new Date().toISOString()},row.session); await this.storage.flush(); await this.refresh(generation,{id:row.project.id,action:'rename'}); }
      else if (data.delete) { const row = this.rows.find(row => row.id === data.delete); if (!row) return; if (!await this.actions.ask('作品を削除しますか？',`「${row.name}」をこの端末から削除します。元に戻せません。`,true) || !wanted()) return; if (row.id === this.actions.current().id && !await this.actions.open(newProject(),false,undefined,wanted,false)) return; await this.storage.delete(row.id); await this.refresh(generation,{id:this.actions.current().id,action:'open'}); }
    } catch (error) { if (wanted()) this.fail(error); }
    finally { if (wanted()) this.setBusy(false); }
  }
}
