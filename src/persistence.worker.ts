import { uid, validateProject, type Project, type Session } from './model';
interface RecordData { project: Project; session: Session; stamp: string; previous?: { project: Project; session: Session } }
const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (v: unknown) => void };
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ttropiano-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'project.id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onblocked = () => reject(Error('別のタブを閉じて保存を再試行してください。'));
  });
}
function read<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function command(kind: string, payload: any) {
  const db = await database();
  if (kind === 'list') { const rows = await read<RecordData[]>(db.transaction('projects').objectStore('projects').getAll()); return rows.map(r => ({ id: r.project.id, name: r.project.name, updatedAt: r.project.updatedAt, notes: r.project.notes.length, preview: r.project.notes.slice(0, 500) })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  if (kind === 'load') { const row = await read<RecordData | undefined>(db.transaction('projects').objectStore('projects').get(payload.id)); if (!row) return null; try { validateProject(row.project); return { ...row, previous: undefined, recovered: false }; } catch (error) { if (!row.previous) throw error; validateProject(row.previous.project); return { ...row.previous, stamp: row.stamp, recovered: true }; } }
  if (kind === 'save' || kind === 'delete') {
    if (kind === 'save') validateProject(payload.project);
    const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
    return new Promise((resolve, reject) => {
      let stamp: string;
      tx.onerror = () => reject(tx.error ?? Error('端末への保存に失敗しました。'));
      tx.onabort = () => reject(tx.error ?? Error('別のタブで作品が更新されました。バックアップを書き出してから開き直してください。'));
      tx.oncomplete = () => resolve({ stamp });
      const req = store.get(kind === 'save' ? payload.project.id : payload.id);
      req.onsuccess = () => {
        const old = req.result as RecordData | undefined;
        if ((old?.stamp ?? null) !== (payload.expected ?? null)) { tx.abort(); return; }
        if (kind === 'delete') { store.delete(payload.id); return; }
        stamp = uid();
        const previous = old && old.project.revision !== payload.project.revision ? { project: old.project, session: old.session } : old?.previous;
        store.put({ project: payload.project, session: payload.session, stamp, previous } satisfies RecordData);
      };
    });
  }
  throw Error('不明な保存処理です。');
}
let queue = Promise.resolve();
scope.onmessage = event => {
  const { id, kind, payload } = event.data;
  queue = queue.then(async () => { try { scope.postMessage({ id, value: await command(kind, payload) }); } catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); } });
};
