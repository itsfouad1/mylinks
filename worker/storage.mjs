import {initial} from '../seed.mjs';
import {migrateContent} from '../content.mjs';
import {validateContent,fail} from './validation.mjs';
const initialJson=JSON.stringify(validateContent(migrateContent(initial)));
export async function getState(db){
 let row=await db.prepare('SELECT * FROM content WHERE id=1').first();
 if(!row){await db.prepare('INSERT OR IGNORE INTO content(id,draft,published,revision) VALUES(1,?,?,0)').bind(initialJson,initialJson).run();row=await db.prepare('SELECT * FROM content WHERE id=1').first();}
 return {draft:JSON.parse(row.draft),published:JSON.parse(row.published),revision:row.revision,publishedAt:row.published_at};
}
export async function saveDraft(db,input){
 if(!Number.isSafeInteger(input.revision)||input.revision<0)throw fail(400,'رقم المراجعة غير صالح.');
 if(!input.content?.locales)throw fail(400,'المحتوى العربي والإنجليزي مطلوب.');
 const content=validateContent(input.content),json=JSON.stringify(content);
 if(new TextEncoder().encode(json).length>512*1024)throw fail(413,'محتوى الصفحة أكبر من الحد المسموح.');
 const row=await db.prepare('UPDATE content SET draft=?,revision=revision+1 WHERE id=1 AND revision=? RETURNING revision').bind(json,input.revision).first();
 if(!row)throw fail(409,'تغيّرت البيانات في نافذة أخرى. أعد تحميل الصفحة قبل الحفظ.');return row;
}
export async function publish(db,input){
 if(!Number.isSafeInteger(input.revision)||input.revision<0)throw fail(400,'رقم المراجعة غير صالح.');
 const publishedAt=new Date().toISOString(),row=await db.prepare('UPDATE content SET published=draft,published_at=?,revision=revision+1 WHERE id=1 AND revision=? RETURNING revision').bind(publishedAt,input.revision).first();
 if(!row)throw fail(409,'المسودة تغيّرت. أعد تحميل الصفحة.');return {...row,publishedAt};
}
export async function report(db,range){
 const from=new Date(Date.now()-(range-1)*864e5).toISOString().slice(0,10),today=new Date().toISOString().slice(0,10);
 const {results}=await db.prepare('SELECT day,lang,kind,card_id,count FROM analytics WHERE day >= ? AND day <= ? ORDER BY day').bind(from,today).all();
 const days=Array.from({length:range},(_,i)=>({date:new Date(Date.now()-(range-1-i)*864e5).toISOString().slice(0,10),views:0,clicks:0}));const map=new Map(days.map(d=>[d.date,d]));const output={range,from,views:0,clicks:0,languages:{ar:0,en:0},days,cards:{}};
 for(const row of results){const day=map.get(row.day);if(!day)continue;if(row.kind==='view'){day.views+=row.count;output.views+=row.count;output.languages[row.lang]+=row.count;}else{day.clicks+=row.count;output.clicks+=row.count;const key=JSON.stringify([row.lang,row.kind,row.card_id]);output.cards[key]=(output.cards[key]||0)+row.count;}}
 return output;
}
export async function cleanup(env){const db=env.DB.withSession('first-primary');const cutoff=new Date(Date.now()-89*864e5).toISOString().slice(0,10);await db.batch([db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(Date.now()),db.prepare('DELETE FROM analytics WHERE day < ?').bind(cutoff),db.prepare('DELETE FROM import_chunks WHERE created_at < ?').bind(Date.now()-864e5)]);}
