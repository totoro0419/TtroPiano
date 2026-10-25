// Run in CI to compare the pinned, untouched PR #1 implementation with this branch.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const commit = '24081dbe218e1c20aefe1391f231268bcf498403', root = process.cwd();
try { execFileSync('git',['cat-file','-e',commit],{stdio:'ignore'}); } catch { execFileSync('git',['fetch','--depth=1','origin',commit],{stdio:'inherit'}); }
const checkout = mkdtempSync(path.join(tmpdir(),'ttropiano-before-'));
const tar = path.join(checkout,'source.tar'); writeFileSync(tar,execFileSync('git',['archive',commit],{maxBuffer:30*1024*1024}));
execFileSync('tar',['xf',tar,'-C',checkout]); symlinkSync(path.join(root,'node_modules'),path.join(checkout,'node_modules'),'dir');
mkdirSync(path.join(checkout,'ux'));copyFileSync(path.join(root,'ux/index.html'),path.join(checkout,'ux/index.html'));copyFileSync(path.join(root,'src/ux-qa.ts'),path.join(checkout,'src/ux-qa.ts'));
const config=path.join(checkout,'vite.config.ts');writeFileSync(config,readFileSync(config,'utf8').replace("qa: 'qa/index.html'","qa: 'qa/index.html', ux: 'ux/index.html'"));
execFileSync('npm',['run','build'],{cwd:checkout,stdio:'inherit'});
mkdirSync('.openai',{recursive:true});writeFileSync('.openai/ux-baseline.json',JSON.stringify({commit,checkout}));
console.log('Prepared unchanged PR #1 with the same scenario driver.');
