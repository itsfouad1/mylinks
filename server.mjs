import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initial} from './seed.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const fail=(status,message)=>Object.assign(new Error(message),{status});
function string(v,max=300){if(typeof v!=='string'||v.length>max)throw fail(400,'نص غير صالح أو أطول من الحد المسموح.');return v.trim();}
function address(v){v=string(v,2048);if(!v)return '';try{const u=new URL(v);if(!['https:','http:','mailto:','tel:'].includes(u.protocol)||u.username||u.password)throw 0;return v;}catch{throw fail(400,'الرابط غير صالح. استخدم https:// أو mailto: أو tel:');}}
function image(v){v=string(v,200);if(v&&!/^\/uploads\/[a-f0-9]{48}\.(png|jpg|webp)$/.test(v))throw fail(400,'مسار الصورة غير صالح.');return v;}
export function validateContent(v){
 if(!v||!v.profile||!Array.isArray(v.links)||!Array.isArray(v.projects)||v.links.length>50||v.projects.length>30)throw fail(400,'بيانات الصفحة غير صالحة.');
 const p=v.profile;if(!/^#[a-f0-9]{6}$/i.test(p.accent))throw fail(400,'اللون غير صالح.');
 const profile={name:string(p.name,80),role:string(p.role,100),bio:string(p.bio,400),avatar:image(p.avatar),accent:p.accent,footer:string(p.footer,80),email:string(p.email||'',150)};
 if(!profile.name)throw fail(400,'الاسم مطلوب.');
 const ids=new Set();
 function common(x){const id=string(x.id,80);if(!id||ids.has(id))throw fail(400,'معرّف البطاقة مكرر.');ids.add(id);const title=string(x.title,100);if(!title)throw fail(400,'عنوان البطاقة مطلوب.');return {id,title,description:string(x.description,400),url:address(x.url),visible:!!x.visible};}
 return {profile,links:v.links.map(x=>({...common(x),icon:['layers','code','linkedin','mail','instagram','globe','phone'].includes(x.icon)?x.icon:'globe',featured:!!x.featured})),projects:v.projects.map(x=>({...common(x),image:image(x.image)}))};
}
export async function createApp(options={}){
 const dataDir=resolve(options.dataDir||process.env.DATA_DIR||join(root,'data'));
 await mkdir(join(dataDir,'uploads'),{recursive:true});
 const statePath=join(dataDir,'content.json');
 let state;
 try{state=JSON.parse(await readFile(statePath,'utf8'));validateContent(state.draft);validateContent(state.published);}catch(e){if(e.code!=='ENOENT')throw e;state={draft:structuredClone(initial),published:structuredClone(initial),revision:0,publishedAt:null};await writeFile(statePath,JSON.stringify(state,null,2),{mode:0o600});}
 let queue=Promise.resolve();
 function persist(mutator){const op=queue.then(async()=>{const next=structuredClone(state);mutator(next);await writeFile(statePath+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(statePath+'.tmp',statePath);state=next;return state;});queue=op.catch(()=>{});return op;}
 const sessions=new Map(),attempts=new Map();
 const secure=options.secure??(process.env.SECURE_COOKIES==='true');
 const sessionCookie=(token,age)=>`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
 function auth(req){const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);const s=sessions.get(token);if(!s||s.expires<Date.now()){sessions.delete(token);throw fail(401,'يرجى تسجيل الدخول.');}return {token,...s};}
 async function body(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>4*1024*1024)throw fail(413,'حجم الطلب كبير.');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks));}catch{throw fail(400,'طلب JSON غير صالح.');}}
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
 const server=http.createServer(async(req,res)=>{
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
   const path=new URL(req.url,'http://localhost').pathname;
   if(path.startsWith('/api/')&&!['GET','HEAD'].includes(req.method)){
    const expected=options.origin||process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`;
    if(req.headers.origin!==expected)throw fail(403,'مصدر الطلب غير مسموح.');
    if(!req.headers['content-type']?.startsWith('application/json'))throw fail(415,'JSON مطلوب.');
   }
   if(req.method==='GET'&&path==='/api/content')return json(200,state.published);
   if(req.method==='POST'&&path==='/api/login'){
    const key=req.socket.remoteAddress, now=Date.now();
    for(const [k,a] of attempts)if(a.until<now)attempts.delete(k);
    const attempt=attempts.get(key)||{count:0,until:now+15*60e3};
    if(attempt.count>=8)throw fail(429,'محاولات كثيرة. جرّب بعد 15 دقيقة.');
    const input=await body(req);let credential;
    try{credential=JSON.parse(await readFile(join(dataDir,'admin.json'),'utf8'));}catch{throw fail(503,'شغّل npm run setup لإنشاء كلمة المرور أولًا.');}
    if(typeof input.password!=='string'||input.password.length>256)throw fail(400,'كلمة المرور غير صالحة.');
    const password=input.password;
    const hash=scryptSync(password,credential.salt,64);
    if(!timingSafeEqual(hash,Buffer.from(credential.hash,'hex'))){attempt.count++;attempts.set(key,attempt);throw fail(401,'كلمة المرور غير صحيحة.');}
    attempts.delete(key);
    for(const [key,s] of sessions)if(s.expires<now)sessions.delete(key);
    const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
    sessions.set(token,{expires:now+8*3600e3,csrf});res.setHeader('Set-Cookie',sessionCookie(token,8*3600));return json(200,{csrf});
   }
   if(path.startsWith('/api/admin')){
    const session=auth(req);
    if(req.method!=='GET'&&req.headers['x-csrf-token']!==session.csrf)throw fail(403,'جلسة غير صالحة، أعد تسجيل الدخول.');
    if(req.method==='GET'&&path==='/api/admin')return json(200,{...state,csrf:session.csrf});
    if(req.method==='POST'&&path==='/api/admin/logout'){sessions.delete(session.token);res.setHeader('Set-Cookie',sessionCookie('',0));return json(200,{ok:true});}
    if(req.method==='PUT'&&path==='/api/admin/draft'){
     const input=await body(req),content=validateContent(input.content);
     const next=await persist(s=>{if(input.revision!==s.revision)throw fail(409,'تغيّرت البيانات في نافذة أخرى. أعد تحميل الصفحة قبل الحفظ.');s.draft=content;s.revision++;});
     return json(200,{revision:next.revision});
    }
    if(req.method==='POST'&&path==='/api/admin/publish'){
     const input=await body(req);
     const next=await persist(s=>{if(input.revision!==s.revision)throw fail(409,'المسودة تغيّرت. أعد تحميل الصفحة.');s.published=structuredClone(s.draft);s.publishedAt=new Date().toISOString();s.revision++;});
     return json(200,{revision:next.revision,publishedAt:next.publishedAt});
    }
    if(req.method==='POST'&&path==='/api/admin/upload'){
     const input=await body(req);const match=typeof input.data==='string'&&input.data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
     if(!match)throw fail(400,'الصور المدعومة PNG وJPEG وWebP.');
     const bytes=Buffer.from(match[2],'base64');if(bytes.length>2*1024*1024)throw fail(413,'أقصى حجم للصورة 2 ميجابايت.');
     const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
     if(!valid)throw fail(400,'محتوى الملف لا يطابق صيغة الصورة.');
     const filename=randomBytes(24).toString('hex')+'.'+(match[1]==='jpeg'?'jpg':match[1]);await writeFile(join(dataDir,'uploads',filename),bytes,{flag:'wx'});
     return json(201,{url:'/uploads/'+filename});
    }
    throw fail(404,'المسار غير موجود.');
   }
   if(!['GET','HEAD'].includes(req.method))throw fail(405,'الطريقة غير مسموحة.');
   let file;
   if(path.startsWith('/uploads/')){if(!/^\/uploads\/[a-f0-9]{48}\.(png|jpg|webp)$/.test(path))throw fail(404,'الملف غير موجود.');file=join(dataDir,path.slice(1));}
   else {const routes={'/':'index.html','/admin':'admin.html','/admin/':'admin.html','/app.js':'app.js','/admin.js':'admin.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};if(!routes[path])throw fail(404,'الصفحة غير موجودة.');file=join(root,'public',routes[path]);}
   const content=await readFile(file),extension=file.slice(file.lastIndexOf('.'));res.writeHead(200,{'Content-Type':mime[extension]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
  }catch(e){if(!res.headersSent)json(e.status||(e.code==='ENOENT'?404:500),{error:e.status?e.message:'تعذّر إتمام الطلب.'});else res.end();if(!e.status&&e.code!=='ENOENT')console.error(e);}
 });
 return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
 const port=Number(option('--port')||process.env.PORT||3000),host=option('--host')||process.env.HOST||'127.0.0.1';
 const server=await createApp();server.listen(port,host,()=>console.log(`Fouad Links: http://${host}:${port} | Admin: /admin`));
}
