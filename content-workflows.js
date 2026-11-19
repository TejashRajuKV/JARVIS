'use strict';
const fs=require('node:fs'),path=require('node:path');
async function readDocument(name,{safePath,pdfPages,docText}) {
 const file=safePath(name);if(!file)throw Error('Choose a file in an approved project folder.');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>30*1024*1024)throw Error('Choose a regular document under 30MB.');
 let pages;
 if(/\.pdf$/i.test(file)){const result=await pdfPages(file);if(result.scanned)throw Error('This PDF needs local OCR indexing first.');pages=result.pages.map(p=>typeof p==='string'?p:p.text||'');}
 else if(/\.(?:docx|pptx|xlsx)$/i.test(file)){const result=docText(file);if(result.error)throw Error(result.error);pages=result.pages;}
 else if(/\.(?:txt|md|csv|json|js|ts|py|sql|log|html|css)$/i.test(file)){if(stat.size>2*1024*1024)throw Error('Text document exceeds 2MB.');pages=[fs.readFileSync(file,'utf8')];}
 else throw Error('Unsupported document format. Use text, PDF, DOCX, XLSX or PPTX.');
 return {name:path.basename(file),pages:pages.slice(0,300).map((text,i)=>({page:i+1,text:String(text).slice(0,30000)}))};
}
function facts(document) {
 const values=[];
 for(const {page,text}of document.pages){
  for(const [kind,re]of [['amount',/(?:₹|INR|Rs\.?|USD|\$|EUR|€)\s*\d[\d,]*(?:\.\d{1,2})?/gi],['due-date',/\b(?:due|deadline|pay by|submit by)\s*[:\-]?\s*[^\n.]{3,100}/gi],['sender',/^(?:from|sender)\s*:\s*[^\r\n]{1,160}/gmi]]) {
   for(const match of text.matchAll(re)){values.push({kind,value:match[0],quote:match[0],file:document.name,page,offset:match.index});if(values.length>=200)return values;}
  }
 }
 return values;
}
function keywords(document) {
 const counts=new Map(),stop=new Set('the and for with from that this have your you are was were will not can into about also then than their they our any each'.split(' '));
 for(const {page,text}of document.pages)for(const match of text.toLowerCase().matchAll(/[\p{L}\p{M}][\p{L}\p{M}\p{N}_-]{2,}/gu)){if(stop.has(match[0]))continue;const old=counts.get(match[0])||{count:0,pages:new Set()};old.count++;old.pages.add(page);counts.set(match[0],old);}
 return [...counts].sort((a,b)=>b[1].count-a[1].count).slice(0,15).map(([keyword,value])=>({keyword,count:value.count,pages:[...value.pages].slice(0,20)}));
}
function classify(text) {
 const source=String(text||'').slice(0,20000),s=source.toLowerCase();
 const rules=[['urgent',/\b(?:urgent|immediate action|required today|overdue|deadline today)\b/],['spam',/\b(?:you won|lottery winner|claim your prize|guaranteed profit)\b/],['newsletter',/\b(?:unsubscribe|weekly digest|newsletter|view in browser)\b/]];
 for(const [category,re]of rules){const match=re.exec(s);if(match&&!(category==='urgent'&&/\bnot urgent\b/.test(s)))return {category,confidence:.75,evidence:source.slice(match.index,match.index+match[0].length),automaticAction:false};}
 return {category:'personal-or-other',confidence:.5,evidence:null,automaticAction:false};
}
function register(app,options) {
 app.post('/api/content/analyze',async(req,res)=>{try{const document=await readDocument(String(req.body.name||''),options);res.json({success:true,name:document.name,pages:document.pages.length,facts:facts(document),keywords:keywords(document),classification:classify(document.pages.map(p=>p.text).join('\n')),note:'Facts are quoted matches; classifications and keywords are suggestions, not automatic filing decisions.'});}catch(error){res.status(400).json({error:error.message});}});
}
module.exports={register,readDocument,facts,keywords,classify};
