import {createInterface} from 'node:readline/promises';
import {writeFile,readFile} from 'node:fs/promises';
import {randomBytes,pbkdf2Sync,scryptSync,timingSafeEqual} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),remote=args.includes('--remote'),legacyIndex=args.indexOf('--legacy-admin');
const rl=createInterface({input:process.stdin,output:process.stdout});
try{
 const destination=remote?'Cloudflare Worker secret':'local .dev.vars';
 try{if(!remote){await readFile('.dev.vars');const answer=await rl.question('Local secrets already exist. Replace them and invalidate sessions? Type REPLACE: ');if(answer!=='REPLACE')process.exit(1);}}catch(e){if(e.code!=='ENOENT')throw e;}
 console.log(`Set administrator password for ${destination}. Input is visible; use a private terminal.`);
 const password=await rl.question('Password (12–256 characters): '),confirm=await rl.question('Confirm password: ');
 if(password.length<12||password.length>256||password!==confirm)throw Error('Passwords must match and be 12–256 characters.');
 if(legacyIndex!==-1){const old=JSON.parse(await readFile(args[legacyIndex+1],'utf8'));if(!timingSafeEqual(scryptSync(password,old.salt,64),Buffer.from(old.hash,'hex')))throw Error('Password does not match the legacy administrator.');}
 const salt=randomBytes(32).toString('hex'),credential=JSON.stringify({algorithm:'PBKDF2-SHA256',iterations:100000,salt,hash:pbkdf2Sync(password,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex')}),secret=randomBytes(48).toString('hex');
 if(remote){
  const answer=await rl.question('This updates login secrets on the Worker named in wrangler.jsonc. Type DEPLOY-SECRETS: ');if(answer!=='DEPLOY-SECRETS')process.exit(1);
  for(const [name,value]of [['ADMIN_CREDENTIAL',credential],['SESSION_SECRET',secret]]){const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put',name],{input:value,stdio:['pipe','inherit','inherit']});if(result.status!==0)throw Error(`Unable to set ${name}. Retry setup after checking Cloudflare login.`);}
 }else await writeFile('.dev.vars',`ADMIN_CREDENTIAL='${credential}'\nSESSION_SECRET='${secret}'\n`,{mode:0o600});
 console.log(remote?'Secrets updated. Existing sessions are now invalid.':'Local secrets saved. Run npm run db:local, then npm run dev.');
} catch(e){console.error(e.message);process.exitCode=1;}finally{rl.close();}
