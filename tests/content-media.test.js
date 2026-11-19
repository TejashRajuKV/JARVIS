'use strict';
const assert=require('./lib/assertions')('content-media'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const content=require('../content-workflows'),media=require('../media-workflows');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-content-'));
 const safePath=name=>{const resolved=path.resolve(root,name);return resolved.startsWith(root+path.sep)?resolved:null;};
 try{
  fs.writeFileSync(path.join(root,'receipt.txt'),'From: Rahul\nAmount: INR 1,250.50\nDue: 2026-11-30\nDatabase joins database joins');
  const doc=await content.readDocument('receipt.txt',{safePath});
  const facts=content.facts(doc);assert.ok(facts.some(f=>f.kind==='amount'&&f.quote==='INR 1,250.50'));
  assert.ok(facts.every(f=>doc.pages[f.page-1].text.slice(f.offset,f.offset+f.quote.length)===f.quote));
  assert.equal(content.keywords(doc)[0].keyword,'database');
  assert.equal(content.classify('URGENT: required today').category,'urgent');
  assert.equal(content.classify('Not urgent: notes').category,'personal-or-other');
  assert.equal(content.classify('Weekly newsletter — unsubscribe').category,'newsletter');
  await assert.rejects(()=>content.readDocument('../outside.txt',{safePath}),/approved/);
  const sharp=require('sharp');await sharp({create:{width:40,height:20,channels:3,background:'#00ccff'}}).png().toFile(path.join(root,'sample.png'));
  const resized=await media.image({name:'sample.png',width:20,format:'webp'},{SANDBOX:root,safePath});
  assert.equal(resized.width,20);assert.equal(resized.height,10);assert.equal(fs.existsSync(path.join(root,'Exports',resized.name)),true);
  assert.equal((await sharp(path.join(root,'sample.png')).metadata()).width,40,'source image is preserved');
  await assert.rejects(()=>media.image({name:'../outside.png',width:20},{SANDBOX:root,safePath}),/approved/);
  const before=fs.readdirSync(path.join(root,'Exports')).length;let released=0;
  await assert.rejects(()=>media.image({name:'sample.png',width:10},{SANDBOX:root,safePath,
    control:{operation:()=>({check(){throw Error('Stopped during image processing');},release(){released++;}})}}),/Stopped/);
  assert.equal(fs.readdirSync(path.join(root,'Exports')).length,before,'stopped processing cannot write a new image');assert.equal(released,1);
  assert.report();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
