import {fail} from './validation.mjs';
import {getState,saveDraft,publish,report,cleanup} from './storage.mjs';
import {secrets,verifyPassword,credentialVersion,randomHex,digest,eventToken,validEventToken,auth,rateLimit,cookie} from './security.mjs';
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";
function secure(response){const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('Content-Security-Policy',CSP);return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}
const json=(status,value,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
async function body(request,max=1024*1024){if(Number(request.headers.get('Content-Length'))>max)throw fail(413,'حجم الطلب كبير.');const reader=request.body?.getReader();let chunks=[],size=0;try{if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw fail(413,'حجم الطلب كبير.');}chunks.push(value);}}finally{reader?.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw 0;return value;}catch{throw fail(400,'طلب JSON غير صالح.');}}
const filePattern=/^\/uploads\/[a-f0-9]{48}\.(pdf|png|jpg|webp)$/;
async function upload(request,env){
 const input=await body(request,8*1024*1024),match=typeof input.data==='string'&&input.data.match(/^data:(image\/(png|jpeg|webp)|application\/(pdf));base64,([A-Za-z0-9+/=]+)$/);
 if(!match)throw fail(400,'الملفات المدعومة PDF وPNG وJPEG وWebP.');const format=match[2]||match[3];let decoded;try{decoded=atob(match[4]);}catch{throw fail(400,'بيانات الملف غير صالحة.');}
 const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));if(bytes.length>(format==='pdf'?5:2)*1024*1024)throw fail(413,'أقصى حجم: 5MB لملف PDF و2MB للصورة.');
 const ascii=(start,end)=>new TextDecoder().decode(bytes.subarray(start,end));
 const valid=format==='pdf'?ascii(0,5)==='%PDF-':format==='png'?[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n):format==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
 if(!valid)throw fail(400,'محتوى الملف لا يطابق صيغته.');
 const filename=randomHex(24)+'.'+(format==='jpeg'?'jpg':format);await env.FILES.put(filename,bytes,{httpMetadata:{contentType:match[1],...(format==='pdf'?{contentDisposition:'attachment; filename="document.pdf"'}:{})}});return json(201,{url:'/uploads/'+filename});
}
async function serveFile(request,env,path){
 if(!filePattern.test(path))throw fail(404,'الملف غير موجود.');const key=path.slice('/uploads/'.length),object=request.method==='HEAD'?await env.FILES.head(key):await env.FILES.get(key);if(!object)throw fail(404,'الملف غير موجود.');
 const headers=new Headers({'Cache-Control':'public, max-age=3600','Content-Length':String(object.size)});object.writeHttpMetadata(headers);headers.set('ETag',object.httpEtag);if(key.endsWith('.pdf'))headers.set('Content-Disposition','attachment; filename="document.pdf"');
 return new Response(request.method==='HEAD'?null:object.body,{headers});
}
async function handle(request,env){
 const url=new URL(request.url),path=url.pathname,lang=url.searchParams.get('lang')==='en'?'en':'ar';
 if(path.startsWith('/api/')&&!['GET','HEAD'].includes(request.method)){
  const expected=env.PUBLIC_ORIGIN||url.origin;
  if(request.headers.get('Origin')!==expected)throw fail(403,'مصدر الطلب غير مسموح.');
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw fail(415,'JSON مطلوب.');
 }
 if(!path.startsWith('/api/')){
  if(!['GET','HEAD'].includes(request.method))throw fail(405,'الطريقة غير مسموحة.');
  if(path.startsWith('/uploads/'))return serveFile(request,env,path);
  const routes={'/':'/index.html','/admin':'/admin.html','/admin/':'/admin.html','/index.html':'/index.html','/admin.html':'/admin.html','/app.js':'/app.js','/admin.js':'/admin.js','/style.css':'/style.css','/favicon.svg':'/favicon.svg'};
  if(!routes[path])throw fail(404,'الصفحة غير موجودة.');const assetUrl=new URL(url);assetUrl.pathname=routes[path];const response=await env.ASSETS.fetch(new Request(assetUrl,request));const headers=new Headers(response.headers);headers.set('Cache-Control','no-cache');if(path.startsWith('/admin'))headers.set('X-Robots-Tag','noindex, nofollow');return new Response(response.body,{status:response.status,headers});
 }
 if(!env.DB||!env.FILES)throw fail(503,'أكمل ربط قاعدة البيانات والتخزين أولًا.');
 const db=env.DB.withSession('first-primary');
 if(request.method==='GET'&&path==='/api/content'){
  const state=await getState(db),content=structuredClone(state.published.locales[lang]);for(const kind of ['links','projects','resources'])content[kind]=content[kind].filter(x=>x.visible);
  return json(200,{...content,trackingToken:await eventToken(env,lang)});
 }
 if(request.method==='POST'&&path==='/api/events'){
  const input=await body(request,2048);if(!['ar','en'].includes(input.lang)||!await validEventToken(env,input.token,input.lang)||!['view','click'].includes(input.type))throw fail(400,'حدث الإحصائيات غير صالح.');
  if(/bot|crawler|spider|headless/i.test(request.headers.get('User-Agent')||''))return json(200,{ok:true});
  await rateLimit(request,env,db,'events',120,60e3);
  let kind='view',id='';if(input.type==='click'){
   if(!['links','projects','resources'].includes(input.kind))throw fail(400,'نوع البطاقة غير صالح.');
   const state=await getState(db),item=state.published.locales[input.lang][input.kind].find(x=>x.id===input.id&&x.visible&&(x.url||x.file));if(!item)throw fail(404,'البطاقة غير منشورة.');kind=input.kind;id=item.id;
  }
  await db.prepare('INSERT INTO analytics(day,lang,kind,card_id,count) VALUES(?,?,?,?,1) ON CONFLICT(day,lang,kind,card_id) DO UPDATE SET count=count+1').bind(new Date().toISOString().slice(0,10),input.lang,kind,id).run();return json(200,{ok:true});
 }
 if(request.method==='POST'&&path==='/api/login'){
  const credential=secrets(env);await rateLimit(request,env,db,'login',8,15*60e3);const input=await body(request,2048);
  if(typeof input.password!=='string'||input.password.length>256)throw fail(400,'كلمة المرور غير صالحة.');
  if(!await verifyPassword(input.password,credential))throw fail(401,'كلمة المرور غير صحيحة.');
  const token=randomHex(),csrf=randomHex();await db.prepare('INSERT INTO sessions(token_hash,csrf,credential_version,expires_at) VALUES(?,?,?,?)').bind(await digest(token),csrf,await credentialVersion(env),Date.now()+8*3600e3).run();return json(200,{csrf},{'Set-Cookie':cookie(request,token,8*3600)});
 }
 if(path.startsWith('/api/admin')){
  const session=await auth(request,env,db);
  if(request.method!=='GET'&&request.headers.get('X-CSRF-Token')!==session.csrf)throw fail(403,'جلسة غير صالحة، أعد تسجيل الدخول.');
  if(request.method==='GET'&&path==='/api/admin')return json(200,{...await getState(db),csrf:session.csrf});
  if(request.method==='GET'&&path==='/api/admin/analytics'){const range=Number(url.searchParams.get('days')||30);if(![7,30,90].includes(range))throw fail(400,'الفترة غير صالحة.');return json(200,await report(db,range));}
  if(request.method==='POST'&&path==='/api/admin/logout'){await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session.tokenHash).run();return json(200,{ok:true},{'Set-Cookie':cookie(request,'',0)});}
  if(request.method==='PUT'&&path==='/api/admin/draft')return json(200,await saveDraft(db,await body(request)));
  if(request.method==='POST'&&path==='/api/admin/publish')return json(200,await publish(db,await body(request,2048)));
  if(request.method==='POST'&&path==='/api/admin/upload')return upload(request,env);
 }
 throw fail(404,'المسار غير موجود.');
}
export default {
 async fetch(request,env){try{return secure(await handle(request,env));}catch(e){if(!e.status)console.error('Worker request failed:',e.name);return secure(json(e.status||500,{error:e.status?e.message:'تعذّر إتمام الطلب. تحقّق من إعدادات قاعدة البيانات.'}));}},
 async scheduled(controller,env,ctx){ctx.waitUntil(cleanup(env));}
};
