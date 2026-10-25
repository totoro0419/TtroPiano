import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const {checkout}=JSON.parse(readFileSync(process.argv[2] ?? '.openai/ux-baseline.json','utf8'));
const child=spawn(process.execPath,[process.cwd()+'/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',process.argv[3] ?? '4174','--strictPort'],{cwd:checkout,stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
