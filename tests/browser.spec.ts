import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importMidi } from '../src/midi';

test('production browser: 33 integrated scenarios, actual PCM, 10,000 notes', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/qa/'); await page.getByRole('button', { name: '検証を実行', exact: true }).click();
  await expect(page.locator('#run')).toHaveText('検証完了 · 再実行はページを再読込', { timeout: 110000 });
  const json = await page.locator('#report').inputValue(), report = JSON.parse(json);
  await testInfo.attach('browser-validation.json', { body: json, contentType: 'application/json' });
  expect(report.results, json).toHaveLength(33);
  expect(report.results.filter((r: { status: string }) => r.status !== 'PASS'), json).toEqual([]);
  expect(errors).toEqual([]);
});

test('native UI touch, saving, MIDI download, project download and MIDI file input', async ({ page }, testInfo) => {
  await page.goto('/'); const canvas = page.locator('#roll'); await expect(canvas).toBeVisible();
  const r = (await canvas.boundingBox())!;
  await page.touchscreen.tap(r.x + 170, r.y + 220); await page.touchscreen.tap(r.x + 226, r.y + 180);
  await expect(page.locator('#save-status')).toHaveText('この端末に保存済み');
  await page.locator('#rename').click(); await page.getByRole('textbox', { name: '作品名', exact: true }).fill('CI ピアノ曲'); await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('#settings').click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'MIDIを書き出す', exact: true }).click(); const midi = await pending;
  const midiPath = testInfo.outputPath('composition.mid'); await midi.saveAs(midiPath);
  const parsed = importMidi(new Uint8Array(await readFile(midiPath))); expect(parsed.project.notes).toHaveLength(2);
  const backupPending = page.waitForEvent('download'); await page.getByRole('button', { name: '作品ファイル', exact: true }).click(); const backup = await backupPending;
  const backupPath = testInfo.outputPath('composition.ttropiano'); await backup.saveAs(backupPath); const data = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(data.project.notes).toHaveLength(2); expect(data.project.name).toBe('CI ピアノ曲');
  await page.locator('#file-input').setInputFiles(midiPath); await expect(page.locator('#file-input')).toHaveValue(''); await expect(page.locator('#project-name')).toHaveText('CI ピアノ曲');
  await page.getByRole('button', { name: '閉じる', exact: true }).click(); await page.locator('#works').click(); await expect(page.locator('.work-card')).toHaveCount(2);
  await page.getByRole('button', { name: '作品一覧を閉じる' }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await expect(canvas).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.reload(); await expect(page.locator('#project-name')).toHaveText('CI ピアノ曲');
  await testInfo.attach('midi-file', { path: midiPath, contentType: 'audio/midi' });
  await testInfo.attach('project-file', { path: backupPath, contentType: 'application/json' });
});

test('real offline: cached app, saved composition and piano samples survive network loss', async ({ page, context }) => {
  await page.goto('/'); await page.locator('#roll').click({ position: { x: 170, y: 220 } });
  await expect(page.locator('#save-status')).toHaveText('この端末に保存済み');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })); });
  await context.setOffline(true); await page.reload(); await expect(page.locator('#roll')).toBeVisible();
  const cachedPwa = await page.evaluate(async () => { const url=document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href,manifest=await (await fetch(url)).json();return {id:new URL(manifest.id,url).pathname,icons:await Promise.all(manifest.icons.map(async (icon:{src:string})=>(await (await fetch(new URL(icon.src,url))).arrayBuffer()).byteLength))}; });
  expect(cachedPwa.id).toBe('/'); expect(cachedPwa.icons.every((bytes:number)=>bytes>0)).toBe(true);
  await page.locator('#roll').click({ position: { x: 226, y: 180 } }); await expect(page.locator('#save-status')).toHaveText('この端末に保存済み');
  await page.locator('#play').click(); await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
  await page.locator('#stop').click(); await context.setOffline(false);
});

test('pedal tail outlives the final written note without early transport stop', async ({ page }) => {
  await page.goto('/'); const roll = page.locator('#roll');
  await roll.click({ position: { x: 80, y: 220 } });
  await page.locator('#tempo').click(); await page.locator('#settings-form input[name="bpm"]').fill('300'); await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.locator('#expression').click(); await page.getByRole('button', { name: 'ここで踏む', exact: true }).click();
  await roll.click({ position: { x: 506, y: 18 } }); await page.getByRole('button', { name: 'ここで離す', exact: true }).click();
  await page.locator('#stop').click(); await page.locator('#play').click(); await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  // At 300 BPM: note ends at .3s, old end+grace was .925s, pedal ends at 1.6s.
  await page.waitForTimeout(1200); await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#stop').click();
});

test('before/after: 15 identical composition scenarios, 3 paired runs', async ({ page }, testInfo) => {
  const pairs = [];
  for (let iteration=0;iteration<3;iteration++) {
    const pair: Record<string, any> = { iteration };
    for (const variant of (iteration % 2 ? ['after','before'] : ['before','after'])) {
      await page.goto(variant==='before'?'http://127.0.0.1:4174/ux/':'/ux/'); await page.locator('#run').click();
      await expect(page.locator('#run')).toHaveText('操作比較完了', { timeout: 110000 });
      const json=await page.locator('#report').inputValue(),report=JSON.parse(json);pair[variant]=report;
      expect(report.rows).toHaveLength(15); expect(report.compatibility).toHaveLength(2);expect(report.compatibility.every((r:{status:string})=>r.status==='PASS')).toBe(true);
      if(variant==='after') { expect(report.rows.filter((r: {status:string})=>r.status!=='PASS'),json).toEqual([]);expect(report.rows.every((r:{longPresses:number})=>r.longPresses===0)).toBe(true); }
      else expect(report.rows.filter((r:{status:string})=>r.status==='FAIL').map((r:{name:string})=>r.name.slice(0,2))).toEqual(['07','12']);
    }
    expect(pair.after.compatibility[0].actions).toBe(pair.before.compatibility[0].actions);expect(pair.after.compatibility[1].actions).toBeLessThanOrEqual(pair.before.compatibility[1].actions);pairs.push(pair);
  }
  await testInfo.attach('ux-paired-comparison.json',{body:JSON.stringify({pairs,limits:['Script replay, not human task completion time or device latency.']},null,2),contentType:'application/json'});
});

test('native touch: independent keyboard chord and interrupted note drag', async ({ page, context }) => {
  await page.goto('/'); const canvas = page.locator('#roll'), r = (await canvas.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: { id: number; x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const a = { id: 11, x: r.x+24, y: r.y+RULER+240 }, b = { id: 12, x: r.x+24, y: r.y+RULER+160 }, c = { id: 13, x: r.x+24, y: r.y+RULER+100 };
  await send('touchStart',[a]); await send('touchStart',[a,b]); await send('touchStart',[a,b,c]);
  const keyColor = (point: { x: number; y: number }) => canvas.evaluate((el, point) => { const c=el as HTMLCanvasElement, r=c.getBoundingClientRect(),d=c.width/r.width;return [...c.getContext('2d')!.getImageData((point.x-r.x)*d,(point.y-r.y)*d,1,1).data].slice(0,3); }, point);
  expect(await keyColor(a)).toEqual([200,184,227]); expect(await keyColor(b)).toEqual([200,184,227]); expect(await keyColor(c)).toEqual([200,184,227]);
  await send('touchEnd',[b]); expect(await keyColor(a)).toEqual([200,184,227]); expect(await keyColor(b)).not.toEqual([200,184,227]);
  await send('touchEnd',[]); await expect(page.locator('#pending-edit')).toBeHidden();
  await page.touchscreen.tap(r.x+180,r.y+240); await expect(page.locator('#selection-count')).toHaveText('1音');
  const note = {id:1,x:r.x+208,y:r.y+240}; await send('touchStart',[note]);
  const moved = {...note,x:note.x+56,y:note.y-20}; await send('touchMove',[moved]);
  await expect.poll(()=>keyColor(moved)).not.toEqual([255,255,255]);
  const second = {id:2,x:r.x+450,y:r.y+300}; await send('touchStart',[moved,second]); await send('touchEnd',[second]); await send('touchEnd',[]);
  await expect(page.locator('#pending-edit')).toBeVisible(); await expect(page.locator('#selection-count')).toHaveText('1音');
  await expect(page.locator('#save-status')).toHaveText('この端末に保存済み'); await page.reload(); await expect(page.locator('#pending-edit')).toBeVisible();
  await page.locator('#apply-pending').click(); await expect(page.locator('#pending-edit')).toBeHidden();
  await page.locator('#undo').click(); await expect(page.locator('#selection-count')).toHaveText('1音');
});
const RULER = 36;

test('selection keeps canvas and dock stable across tablet orientations; numeric keyboard route remains', async ({ page }) => {
  await page.goto('/'); const roll=page.locator('#roll');
  for (const [width,height] of [[1024,768],[768,1024],[834,1112],[1366,768],[390,844],[320,740]]) {
    await page.setViewportSize({width,height}); const before=(await roll.boundingBox())!;
    await page.locator('#stop').click(); await roll.press('Escape');
    await page.touchscreen.tap(before.x+150,before.y+180); const after=(await roll.boundingBox())!;
    expect(after).toEqual(before); await expect(page.locator('#inspector')).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if(width>=768) expect(await page.locator('.bottombar').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.locator('#undo').click();
  }
  await page.setViewportSize({width:1024,height:768}); await roll.focus(); await roll.press('Enter');
  await roll.press('ControlOrMeta+a'); await page.locator('#quick-details').press('Enter'); await expect(page.locator('#precision-form')).toBeVisible();
  await page.locator('#precision-form input[name="pitch"]').fill('65'); await page.getByRole('button',{name:'数値を適用',exact:true}).click();
  await page.getByRole('button',{name:'パネルを閉じる',exact:true}).click(); await expect(roll).toBeFocused();
});


test('PWA manifest, decoded install icons, readiness and explicit install entry', async ({page},testInfo) => {
  await page.goto('/');await expect(page.locator('#roll')).toBeVisible();
  const manifest=await page.evaluate(async()=>{const url=document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href,m=await(await fetch(url)).json();const images=[];for(const icon of m.icons){const image=new Image();image.src=new URL(icon.src,url).href;await image.decode();images.push({sizes:icon.sizes,width:image.naturalWidth,height:image.naturalHeight});}return {id:new URL(m.id,url).pathname,start:new URL(m.start_url,url).pathname,scope:new URL(m.scope,url).pathname,display:m.display,images};});
  expect(manifest.id).toBe('/');expect(manifest.start).toBe('/');expect(manifest.scope).toBe('/');expect(manifest.display).toBe('standalone');expect(manifest.images).toEqual([{sizes:'192x192',width:192,height:192},{sizes:'512x512',width:512,height:512}]);
  await page.locator('#settings').click();await expect(page.locator('#pwa-readiness')).toContainText('オフライン準備完了',{timeout:15000});
  await page.locator('#install-help summary').click();await expect(page.locator('#install-help')).toHaveAttribute('open','');
  // A test event exercises our entry/cancel flow. It is not an OS installation.
  await page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});Object.assign(e,{prompt:async()=>{document.documentElement.dataset.installTest='prompted';},userChoice:Promise.resolve({outcome:'dismissed'})});window.dispatchEvent(e);});
  await page.locator('#install-app').click();await expect(page.locator('html')).toHaveAttribute('data-install-test','prompted');await expect(page.locator('#install-app')).toBeEnabled();
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await expect(page.locator('#install-app')).toHaveText('ホーム画面に追加済み');await expect(page.locator('#install-app')).toBeDisabled();
  await testInfo.attach('pwa-validation.json',{body:JSON.stringify({manifest,offlineReady:true,installUiWithTestEvent:'PASS',actualOsInstall:'未確認'},null,2),contentType:'application/json'});
});

test('before/after: resized editor has no cleared presentation and library refresh never closes its modal', async ({page},testInfo) => {
  const comparison: Record<string, unknown> = {};
  for (const variant of ['before','after']) {
    await page.goto(variant === 'before' ? 'http://127.0.0.1:4175/?__qa_layout' : '/?__qa_layout');
    await expect(page.locator('#roll')).toBeVisible();
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#roll')!, samples: number[][] = [];
      const observer = new ResizeObserver(() => { const d = canvas.width / canvas.getBoundingClientRect().width; samples.push([...canvas.getContext('2d')!.getImageData(Math.round(20*d),Math.round(20*d),1,1).data]); });
      observer.observe(canvas); Object.assign(window,{shellSamples:samples,shellObserver:observer});
    });
    for (let i=0;i<6;i++) { await page.locator('#expression').click(); await expect(page.locator('#inspector')).toBeVisible(); await page.getByRole('button',{name:'パネルを閉じる',exact:true}).click(); }
    await page.setViewportSize({width:768,height:1024}); await page.setViewportSize({width:1024,height:768});
    const pixels = await page.evaluate(() => (window as any).shellSamples as number[][]);
    expect(pixels.length).toBeGreaterThanOrEqual(12);
    const cleared = pixels.filter(pixel => pixel[0]===0 && pixel[1]===0 && pixel[2]===0).length;
    if (variant === 'before') expect(cleared).toBeGreaterThan(0); else expect(cleared).toBe(0);
    await page.locator('#roll').click({position:{x:170,y:220}}); await expect(page.locator('#save-status')).toHaveText('この端末に保存済み');
    await page.locator('#works').click(); await expect(page.locator('#library-dialog .work-card')).toHaveCount(1);
    if(variant === 'after') await expect(page.locator('#library-dialog')).toHaveAttribute('aria-busy','false');
    await page.evaluate(() => { Object.assign(window,{libraryCloseCount:0}); document.querySelector('#library-dialog')!.addEventListener('close',() => (window as any).libraryCloseCount++); });
    await page.locator('#library-dialog [data-copy]').first().click(); await expect(page.locator('#library-dialog .work-card')).toHaveCount(2);
    const closes = await page.evaluate(() => (window as any).libraryCloseCount as number);
    if(variant==='before') expect(closes).toBeGreaterThan(0); else expect(closes).toBe(0);
    comparison[variant]={resizeSamples:pixels.length,clearedBitmapObservations:cleared,libraryRefreshCloseEvents:closes};
    await page.getByRole('button',{name:'作品一覧を閉じる',exact:true}).click();
  }
  await testInfo.attach('shell-before-after.json',{body:JSON.stringify({baseline:'b890353e6caeed3353b859a6406caaa9afe01eb0',comparison,limits:['Pre-paint ResizeObserver pixel probes, not a physical tablet or human perception test.']},null,2),contentType:'application/json'});
});

test('app menu: keyboard, outside dismiss, direct routes, backup and unchanged canvas allocation', async ({page},testInfo) => {
  await page.goto('/'); const roll=page.locator('#roll'); await roll.click({position:{x:170,y:220}});
  const box=(await roll.boundingBox())!; await page.locator('#menu-button').click();
  await expect(page.locator('#app-menu')).toBeVisible(); await expect(page.locator('#menu-button')).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('[data-command="works"]')).toBeFocused(); await page.locator('[data-command="works"]').press('ArrowDown'); await expect(page.locator('[data-command="new"]')).toBeFocused();
  await page.locator('[data-command="new"]').press('End'); await expect(page.locator('[data-menu-close]')).toBeFocused(); await page.locator('[data-menu-close]').press('Escape');
  await expect(page.locator('#app-menu')).toBeHidden(); await expect(page.locator('#menu-button')).toBeFocused();
  await page.locator('#menu-button').press('ArrowDown'); await page.locator('[data-command="works"]').press('Tab'); await expect(page.locator('#app-menu')).toBeHidden(); await expect(page.locator('#works')).toBeFocused();
  await page.locator('#menu-button').click(); await roll.click({position:{x:400,y:300}}); await expect(page.locator('#app-menu')).toBeHidden();
  await roll.press('ControlOrMeta+a'); await expect(page.locator('#selection-count')).toHaveText('1音'); expect(await roll.boundingBox()).toEqual(box);
  await page.locator('#menu-button').click(); await page.getByRole('menuitem',{name:'曲の設定',exact:true}).click(); await expect(page.locator('#settings-form')).toBeVisible(); await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.locator('#menu-button').click(); await page.getByRole('menuitem',{name:'TtroPianoについて',exact:true}).click(); await expect(page.locator('.about-copy')).toContainText('音を置いて、動かして、聴く。'); await page.locator('#floating').press('Escape');
  await expect(page.locator('#menu-button')).toBeFocused(); await page.locator('#menu-button').click(); const pending=page.waitForEvent('download'); await page.getByRole('menuitem',{name:'作品ファイルを保存',exact:true}).click(); const backup=await pending;
  const path=testInfo.outputPath('menu-backup.ttropiano'); await backup.saveAs(path); expect(JSON.parse(await readFile(path,'utf8')).project.notes).toHaveLength(1);
});

test('library: search, sort, keyed refresh, rename, duplicate and project handoff stay coherent', async ({page}) => {
  await page.goto('/'); await page.locator('#roll').click({position:{x:170,y:220}}); await page.locator('#works').click();
  const dialog=page.locator('#library-dialog'); await expect(dialog).toHaveAttribute('aria-busy','false'); await expect(dialog.locator('.work-card')).toHaveCount(1);
  await page.evaluate(()=>{Object.assign(window,{originalSearch:document.querySelector('#work-search'),libraryCloseCount:0});document.querySelector('#library-dialog')!.addEventListener('close',()=> (window as any).libraryCloseCount++);});
  await page.locator('#work-search').fill('無題'); await dialog.locator('[data-copy]').click(); await expect(dialog.locator('.work-card')).toHaveCount(2); await expect(dialog).toHaveAttribute('aria-busy','false');
  await dialog.locator('[data-rename]').first().click(); await page.getByRole('textbox',{name:'作品名',exact:true}).fill('無題のメロディー 改名'); await page.getByRole('button',{name:'保存',exact:true}).click(); await expect(dialog.locator('.work-card')).toContainText(['無題のメロディー 改名','無題のピアノ曲']);
  await expect(page.locator('#work-search')).toHaveValue('無題'); expect(await page.evaluate(()=>document.querySelector('#work-search')===(window as any).originalSearch)).toBe(true); expect(await page.evaluate(()=>(window as any).libraryCloseCount)).toBe(0);
  await page.locator('#work-sort').selectOption('name'); const names=await dialog.locator('.work-card strong').allTextContents(); expect(names).toEqual([...names].sort((a,b)=>a.localeCompare(b,'ja')));
  await page.locator('#work-search').fill('存在しない作品'); await expect(dialog.locator('.work-card')).toHaveCount(0); await expect(dialog.locator('.library-empty')).toBeVisible(); await dialog.locator('[data-clear]').click(); await expect(dialog.locator('.work-card')).toHaveCount(2);
  const target=dialog.locator('.work-card').filter({hasText:'無題のメロディー 改名'}); await target.locator('[data-open]').click(); await expect(dialog).toBeHidden(); await expect(page.locator('#project-name')).toHaveText('無題のメロディー 改名'); await expect(page.locator('#roll')).toBeFocused();
  await page.reload(); await expect(page.locator('#project-name')).toHaveText('無題のメロディー 改名');
  await page.locator('#works').click(); await expect(dialog).toHaveAttribute('aria-busy','false');
  await dialog.locator('.work-card[data-current="true"] [data-delete]').click(); await page.getByRole('button',{name:'キャンセル',exact:true}).click(); await expect(dialog.locator('.work-card')).toHaveCount(2);
  await dialog.locator('.work-card[data-current="true"] [data-delete]').click(); await page.getByRole('button',{name:'削除する',exact:true}).click(); await expect(dialog).toHaveAttribute('aria-busy','false');
  await expect(dialog.locator('.work-card')).toHaveCount(2); await expect(dialog.locator('.work-card').filter({hasText:'無題のメロディー 改名'})).toHaveCount(0);
  await page.getByRole('button',{name:'作品一覧を閉じる',exact:true}).click(); await page.reload(); await expect(page.locator('#project-name')).toHaveText('無題のピアノ曲');
  await page.locator('#works').click(); await expect(dialog).toHaveAttribute('aria-busy','false'); await expect(dialog.locator('.work-card').filter({hasText:'無題のメロディー 改名'})).toHaveCount(0);
});

test('library: delayed loading can be dismissed; failed list retries without losing the composition', async ({page}) => {
  await page.addInitScript(()=>{
    const original=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(this: Worker,message:any,...rest:any[]){
      if(message?.kind==='list' && (window as any).failList){setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:{id:message.id,error:'試験用の読み込み失敗'}})),25);return;}
      if(message?.kind==='load'){setTimeout(()=>Reflect.apply(original,this,[message,...rest]),250);return;}
      return Reflect.apply(original,this,[message,...rest]);
    } as typeof original;
    Object.assign(window,{failList:true});
  });
  await page.goto('/'); await page.locator('#roll').click({position:{x:170,y:220}}); await page.locator('#works').click();
  const dialog=page.locator('#library-dialog'); await expect(dialog.locator('.library-error')).toBeVisible(); await expect(dialog).toHaveAttribute('aria-busy','false');
  await page.evaluate(()=>(window as any).failList=false); await dialog.locator('[data-retry]').click(); await expect(dialog.locator('.work-card')).toHaveCount(1); await expect(dialog.locator('.library-error')).toBeHidden();
  await dialog.locator('[data-copy]').click(); await expect(dialog.locator('.work-card')).toHaveCount(2); await expect(dialog).toHaveAttribute('aria-busy','false');
  await dialog.locator('.work-card [data-open]').first().click(); await expect(dialog).toBeVisible(); await dialog.locator('[data-close]').click(); await page.waitForTimeout(400);
  await expect(dialog).toBeHidden(); await expect(page.locator('#project-name')).toHaveText('無題のピアノ曲'); await page.locator('#roll').press('ControlOrMeta+a'); await expect(page.locator('#selection-count')).toHaveText('1音');
});

test('navigation adapts to touch, narrow windows and large text without covering controls', async ({page},testInfo) => {
  await page.goto('/'); const measurements=[];
  for (const [width,height] of [[320,740],[390,844],[768,1024],[1024,768],[1366,768]]) {
    await page.setViewportSize({width,height}); await page.locator('#menu-button').click(); const menu=(await page.locator('#app-menu').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);expect(menu.x+menu.width).toBeLessThanOrEqual(width);expect(menu.y+menu.height).toBeLessThanOrEqual(height);
    await expect(page.locator('[data-command="works"]')).toBeFocused();await page.locator('[data-command="works"]').press('End');await expect(page.locator('[data-menu-close]')).toBeInViewport(); await page.locator('[data-menu-close]').press('Escape');
    await page.locator('#menu-button').click(); await page.locator('[data-command="works"]').click(); await expect(page.locator('#library-dialog')).toHaveAttribute('aria-busy','false'); const library=(await page.locator('#library-dialog').boundingBox())!;
    expect(library.x).toBeGreaterThanOrEqual(0);expect(library.x+library.width).toBeLessThanOrEqual(width);expect(library.y+library.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    measurements.push({width,height,menu,library}); await page.getByRole('button',{name:'作品一覧を閉じる',exact:true}).click();
  }
  await page.setViewportSize({width:390,height:600}); await page.addStyleTag({content:'.app-menu [role=menuitem],.library-dialog button,.library-dialog input,.library-dialog select{font-size:24px!important}.app-menu .menu-current strong,.library-dialog .work-meta strong{font-size:26px!important}'});
  await page.locator('#menu-button').click(); await page.locator('[data-command="help"]').click(); await expect(page.locator('.help-copy')).toBeVisible(); await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.locator('#menu-button').click(); await page.locator('[data-command="works"]').click(); await expect(page.locator('#library-dialog')).toHaveAttribute('aria-busy','false'); expect(await page.locator('#library-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await testInfo.attach('navigation-layout.json',{body:JSON.stringify({measurements,largeControlText:'PASS',physicalTablet:'未確認'},null,2),contentType:'application/json'});
});
