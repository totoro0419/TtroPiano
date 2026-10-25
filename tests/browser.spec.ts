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
      expect(report.rows).toHaveLength(15);
      if(variant==='after') { expect(report.rows.filter((r: {status:string})=>r.status!=='PASS'),json).toEqual([]);expect(report.rows.every((r:{longPresses:number})=>r.longPresses===0)).toBe(true); }
      else expect(report.rows.filter((r:{status:string})=>r.status==='FAIL').map((r:{name:string})=>r.name.slice(0,2))).toEqual(['07','12']);
    }
    pairs.push(pair);
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
  const note = {id:1,x:r.x+180,y:r.y+240}; await send('touchStart',[note]);
  const moved = {...note,x:note.x+56,y:note.y-20}; await send('touchMove',[moved]);
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
