import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importMidi } from '../src/midi';

test('production browser: 20 integrated scenarios, actual PCM, 10,000 notes', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/qa/'); await page.getByRole('button', { name: '検証を実行', exact: true }).click();
  await expect(page.locator('#run')).toHaveText('検証完了 · 再実行はページを再読込', { timeout: 110000 });
  const json = await page.locator('#report').inputValue(), report = JSON.parse(json);
  await testInfo.attach('browser-validation.json', { body: json, contentType: 'application/json' });
  expect(report.results, json).toHaveLength(20);
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
