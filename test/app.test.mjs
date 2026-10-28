import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scryptSync,randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
import {initial} from '../seed.mjs';

test('authentication, CSRF, draft isolation, publish, validation, uploads, persistence',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'fouad-links-'));
 const password='test-password-12345',salt=randomBytes(32).toString('hex');
 await writeFile(join(dataDir,'admin.json'),JSON.stringify({salt,hash:scryptSync(password,salt,64).toString('hex')}));
 let server=await createApp({dataDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let base=`http://127.0.0.1:${server.address().port}`;let cookie,csrf;
 const call=async(path,{method='GET',body,origin=base,token=csrf,session=cookie}={})=>{const r=await fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{'X-CSRF-Token':token}:{}),...(session?{Cookie:session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,headers:r.headers,data:await r.json()};};
 try{
 await t.test('admin is private; no password or drafts exposed publicly',async()=>{assert.equal((await call('/api/admin')).status,401);const r=await call('/api/content');assert.equal(r.status,200);assert.equal(r.data.draft,undefined);assert.equal(r.data.profile.name,initial.profile.name);});
 await t.test('login rejects bad passwords and cross-origin requests',async()=>{assert.equal((await call('/api/login',{method:'POST',body:{password:'bad'}})).status,401);assert.equal((await call('/api/login',{method:'POST',body:{password},origin:'https://evil.example'})).status,403);const r=await call('/api/login',{method:'POST',body:{password}});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=r.data.csrf;assert.match(r.headers.get('set-cookie'),/HttpOnly/);});
 let revision=0;const content=structuredClone(initial);content.profile.name='Draft name';content.links[0].url='https://example.com/portfolio';
 await t.test('CSRF rejects mutation; save does not publish; optimistic concurrency works',async()=>{assert.equal((await call('/api/admin/draft',{method:'PUT',body:{content,revision},token:'wrong'})).status,403);const saved=await call('/api/admin/draft',{method:'PUT',body:{content,revision}});assert.equal(saved.status,200);revision=saved.data.revision;assert.equal((await call('/api/content')).data.profile.name,initial.profile.name);assert.equal((await call('/api/admin/draft',{method:'PUT',body:{content,revision:0}})).status,409);});
 await t.test('publish copies saved content; unsafe URLs and traversal rejected',async()=>{const bad=structuredClone(content);bad.links[0].url='javascript:alert(1)';assert.equal((await call('/api/admin/draft',{method:'PUT',body:{content:bad,revision}})).status,400);const r=await call('/api/admin/publish',{method:'POST',body:{revision}});assert.equal(r.status,200);revision=r.data.revision;assert.equal((await call('/api/content')).data.profile.name,'Draft name');assert.equal((await call('/api/admin/publish',{method:'POST',body:{revision:0}})).status,409);assert.equal((await fetch(base+'/data/admin.json')).status,404);assert.equal((await fetch(base+'/%2e%2e/server.mjs')).status,404);});
 await t.test('image upload validates signatures and is served with an image type',async()=>{assert.equal((await call('/api/admin/upload',{method:'POST',body:{data:'data:image/png;base64,SGVsbG8='}})).status,400);const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=';const r=await call('/api/admin/upload',{method:'POST',body:{data:'data:image/png;base64,'+pixel}});assert.equal(r.status,201);const image=await fetch(base+r.data.url);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');await image.arrayBuffer();content.projects[0].image=r.data.url;assert.equal((await call('/api/admin/draft',{method:'PUT',body:{content,revision}})).status,200);});
 await t.test('content survives process restart; sessions do not',async()=>{await new Promise(r=>server.close(r));server=await createApp({dataDir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;assert.equal((await call('/api/content')).data.profile.name,'Draft name');assert.equal((await call('/api/admin')).status,401);assert.ok(JSON.parse(await readFile(join(dataDir,'content.json'),'utf8')).draft.projects[0].image);});
 await t.test('eight failed logins trigger rate limiting',async()=>{for(let i=0;i<8;i++)assert.equal((await call('/api/login',{method:'POST',body:{password:'bad'}})).status,401);assert.equal((await call('/api/login',{method:'POST',body:{password}})).status,429);});
 }finally{await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
});
