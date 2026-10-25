import { icon } from './icons';

export type MenuCommand = 'works' | 'new' | 'demo' | 'rename' | 'import' | 'midi' | 'backup' | 'settings' | 'install' | 'help' | 'about';
const groups: { name: string; items: [MenuCommand, string, string][] }[] = [
  { name: '作品', items: [['works', '作品一覧', 'folder'], ['new', '新しい曲', 'add'], ['demo', '作例を試す', 'piano']] },
  { name: 'この曲とファイル', items: [['rename', '作品名を変更', 'phrase'], ['import', 'ファイルを読み込む', 'upload'], ['midi', 'MIDIを書き出す', 'download'], ['backup', '作品ファイルを保存', 'download']] },
  { name: 'アプリ', items: [['settings', '曲の設定', 'settings'], ['install', 'ホーム画面に追加', 'add'], ['help', '操作のヒント', 'help'], ['about', 'TtroPianoについて', 'info']] },
];

/** A command menu: ordinary editing controls stay in their existing, visible places. */
export class AppMenu {
  constructor(public panel: HTMLElement, public trigger: HTMLButtonElement, onCommand: (command: MenuCommand) => void) {
    trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'false');
    panel.innerHTML = `<div class="menu-identity" role="presentation"><span class="menu-mark">${icon('piano', 24)}</span><div><strong>TtroPiano</strong><span>音から、曲へ。</span></div></div><div class="menu-current" role="presentation"><span>編集中</span><strong data-menu-project></strong></div>${groups.map(group => `<div role="group" aria-label="${group.name}" class="menu-group"><div class="menu-group-title" role="presentation">${group.name}</div>${group.items.map(([command, label, glyph]) => `<button type="button" role="menuitem" tabindex="-1" data-command="${command}">${icon(glyph, 18)}<span>${label}</span></button>`).join('')}</div>`).join('')}<div class="menu-footer" role="presentation"><span data-menu-save></span></div><button type="button" role="menuitem" tabindex="-1" data-menu-close class="menu-close">${icon('close',18)}<span>メニューを閉じる</span></button>`;
    trigger.onclick = () => this.open ? this.hide(true) : this.show();
    trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.show(event.key === 'ArrowUp'); } });
    panel.addEventListener('beforetoggle', event => trigger.setAttribute('aria-expanded', String((event as ToggleEvent).newState === 'open')));
    panel.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (!button) return;
      if (button.hasAttribute('data-menu-close')) { this.hide(true); return; }
      const command = button.dataset.command as MenuCommand; if (!command) return;
      this.hide(false); onCommand(command);
    });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.hide(true); return; }
      if (event.key === 'Tab') { this.hide(true); return; }
      const items = this.items, current = items.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length : -1;
      if (index >= 0) { event.preventDefault(); items[index].focus(); }
    });
  }
  get open() { return this.panel.matches(':popover-open'); }
  get items() { return [...this.panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]; }
  show(last = false) { if (!this.open) this.panel.showPopover(); (last ? this.items.at(-1) : this.items[0])?.focus(); }
  hide(restoreFocus = false) { if (this.open) this.panel.hidePopover(); if (restoreFocus) this.trigger.focus(); }
  update(name: string, saved: string) { this.panel.querySelector('[data-menu-project]')!.textContent = name; this.panel.querySelector('[data-menu-save]')!.textContent = saved; }
}
