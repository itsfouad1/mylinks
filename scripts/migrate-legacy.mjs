import {readFile,writeFile,mkdir,readdir,stat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,relative,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {validateContent} from '../worker/validation.mjs';
import {migrateContent} from '../content.mjs';
import {initial} from '../seed.mjs';
export function importStatements(legacy,stats={}){
 const draft=JSON.stringify(validateContent(migrateContent(legacy.draft))),published=JSON.stringify(validateContent(migrateContent(legacy.published)));
 if(!Number.isSafeInteger(legacy.revision)||legacy.revision<0)throw Error('Invalid legacy revision.');
 const seed=JSON.stringify(validateContent(migrateContent(initial)));
 const quote=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
 const runId=crypto.randomUUID(),contentStatements=[];
 for(const [field,value]of [['draft',draft],['published',published]]){const characters=Array.from(value);for(let i=0;i<characters.length;i+=6000)contentStatements.push(`INSERT INTO import_chunks(run_id,field,sequence,chunk) VALUES(${quote(runId)},${quote(field)},${i/6000},${quote(characters.slice(i,i+6000).join(''))});`);}
 const assembled=field=>`(SELECT group_concat(chunk,'') FROM (SELECT chunk FROM import_chunks WHERE run_id=${quote(runId)} AND field=${quote(field)} ORDER BY sequence))`;
 contentStatements.push(`INSERT INTO content(id,draft,published,revision,published_at) VALUES(1,${assembled('draft')},${assembled('published')},${legacy.revision},${quote(legacy.publishedAt||null)}) ON CONFLICT(id) DO UPDATE SET draft=excluded.draft,published=excluded.published,revision=excluded.revision,published_at=excluded.published_at WHERE content.revision=0 AND content.draft=${quote(seed)} AND content.published=${quote(seed)};`);
 contentStatements.push(`DELETE FROM import_chunks WHERE run_id=${quote(runId)};`);
 const statements=[];
 const cutoff=new Date(Date.now()-89*864e5).toISOString().slice(0,10),today=new Date().toISOString().slice(0,10);
 const event=(day,lang,kind,id,count)=>{if(!Number.isSafeInteger(count)||count<0||count>1e12)throw Error('Invalid analytics count.');if(!count)return;statements.push(`INSERT INTO analytics(day,lang,kind,card_id,count) VALUES(${[day,lang,kind,id].map(quote).join(',')},${count}) ON CONFLICT(day,lang,kind,card_id) DO NOTHING;`);};
 for(const [day,values]of Object.entries(stats)){if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<cutoff||day>today)continue;for(const lang of ['ar','en'])event(day,lang,'view','',values.views?.[lang]||0);for(const [key,count]of Object.entries(values.clicks||{})){const [lang,kind,id]=JSON.parse(key);if(!['ar','en'].includes(lang)||!['links','projects','resources'].includes(kind)||typeof id!=='string'||id.length>80)throw Error('Invalid legacy analytics key.');event(day,lang,kind,id,count);}}
 return {draft,published,contentSql:contentStatements.join('\n')+'\n',analyticsSql:statements.join('\n')+'\n'};
}
async function main(){
 const args=process.argv.slice(2),from=args.indexOf('--from');if(from===-1||!args[from+1])throw Error('Usage: npm run migrate:legacy -- --from /absolute/path/to/data [--local | --remote]');
 if(args.includes('--local')&&args.includes('--remote'))throw Error('Choose local OR remote.');
 const data=resolve(args[from+1]),legacy=JSON.parse(await readFile(join(data,'content.json'),'utf8'));let stats={};try{stats=JSON.parse(await readFile(join(data,'analytics.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const planned=importStatements(legacy,stats),out=resolve('migration-output');await mkdir(out,{recursive:true});
 // Split statements into separate files to stay beneath D1's per-statement limit.
 await writeFile(join(out,'content.sql'),planned.contentSql,{mode:0o600});await writeFile(join(out,'analytics.sql'),planned.analyticsSql,{mode:0o600});
 const files=[];const uploads=join(data,'uploads');let entries=[];try{entries=await readdir(uploads);}catch(e){if(e.code!=='ENOENT')throw e;}
 const root=await realpath(data);for(const name of entries){if(!/^[a-f0-9]{48}\.(pdf|png|jpg|webp)$/.test(name))continue;const path=await realpath(join(uploads,name));if(relative(root,path).startsWith('..'+sep)||!path.startsWith(root+sep))throw Error('Upload path escapes data folder.');if(!(await stat(path)).isFile())continue;files.push({name,path});}
 console.log(`Prepared ${files.length} uploads and validated bilingual content. No passwords or legacy sessions are imported.`);
 if(!args.includes('--local')&&!args.includes('--remote')){console.log('Plan saved to migration-output/. Re-run with --local or --remote to import. Keep generated SQL private.');return;}
 const target=args.includes('--remote')?'--remote':'--local';
 const rl=createInterface({input:process.stdin,output:process.stdout});const answer=await rl.question(`Import into ${target.slice(2)} D1/R2 configured in wrangler.jsonc? Back up the target first. Type IMPORT: `);rl.close();if(answer!=='IMPORT')throw Error('Import cancelled.');
 const run=(argv,json=false)=>{const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...argv],{encoding:'utf8',stdio:json?['ignore','pipe','pipe']:['ignore','inherit','inherit']});if(result.status!==0)throw Error('Wrangler command failed. Check configuration and retry.');return json?JSON.parse(result.stdout):null;};
 const current=run(['d1','execute','DB',target,'--json','--command','SELECT draft,published,revision FROM content WHERE id=1'],true)[0]?.results?.[0];const seed=JSON.stringify(validateContent(migrateContent(initial)));
 if(current&&!(current.revision===0&&current.draft===seed&&current.published===seed))throw Error('Target already contains edited content. Import refused; use a fresh database to avoid overwriting it.');
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8')),bucket=config.r2_buckets.find(x=>x.binding==='FILES')?.bucket_name;if(!bucket)throw Error('FILES bucket binding is missing.');
 const mime={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
 for(const file of files)run(['r2','object','put',bucket+'/'+file.name,target,'--file',file.path,'--content-type',mime[file.name.split('.').pop()]]);
 run(['d1','execute','DB',target,'--file',join(out,'content.sql'),'--yes']);
 const check=run(['d1','execute','DB',target,'--json','--command','SELECT draft,published FROM content WHERE id=1'],true)[0]?.results?.[0];if(check?.draft!==planned.draft||check?.published!==planned.published)throw Error('Content import conflict: target changed during import. Nothing was overwritten.');
 if((await readFile(join(out,'analytics.sql'),'utf8')).trim())run(['d1','execute','DB',target,'--file',join(out,'analytics.sql'),'--yes']);
 console.log('Import verified. Paths are unchanged. Configure the new administrator using npm run setup.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
