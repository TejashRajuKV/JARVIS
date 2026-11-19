'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
function outputFile(name,extension,{SANDBOX,safePath}){fs.mkdirSync(path.join(SANDBOX,'Exports'),{recursive:true});const simple=String(name||'Media').replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,80)||'Media';const file=safePath('Exports/'+simple+'-'+crypto.randomBytes(5).toString('hex')+'.'+extension);if(!file)throw Error('The export directory is not approved.');return file;}
async function image(body,options) {
 const operation=options.control?.operation();try {
 const input=options.safePath(String(body.name||''));if(!input||!fs.statSync(input).isFile()||fs.statSync(input).size>20*1024*1024)throw Error('Choose an approved image under 20MB.');
 if(!/\.(?:png|jpe?g|webp|gif|tiff?|avif)$/i.test(input))throw Error('Choose a raster image; SVG and remote resources are not accepted.');
 const sharp=require('sharp'),format=String(body.format||'png');if(!['png','jpeg','webp'].includes(format))throw Error('Choose PNG, JPEG or WebP.');
 let pipeline=sharp(fs.readFileSync(input),{limitInputPixels:40*1000*1000});
 if(body.crop){const {left,top,width,height}=body.crop;if(![left,top,width,height].every(Number.isInteger)||left<0||top<0||width<1||height<1)throw Error('Choose a valid integer crop rectangle.');pipeline=pipeline.extract({left,top,width,height});}
 if(body.width||body.height){const width=body.width==null?undefined:Number(body.width),height=body.height==null?undefined:Number(body.height);if([width,height].filter(v=>v!==undefined).some(v=>!Number.isInteger(v)||v<1||v>4096))throw Error('Resize dimensions must be 1–4096 pixels.');pipeline=pipeline.resize({width,height,fit:'inside',withoutEnlargement:false});}
 const buffer=await pipeline.toFormat(format).toBuffer(),metadata=await sharp(buffer).metadata(),file=outputFile(path.basename(input,path.extname(input)),format==='jpeg'?'jpg':format,options);
 operation?.check();fs.writeFileSync(file,buffer,{flag:'wx'});return {success:true,name:path.basename(file),url:'/api/exports/files/'+encodeURIComponent(path.basename(file)),width:metadata.width,height:metadata.height,bytes:buffer.length};
 }finally{operation?.release();}
}
function ffmpegAvailable(run=execFile){return new Promise(resolve=>run(process.env.JARVIS_FFMPEG_PATH||'ffmpeg',['-version'],{windowsHide:true,timeout:5000,maxBuffer:10000},error=>resolve(!error)));}
function convert(body,options) {
 const input=options.safePath(String(body.name||''));if(!input||!fs.statSync(input).isFile()||fs.statSync(input).size>100*1024*1024)throw Error('Choose approved local media under 100MB.');
 if(!/\.(?:mp4|mkv|webm|mp3|wav|flac|ogg|m4a)$/i.test(input))throw Error('Unsupported media container.');
 const start=Number(body.start||0),duration=Number(body.duration||60);if(!Number.isFinite(start+duration)||start<0||duration<=0||duration>720)throw Error('Choose a clip of at most 12 minutes.');
 const file=outputFile(path.basename(input,path.extname(input)),'wav',options),bytes=fs.readFileSync(input);
 return new Promise((resolve,reject)=>{
  const operation=options.control?.operation();
  const child=execFile(process.env.JARVIS_FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-protocol_whitelist','pipe','-i','pipe:0','-ss',String(start),'-t',String(duration),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',file],{windowsHide:true,timeout:120000,maxBuffer:100000},async error=>{
   try{if(error)throw Error(error.code==='ENOENT'?'FFmpeg is not installed. Configure JARVIS_FFMPEG_PATH or install FFmpeg yourself.':'Media conversion failed; no source file was changed.');operation?.check();resolve({file,name:path.basename(file),url:'/api/exports/files/'+encodeURIComponent(path.basename(file)),success:true});}
   catch(error){fs.unlink(file,()=>{});reject(error);}finally{operation?.release();}
  });options.ownedProcesses?.track(child);operation?.signal.addEventListener('abort',()=>child.kill(),{once:true});child.stdin.on('error',()=>{});child.stdin.end(bytes);
 });
}
function register(app,options){
 app.get('/api/media/workflows/status',async(_req,res)=>res.set('Cache-Control','no-store').json({image:true,ffmpeg:await ffmpegAvailable(),whisper:options.whisper?.status()?.installed===true}));
 app.post('/api/media/workflows/image',async(req,res)=>{try{options.control?.assertRunning();res.json(await image(req.body,options));}catch(error){res.status(400).json({error:error.message});}});
 app.post('/api/media/workflows/audio',async(req,res)=>{try{const result=await convert(req.body,options);if(req.body.transcribe){if(!options.whisper)throw Error('Whisper is unavailable.');const text=await options.whisper.transcribe(fs.readFileSync(result.file),{lang:String(req.body.lang||'en')});if(text.error)throw Error(text.error);options.control?.assertRunning();result.text=text.text;}delete result.file;res.json(result);}catch(error){res.status(400).json({error:error.message});}});
}
module.exports={register,image,convert,ffmpegAvailable};
