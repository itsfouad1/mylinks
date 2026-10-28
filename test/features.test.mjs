import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scryptSync,randomBytes} from 'node:crypto';
import {createApp,validateContent} from '../server.mjs';
import {initial} from '../seed.mjs';

test('v2 migrates v1, preserves independent locales, publishes documents and records private statistics',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'fouad-v2-'));
 const legacy={draft:structuredClone(initial),published:structuredClone(initial),revision:4,publishedAt:null};legacy.draft.profile.name='اسمي القديم';
 await writeFile(join(dataDir,'content.json'),JSON.stringify(legacy));
 const password='feature-testing-password',salt=randomBytes(32).toString('hex');await writeFile(join(dataDir,'admin.json'),JSON.stringify({salt,hash:scryptSync(password,salt,64).toString('hex')}));
 let server=await createApp({dataDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${server.address().port}`,cookie,csrf;
 const call=async(path,method='GET',body,privateCall=true)=>{const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Origin:base,...(privateCall&&cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),'User-Agent':'FeatureTest'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,headers:r.headers,data:await r.json()};};
 try{
 assert.deepEqual(JSON.parse(await readFile(join(dataDir,'content.v1-backup.json'),'utf8')),legacy);
 const login=await call('login','POST',{password});cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.data.csrf;
 const admin=(await call('admin')).data;assert.equal(admin.draft.locales.ar.profile.name,'اسمي القديم');assert.equal(admin.draft.locales.en.profile.name,'Fouad Adel');let revision=admin.revision;
 const content=admin.draft;content.locales.ar.profile.name='فؤاد الجديد';content.locales.en.profile.name='English independent';
 content.locales.en.links[0].url='https://example.com/en';content.locales.ar.links[0].url='https://example.com/ar';
 const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
 const file=await call('admin/upload','POST',{data:pdf});assert.equal(file.status,201);assert.match(file.data.url,/\.pdf$/);
 const download=await fetch(base+file.data.url);assert.equal(download.headers.get('content-type'),'application/pdf');assert.match(download.headers.get('content-disposition'),/attachment/);await download.arrayBuffer();
 assert.equal((await call('admin/upload','POST',{data:'data:application/pdf;base64,SGVsbG8='})).status,400);
 content.locales.ar.resources=[{id:'cv1',type:'cv',title:'سيرتي الذاتية',description:'نسخة عربية',url:'',file:file.data.url,visible:true,issuer:'',date:''},{id:'certificate1',type:'certificate',title:'شهادة',description:'',url:'https://example.com/certificate',file:'',visible:false,issuer:'Chingu',date:'2026'}];
 content.locales.en.resources=[{...content.locales.ar.resources[0],title:'My CV',description:'English version'}];
 const invalid=structuredClone(content);invalid.locales.ar.resources[0].file='/uploads/../../admin.json';assert.throws(()=>validateContent(invalid));
 const saved=await call('admin/draft','PUT',{content,revision});assert.equal(saved.status,200);revision=saved.data.revision;
 assert.notEqual((await call('content?lang=en')).data.profile.name,'English independent');
 const publish=await call('admin/publish','POST',{revision});assert.equal(publish.status,200);revision=publish.data.revision;
 let ar=(await call('content?lang=ar')).data,en=(await call('content?lang=en')).data;
 assert.equal(ar.profile.name,'فؤاد الجديد');assert.equal(en.profile.name,'English independent');assert.equal(ar.resources[0].title,'سيرتي الذاتية');assert.equal(en.resources[0].title,'My CV');
 assert.equal((await call('admin/analytics','GET',null,false)).status,401);
 assert.equal((await call('events','POST',{lang:'ar',type:'view',token:'forged'},false)).status,400);
 assert.equal((await call('events','POST',{lang:'ar',type:'view',token:ar.trackingToken},false)).status,200);
 assert.equal((await call('events','POST',{lang:'en',type:'view',token:en.trackingToken},false)).status,200);
 assert.equal((await call('events','POST',{lang:'ar',type:'click',kind:'resources',id:'cv1',token:ar.trackingToken},false)).status,200);
 assert.equal((await call('events','POST',{lang:'ar',type:'click',kind:'resources',id:'certificate1',token:ar.trackingToken},false)).status,404);
 assert.equal((await call('events','POST',{lang:'en',type:'view',token:ar.trackingToken},false)).status,400);
 assert.equal((await call('events','POST',{lang:'en',type:'click',kind:'links',id:'portfolio',token:en.trackingToken},false)).status,200);
 const stats=await call('admin/analytics?days=7');assert.equal(stats.status,200);assert.equal(stats.data.views,2);assert.equal(stats.data.clicks,2);assert.deepEqual(stats.data.languages,{ar:1,en:1});assert.equal(stats.data.days.length,7);
 assert.equal((await call('admin/analytics?days=999')).status,400);
 // Legacy clients can still save Arabic without overwriting English.
 const legacySave=await call('admin/draft','PUT',{content:content.locales.ar,revision});assert.equal(legacySave.status,200);assert.equal((await call('admin')).data.draft.locales.en.profile.name,'English independent');
 const disk=await readFile(join(dataDir,'analytics.json'),'utf8');assert.ok(!disk.includes('127.0.0.1'));assert.ok(!disk.includes('User-Agent'));
 await new Promise(r=>server.close(r));server=await createApp({dataDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 const again=await call('login','POST',{password});cookie=again.headers.get('set-cookie').split(';')[0];csrf=again.data.csrf;assert.equal((await call('admin/analytics?days=30')).data.clicks,2);
 }finally{await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
});
