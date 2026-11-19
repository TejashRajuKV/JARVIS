'use strict';
const assert=require('./lib/assertions')('office-exports');
const O=require('../office-exports'),D=require('../doctext');
(async()=>{
 assert.throws(()=>O.filename('../secret','docx'),/simple/);
 assert.throws(()=>O.formula('WEBSERVICE(A1)',10,3),/Unsupported/);
 assert.throws(()=>O.formula('SUM(A1:A9999)',10,3),/outside/);
 assert.equal(O.formula('SUM(B2:B3)',4,3),'SUM(B2:B3)');
 const doc=await O.generate({kind:'docx',title:'DBMS — ಕನ್ನಡ',text:'Joins combine relations.\nFriday: test the joins.',sources:['Notes, page 2']});
 assert.equal(doc.extension,'docx');
 assert.ok(D.extractDocText('fixture.docx',doc.buffer).pages.join(' ').includes('Joins combine relations.'));
 const deck=await O.generate({kind:'pptx',title:'DBMS',slides:[{title:'Joins',bullets:['Inner joins','Outer joins']}]});
 assert.equal(deck.summary.slides,1);
 assert.ok(D.extractDocText('fixture.pptx',deck.buffer).pages.join(' ').includes('Outer joins'));
 const output=await O.generate({kind:'xlsx',title:'Scores',columns:['Subject','Score','Double'],rows:[['DBMS',80,''],['DBMS',90,''],['OS',70,'']],groupBy:'Subject',valueColumn:'Score',chart:true,formulas:[{cell:'C2',formula:'B2*2'}]});
 const book=new (require('exceljs').Workbook)();await book.xlsx.load(output.buffer);
 assert.equal(book.getWorksheet('Data').getCell('B2').value,80);
 assert.equal(book.getWorksheet('Data').getCell('C2').value.formula,'B2*2');
 assert.equal(book.getWorksheet('Grouped summary').getCell('C2').value,170);
 assert.equal(book.getWorksheet('Grouped summary').getCell('D2').value,85);
 assert.equal(book.getWorksheet('Grouped summary').getImages().length,1);
 assert.ok(D.extractDocText('fixture.xlsx',output.buffer).pages.length>0);
 const csv=O.grid({csv:'Subject,Score\nDBMS,80\nOS,70'});assert.equal(csv.columns[0],'Subject');
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-export-stop-'));let handler,released=0;
 try {
  O.register({post:(_p,h)=>handler=h,get(){}},{SANDBOX:root,safePath:name=>path.join(root,name),
   control:{operation:()=>({check(){throw Error('Stopped during generation');},release(){released++;}})}});
  const response={status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
  await handler({body:{kind:'docx',title:'Stopped fixture',text:'No output should be written.'}},response);
  assert.equal(response.code,400);assert.equal(fs.readdirSync(root).length,0,'a stop after generation must prevent the write');assert.equal(released,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 assert.report();
})().catch(error=>{console.error(error);process.exitCode=1;});
