'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const clean=(value,max=10000)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,max);
function filename(value,extension){const name=String(value||'Export').trim();if(!/^[\p{L}\p{N} _.-]{1,100}$/u.test(name)||name.startsWith('.')||name.includes('..'))throw Error('Use a simple export name without paths.');return name.replace(/\.(?:docx|pptx|xlsx)$/i,'')+'-'+crypto.randomBytes(4).toString('hex')+'.'+extension;}
function formula(value,rows,columns){const text=String(value||'').replace(/^=/,'').toUpperCase();if(!/^[A-Z0-9_$()+*/^.,:\s<>=-]{1,500}$/.test(text)||/\b[A-Z]+:[A-Z]+\b/.test(text))throw Error('Use a bounded local arithmetic formula without links or external references.');const allowed=new Set(['SUM','AVERAGE','MIN','MAX','COUNT','COUNTA','IF','ROUND','ABS']);for(const m of text.matchAll(/([A-Z][A-Z0-9_.]*)\s*\(/g))if(!allowed.has(m[1]))throw Error('Unsupported formula function: '+m[1]);for(const m of text.matchAll(/\$?([A-Z]+)\$?(\d+)/g)){let col=0;for(const c of m[1])col=col*26+c.charCodeAt(0)-64;if(+m[2]<1||+m[2]>rows||col>columns)throw Error('Formula references a cell outside this export.');}return text;}
function grid(input){
 if(input.csv){const csv=require('./csvtools').parseCSV(String(input.csv).slice(0,2*1024*1024));if(csv.truncated)throw Error('CSV exceeds export limits; choose a smaller selection.');return grid({columns:csv.header,rows:csv.rows.map(row=>row.map(value=>/^-?(?:0|[1-9]\d{0,13})(?:\.\d+)?$/.test(value)&&Number.isFinite(+value)?+value:value))});}
 const columns=Array.isArray(input.columns)?input.columns.map(c=>clean(c,100)):[];
 const rows=Array.isArray(input.rows)?input.rows:[];
 if(!columns.length||columns.length>100||rows.length>10000||rows.length*columns.length>100000||rows.some(r=>!Array.isArray(r)||r.length>columns.length))throw Error('Provide 1–100 columns, at most 10,000 rows, and at most 100,000 cells.');
 return {columns,rows:rows.map(r=>columns.map((_,i)=>typeof r[i]==='number'&&Number.isFinite(r[i])?r[i]:clean(r[i],2000)))};
}
function groupSummary(columns,rows,groupBy,valueColumn){
 const group=columns.indexOf(groupBy),value=columns.indexOf(valueColumn);if(group<0||value<0)throw Error('Choose existing grouping and numeric value columns.');
 const totals=new Map();for(const row of rows){const number=Number(row[value]);if(!Number.isFinite(number)||String(row[value]).trim()==='')continue;const key=clean(row[group],200);const old=totals.get(key)||{count:0,sum:0};old.count++;old.sum+=number;totals.set(key,old);}
 return [...totals].map(([key,v])=>[key,v.count,v.sum,v.sum/v.count]);
}
async function generate(input){
 const title=clean(input.title||'JARVIS export',150);
 if(input.kind==='docx'){
  const {Document,Paragraph,HeadingLevel,Packer,Table,TableRow,TableCell}=require('docx');
  const paragraphs=Array.isArray(input.paragraphs)?input.paragraphs:String(input.text||'').split(/\r?\n/);
  if(paragraphs.length>500||paragraphs.some(p=>String(typeof p==='object'?p.text:p).length>10000))throw Error('Use at most 500 paragraphs of 10,000 characters each.');
  const children=[new Paragraph({text:title,heading:HeadingLevel.TITLE}),...paragraphs.map(p=>new Paragraph({text:clean(typeof p==='object'?p.text:p),...(p?.heading?{heading:HeadingLevel.HEADING_1}:{})}))];
  if(input.table){const data=grid(input.table);if(data.rows.length>500||data.columns.length>12)throw Error('For Word tables use at most 500 rows and 12 columns; export wider data to Excel.');children.push(new Table({rows:[data.columns,...data.rows].map(row=>new TableRow({children:row.map(cell=>new TableCell({children:[new Paragraph(String(cell))]}))}))}));}
  if(Array.isArray(input.sources)&&input.sources.length){children.push(new Paragraph({text:'Sources',heading:HeadingLevel.HEADING_1}));for(const source of input.sources.slice(0,50))children.push(new Paragraph(clean(source,1000)));}
  const doc=new Document({creator:'JARVIS',title,styles:{default:{document:{run:{font:'Aptos',size:22},paragraph:{spacing:{after:160}}}}},sections:[{properties:{},children}]});
  return {buffer:await Packer.toBuffer(doc),extension:'docx',summary:{paragraphs:paragraphs.length,title}};
 }
 if(input.kind==='pptx'){
  const PptxGenJS=require('pptxgenjs');const deck=new PptxGenJS();deck.layout='LAYOUT_WIDE';deck.author='JARVIS';deck.subject=title;deck.title=title;deck.lang='en-IN';
  const raw=Array.isArray(input.slides)?input.slides:String(input.text||'').split(/\n\s*\n/).map(block=>{const [heading,...bullets]=block.split(/\r?\n/);return {title:heading,bullets};});
  if(!raw.length||raw.length>40)throw Error('Provide 1–40 slide sections.');
  let count=0;
  for(const row of raw){const bullets=(row.bullets||[]).flatMap(value=>{const words=clean(value,1000).split(/\s+/);const lines=[];let line='';for(const word of words){if((line+' '+word).length>120){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;});
   for(let offset=0;offset<Math.max(1,bullets.length);offset+=6){if(++count>60)throw Error('The content expands beyond 60 slides; shorten the input.');const slide=deck.addSlide();slide.background={color:'07131D'};
    slide.addText(clean(row.title||title,110)+(offset?' (continued)':''),{x:.6,y:.45,w:12.1,h:.8,fontFace:'Aptos Display',fontSize:30,bold:true,color:'42E8F5',breakLine:false});
    slide.addText(bullets.slice(offset,offset+6).map(text=>({text,options:{bullet:{indent:20},breakLine:true}})),{x:.8,y:1.65,w:11.7,h:4.9,fontFace:'Aptos',fontSize:20,color:'E6F4F7',paraSpaceAfterPt:14,margin:0,fit:'shrink'});
    slide.addText(title+'  ·  '+count,{x:.6,y:7,w:12,h:.2,fontSize:9,color:'8DA6AE'});
   }
  }
  return {buffer:Buffer.from(await deck.write({outputType:'nodebuffer',compression:true})),extension:'pptx',summary:{title,slides:count}};
 }
 if(input.kind==='xlsx'){
  const ExcelJS=require('exceljs'),data=grid(input),book=new ExcelJS.Workbook();book.creator='JARVIS';book.calcProperties.fullCalcOnLoad=true;
  const sheet=book.addWorksheet('Data',{views:[{state:'frozen',ySplit:1}]});sheet.addRow(data.columns);sheet.addRows(data.rows);
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF103A46'}};
  sheet.autoFilter={from:{row:1,column:1},to:{row:data.rows.length+1,column:data.columns.length}};
  sheet.columns.forEach((column,i)=>column.width=Math.min(45,Math.max(14,data.columns[i].length+3)));
  if(input.formulas){if(!Array.isArray(input.formulas)||input.formulas.length>1000)throw Error('Use at most 1,000 formula cells.');for(const item of input.formulas){if(!/^[A-Z]{1,3}[1-9]\d{0,4}$/.test(item.cell))throw Error('Invalid formula cell.');sheet.getCell(item.cell).value={formula:formula(item.formula,data.rows.length+1,data.columns.length)};}}
  let summary=[];
  if(input.groupBy&&input.valueColumn){summary=groupSummary(data.columns,data.rows,input.groupBy,input.valueColumn);const pivot=book.addWorksheet('Grouped summary');pivot.addRow([input.groupBy,'Count','Sum','Average']);pivot.addRows(summary);pivot.columns.forEach(column=>column.width=22);}
  if(input.chart&&summary.length){const svg=require('./csvtools').barChartSvg({title,items:summary.slice(0,30).map(r=>({label:r[0],value:r[2]})),valueLabel:input.valueColumn});const png=await require('sharp')(Buffer.from(svg)).png().toBuffer();const image=book.addImage({buffer:png,extension:'png'});book.getWorksheet('Grouped summary').addImage(image,{tl:{col:5,row:1},ext:{width:800,height:450}});}
  return {buffer:Buffer.from(await book.xlsx.writeBuffer()),extension:'xlsx',summary:{title,rows:data.rows.length,columns:data.columns.length,groups:summary.length,formulasRecalculateOnOpen:true}};
 }
 throw Error('Choose docx, pptx or xlsx.');
}
function register(app,{SANDBOX,safePath,control}){
 app.post('/api/exports/office',async(req,res)=>{let operation;try{operation=control?.operation();const output=await generate(req.body);operation?.check();const name=filename(req.body.name||req.body.title,output.extension);fs.mkdirSync(path.join(SANDBOX,'Exports'),{recursive:true});const file=safePath('Exports/'+name);if(!file)throw Error('Export directory is outside approved folders.');fs.writeFileSync(file,output.buffer,{flag:'wx'});res.json({success:true,name,url:'/api/exports/files/'+encodeURIComponent(name),bytes:output.buffer.length,...output.summary});}catch(error){res.status(400).json({error:error.message});}finally{operation?.release();}});
 app.get('/api/exports/files/:name',(req,res)=>{if(!/^[\p{L}\p{N} _.-]+\.(?:docx|pptx|xlsx|png|jpg|webp|wav)$/u.test(req.params.name))return res.status(400).json({error:'Invalid export name.'});const file=safePath('Exports/'+req.params.name);if(!file||!fs.existsSync(file))return res.status(404).json({error:'Export not found.'});res.set('Cache-Control','no-store').download(file);});
}
module.exports={generate,register,filename,formula,grid,groupSummary};
