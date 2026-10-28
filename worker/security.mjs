import {fail} from './validation.mjs';
const encoder=new TextEncoder();
export const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const randomHex=(size=32)=>hex(crypto.getRandomValues(new Uint8Array(size)));
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
function unhex(value){if(typeof value!=='string'||!/^([a-f0-9]{2})+$/i.test(value))throw fail(503,'إعدادات الدخول غير صالحة.');return Uint8Array.from(value.match(/../g),x=>parseInt(x,16));}
function equal(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export function secrets(env){
 if(typeof env.SESSION_SECRET!=='string'||env.SESSION_SECRET.length<32||typeof env.ADMIN_CREDENTIAL!=='string')throw fail(503,'أكمل إعداد أسرار الدخول أولًا.');
 let credential;try{credential=JSON.parse(env.ADMIN_CREDENTIAL);}catch{throw fail(503,'إعدادات الدخول غير صالحة.');}
 if(credential.algorithm!=='PBKDF2-SHA256'||credential.iterations!==100000||!/^[a-f0-9]{64}$/.test(credential.salt)||!/^[a-f0-9]{64}$/.test(credential.hash))throw fail(503,'إعدادات الدخول غير صالحة.');
 return credential;
}
export async function verifyPassword(password,credential){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);const value=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(credential.salt),iterations:credential.iterations,hash:'SHA-256'},key,256);return equal(hex(value),credential.hash);}
export const credentialVersion=env=>digest(env.ADMIN_CREDENTIAL+'|'+env.SESSION_SECRET);
export async function hmac(env,value){if(!env.SESSION_SECRET||env.SESSION_SECRET.length<32)throw fail(503,'أكمل إعداد أسرار الدخول أولًا.');const key=await crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));}
export async function eventToken(env,lang){const value=lang+'.'+(Date.now()+3600e3);return value+'.'+await hmac(env,value);}
export async function validEventToken(env,token,lang){if(typeof token!=='string'||token.length>120)return false;const p=token.split('.');if(p.length!==3||p[0]!==lang||!/^\d+$/.test(p[1])||Number(p[1])<Date.now()||Number(p[1])>Date.now()+3600e3)return false;return equal(p[2],await hmac(env,p[0]+'.'+p[1]));}
export async function auth(request,env,db){secrets(env);const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);if(!token||!/^[a-f0-9]{64}$/.test(token))throw fail(401,'يرجى تسجيل الدخول.');const tokenHash=await digest(token),row=await db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(tokenHash,Date.now()).first();if(!row||row.credential_version!==await credentialVersion(env))throw fail(401,'يرجى تسجيل الدخول.');return {...row,tokenHash};}
export async function rateLimit(request,env,db,scope,maximum,windowMs){
 const now=Date.now(),window=Math.floor(now/windowMs),ip=request.headers.get('CF-Connecting-IP')||'local';
 const key=scope+':'+window+':'+await hmac(env,scope+'|'+window+'|'+ip);
 const row=await db.prepare('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count').bind(key,(window+1)*windowMs,maximum).first();
 if(!row)throw fail(429,scope==='login'?'محاولات كثيرة. جرّب لاحقًا.':'طلبات كثيرة. حاول بعد قليل.');
}
export function cookie(request,token,seconds){const secure=new URL(request.url).protocol==='https:';return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secure?'; Secure':''}`;}
