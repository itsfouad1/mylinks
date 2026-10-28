import {mkdir, writeFile, access} from 'node:fs/promises';
import {scryptSync, randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
const directory=resolve(process.env.DATA_DIR || 'data');
const target=resolve(directory,'admin.json');
try { await access(target); console.error('Admin already exists. To reset, stop the server, remove data/admin.json, then run setup.'); process.exit(1); } catch(e) {if(e.code!=='ENOENT') throw e;}
console.log('Create your admin password. Input is visible in this terminal; use a private terminal.');
const rl=createInterface({input:process.stdin,output:process.stdout});
const password=await rl.question('Password (at least 12 characters): ');
rl.close();
if(password.length<12 || password.length>256) { console.error('Password must be 12–256 characters.'); process.exit(1); }
const salt=randomBytes(32).toString('hex');
await mkdir(directory,{recursive:true});
await writeFile(target,JSON.stringify({salt,hash:scryptSync(password,salt,64).toString('hex')}),{mode:0o600,flag:'wx'});
console.log('Admin created. Run npm start and open http://localhost:3000/admin');
