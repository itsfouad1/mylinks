import {initial} from './seed.mjs';
export const english = structuredClone(initial);
Object.assign(english.profile,{name:'Fouad Adel',bio:'I build websites and systems that turn ideas into useful solutions.'});
const titles=[['Explore my work','Projects and systems I have built'],['GitHub','Code and projects'],['LinkedIn','My professional journey'],["Let’s build something",'Get in touch'],['Instagram','Notes from my journey']];
english.links.forEach((x,i)=>Object.assign(x,{title:titles[i][0],description:titles[i][1]}));
english.projects.forEach((x,i)=>Object.assign(x,{title:i?'Learning Path':'Athar',description:i?'Personalized learning paths for career goals.':'A lasting digital presence for small businesses.'}));
export function migrateContent(content){
 if(content?.locales)return content;
 return {locales:{ar:{...structuredClone(content),resources:content.resources||[]},en:{...structuredClone(english),resources:[]}}};
}
