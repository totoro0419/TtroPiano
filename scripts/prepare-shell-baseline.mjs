// Compare against the exact source used by the first published GitHub Pages app.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const commit = 'b890353e6caeed3353b859a6406caaa9afe01eb0', root = process.cwd();
try { execFileSync('git',['cat-file','-e',commit],{stdio:'ignore'}); } catch { execFileSync('git',['fetch','--depth=1','origin',commit],{stdio:'inherit'}); }
const checkout = mkdtempSync(path.join(tmpdir(),'ttropiano-shell-before-'));
const archive = path.join(checkout,'source.tar'); writeFileSync(archive,execFileSync('git',['archive',commit],{maxBuffer:30*1024*1024}));
execFileSync('tar',['xf',archive,'-C',checkout]); symlinkSync(path.join(root,'node_modules'),path.join(checkout,'node_modules'),'dir');
execFileSync('npm',['run','build'],{cwd:checkout,stdio:'inherit'});
mkdirSync('.openai',{recursive:true});writeFileSync('.openai/shell-baseline.json',JSON.stringify({commit,checkout}));
