import { icon } from './icons';
import type { Project } from './model';
import type { Work } from './persistence';
import { drawWorkThumbnail } from './library';

export type HomeCommand = 'start' | 'new' | 'works' | 'import' | 'demo' | 'help' | 'install';
interface HomeActions { command(action: HomeCommand): void | Promise<void>; open(id: string): Promise<void>; list(): Promise<Work[]> }

/** A normal start page, not an automatically opened command popover. */
export class StartScreen {
  ready = false;
  busy = false;
  generation = 0;
  constructor(public root: HTMLElement, private actions: HomeActions) {
    root.innerHTML = `<header class="home-header"><div class="home-brand"><span class="home-logo">${icon('piano',24)}</span><strong>TtroPiano</strong></div><div class="home-header-actions"><button id="home-install" class="home-install" data-home="install">${icon('download',16)}<span>インストール</span></button><span id="home-installed" hidden>アプリとして利用中</span><button data-home="help" aria-label="操作のヒント">${icon('help',19)}</button></div></header><div class="home-content"><section class="home-intro" aria-labelledby="home-title"><span class="home-eyebrow">PIANO COMPOSER</span><h1 id="home-title">音から、曲へ。</h1><p>思いついたメロディーを、ここから。</p></section><section class="home-start" aria-label="作曲をはじめる"><button id="home-start" data-home="start" class="home-primary" disabled><span class="home-start-icon">${icon('piano',26)}</span><span><strong id="home-start-title">準備しています…</strong><small id="home-current"></small></span><span class="home-start-arrow" aria-hidden="true">→</span></button><div class="home-shortcuts"><button id="home-new" data-home="new" disabled>${icon('add',21)}<span>新しい曲</span></button><button id="home-works" data-home="works" disabled>${icon('folder',21)}<span>作品一覧</span></button><button data-home="import" disabled>${icon('upload',21)}<span>ファイルを読み込む</span></button><button data-home="demo" disabled>${icon('piano',21)}<span>作例で試す</span></button></div></section><p id="home-message" class="home-message" role="status"></p><section class="home-recent" aria-labelledby="recent-title"><div class="home-section-heading"><h2 id="recent-title">最近の作品</h2><button data-home="works" disabled>すべて見る <span aria-hidden="true">→</span></button></div><div id="home-recents" class="home-recents"></div><p id="home-recent-state" class="home-recent-state" role="status">作品を読み込んでいます…</p><button id="home-retry" hidden>もう一度読み込む</button></section><footer class="home-footer"><span>作品はこの端末に自動保存されます。</span><span id="home-offline" role="status">オフライン準備中</span></footer></div>`;
    root.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
      if (button.id === 'home-retry') { void this.refresh(); return; }
      if (button.dataset.home === 'install' || button.dataset.home === 'help') { void this.perform(() => actions.command(button.dataset.home as HomeCommand)); return; }
      if (!this.ready || this.busy) return;
      if (button.dataset.recent) void this.perform(() => actions.open(button.dataset.recent!));
      else if (button.dataset.home) void this.perform(() => actions.command(button.dataset.home as HomeCommand));
    });
  }
  update(project: Project | null) {
    this.root.querySelector('#home-start-title')!.textContent = project ? 'つづきから' : '新しい曲をつくる';
    this.root.querySelector('#home-current')!.textContent = project ? `${project.name} · ${project.notes.length}音` : '空白をタップして、最初の音から。';
    this.root.querySelector<HTMLButtonElement>('#home-new')!.hidden = !project;
    this.ready = true; this.setBusy(this.busy);
  }
  setBusy(busy: boolean) {
    this.busy = busy; this.root.setAttribute('aria-busy',String(busy));
    this.root.querySelectorAll<HTMLButtonElement>('[data-home]:not([data-home="install"]):not([data-home="help"]),[data-recent]').forEach(button => button.disabled = busy || !this.ready);
  }
  async perform(action: () => void | Promise<void>) {
    if (this.busy) return; this.setBusy(true); this.message('');
    try { await action(); } catch(error) { this.message(error instanceof Error ? error.message : String(error)); }
    finally { this.setBusy(false); }
  }
  message(text: string) { this.root.querySelector('#home-message')!.textContent = text; }
  pwa(status: string, installed: boolean) {
    this.root.querySelector('#home-offline')!.textContent = status;
    this.root.querySelector<HTMLButtonElement>('#home-install')!.hidden = installed;
    this.root.querySelector<HTMLElement>('#home-installed')!.hidden = !installed;
  }
  async refresh() {
    const generation = ++this.generation, state = this.root.querySelector('#home-recent-state')!;
    state.textContent = '作品を読み込んでいます…'; this.root.querySelector<HTMLButtonElement>('#home-retry')!.hidden = true;
    try {
      const works = (await this.actions.list()).toSorted((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0,3);
      if (generation !== this.generation) return;
      const cards = works.map(work => {
        const button = document.createElement('button'); button.className = 'home-work'; button.dataset.recent = work.id; button.disabled = this.busy || !this.ready;
        const preview = document.createElement('canvas'); preview.width = 500; preview.height = 160; preview.setAttribute('aria-hidden','true');
        const title = document.createElement('strong'); title.textContent = work.name;
        const meta = document.createElement('small'); meta.textContent = `${work.notes}音 · ${new Date(work.updatedAt).toLocaleDateString('ja-JP')}`;
        button.append(preview,title,meta); drawWorkThumbnail(preview,work.preview); return button;
      });
      this.root.querySelector('#home-recents')!.replaceChildren(...cards);
      state.textContent = works.length ? '' : 'まだ作品はありません。最初の曲をつくってみましょう。';
    } catch(error) { if(generation !== this.generation)return;state.textContent = `作品を読み込めませんでした。${error instanceof Error ? error.message : String(error)}`;this.root.querySelector<HTMLButtonElement>('#home-retry')!.hidden = false; }
  }
}
