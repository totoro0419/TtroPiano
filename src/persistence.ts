import type { Project, Session } from './model';
export interface Work { id: string; name: string; updatedAt: string; notes: number; preview: Project['notes'] }
export class Persistence extends EventTarget {
  worker: Worker;
  sequence = 0;
  requests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  stamps = new Map<string, string | null>();
  waiting = new Map<string, { project: Project; session: Session }>();
  processing = false;
  failed = false;
  status: 'saving' | 'saved' | 'error' = 'saved';
  error = '';
  savedRevision = -1;
  constructor() {
    super(); this.worker = new Worker(new URL('./persistence.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => { const x = this.requests.get(data.id); if (!x) return; this.requests.delete(data.id); data.error ? x.reject(Error(data.error)) : x.resolve(data.value); };
    this.worker.onerror = () => { for (const r of this.requests.values()) r.reject(Error('保存処理を開始できませんでした。作品のバックアップを書き出してください。')); this.requests.clear(); this.setStatus('error', '保存処理が停止しました。'); };
  }
  request<T = any>(kind: string, payload = {}): Promise<T> { const id = ++this.sequence; return new Promise((resolve, reject) => { this.requests.set(id, { resolve, reject }); this.worker.postMessage({ id, kind, payload }); }); }
  list(): Promise<Work[]> { return this.request('list'); }
  async load(id: string): Promise<{ project: Project; session: Session; recovered: boolean } | null> { const row = await this.request('load', { id }); if (row) this.stamps.set(id, row.stamp); return row; }
  save(project: Project, session: Session) { this.waiting.set(project.id, { project, session: structuredClone(session) }); if (this.failed) { this.setStatus('error', this.error); return; } this.setStatus('saving'); void this.drain(); }
  private setStatus(status: Persistence['status'], error = '') { this.status = status; this.error = error; this.dispatchEvent(new Event('status')); }
  private async drain() {
    if (this.processing) return; this.processing = true;
    try {
      while (this.waiting.size) {
        const [id, data] = this.waiting.entries().next().value!; this.waiting.delete(id);
        try { const result = await this.request('save', { ...data, expected: this.stamps.get(id) ?? null }); this.stamps.set(id, result.stamp); this.savedRevision = data.project.revision; }
        catch (error) { if (!this.waiting.has(id)) this.waiting.set(id, data); throw error; }
      }
      this.failed = false; this.setStatus('saved');
    } catch (e) { this.failed = true; this.setStatus('error', e instanceof Error ? e.message : String(e)); }
    finally { this.processing = false; }
  }
  retry() { this.failed = false; this.setStatus('saving'); void this.drain(); }
  async flush() { if (this.failed) throw Error(this.error); if (!this.processing && !this.waiting.size) return; await new Promise<void>((resolve, reject) => { const fn = () => { if (this.status === 'saving') return; this.removeEventListener('status', fn); this.status === 'saved' ? resolve() : reject(Error(this.error)); }; this.addEventListener('status', fn); if (!this.processing) void this.drain(); }); }
  async delete(id: string) { await this.flush(); if (!this.stamps.has(id)) await this.load(id); await this.request('delete', { id, expected: this.stamps.get(id) }); this.stamps.delete(id); }
}
