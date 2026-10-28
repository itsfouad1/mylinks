import {spawn} from 'node:child_process';
const args=process.argv.slice(2),forward=[];
for(let i=0;i<args.length;i++){if(args[i]==='--host'){forward.push('--ip',args[++i]);}else if(args[i]==='--strictPort')continue;else forward.push(args[i]);}
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev',...forward],{stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code||0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
