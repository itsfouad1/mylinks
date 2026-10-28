import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
export async function analyticsStore(dir){
 const file=join(dir,'analytics.json');let days={};
 try{days=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const secret=randomBytes(32);let queue=Promise.resolve();const limits=new Map();
 const sign=value=>createHmac('sha256',secret).update(value).digest('hex');
 function token(lang){const value=lang+'.'+(Date.now()+3600e3);return value+'.'+sign(value);}
 function verify(value,lang){if(typeof value!=='string'||value.length>120)return false;const parts=value.split('.');if(parts.length!==3||parts[0]!==lang||Number(parts[1])<Date.now())return false;const sig=Buffer.from(parts[2],'hex'),expected=Buffer.from(sign(parts[0]+'.'+parts[1]),'hex');return sig.length===expected.length&&timingSafeEqual(sig,expected);}
 async function record({type,lang,key},req){
  if(/bot|crawler|spider|headless/i.test(req.headers['user-agent']||''))return;
  const now=Date.now(),ip=req.socket.remoteAddress;
  for(const [id,r]of limits)if(r.until<now)limits.delete(id);
  const rate=limits.get(ip)||{count:0,until:now+60e3};if(rate.count>=120)return;rate.count++;if(limits.size<10000||limits.has(ip))limits.set(ip,rate);
  const op=queue.then(async()=>{const next=structuredClone(days),date=new Date().toISOString().slice(0,10);for(const day of Object.keys(next))if(day<new Date(Date.now()-89*864e5).toISOString().slice(0,10))delete next[day];
   const day=next[date]||{views:{ar:0,en:0},clicks:{}};
   if(type==='view')day.views[lang]=(day.views[lang]||0)+1;else day.clicks[key]=(day.clicks[key]||0)+1;
   next[date]=day;await writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await rename(file+'.tmp',file);days=next;});queue=op.catch(()=>{});return op;
 }
 function report(range=30){const from=new Date(Date.now()-(range-1)*864e5).toISOString().slice(0,10),rows=[];let views=0,clicks=0;const languages={ar:0,en:0},cards={};
 for(let i=range-1;i>=0;i--){const date=new Date(Date.now()-i*864e5).toISOString().slice(0,10),d=days[date]||{views:{ar:0,en:0},clicks:{}};const v=(d.views.ar||0)+(d.views.en||0),c=Object.values(d.clicks).reduce((a,b)=>a+b,0);views+=v;clicks+=c;for(const lang of ['ar','en'])languages[lang]+=d.views[lang]||0;for(const [key,count]of Object.entries(d.clicks))cards[key]=(cards[key]||0)+count;rows.push({date,views:v,clicks:c});}
 return {range,from,views,clicks,languages,days:rows,cards};}
 return {token,verify,record,report};
}
