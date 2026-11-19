'use strict';
const assert=require('./lib/assertions')('reviewed-execution');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {createExecution}=require('../reviewed-execution');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-execute-')),config={};let ran=0,source;
 const control=require('../task-control').createControl();
 const executor=createExecution({SANDBOX:root,safePath:name=>name===root?root:null,getConfig:()=>config,saveConfig(){},control,run:(program,args,options,done)=>{
  ran++;source=fs.readFileSync(args[0],'utf8');assert.equal(options.cwd,root);assert.ok(!options.shell);const child=new EventEmitter();child.kill=()=>{};setImmediate(()=>done(null,'42\n',''));return child;
 }});
 try{
  await assert.rejects(()=>executor.execute({}),/Enable/);
  const enable=executor.configure({enabled:true});assert.equal(enable.status,409);
  executor.configure({enabled:true,approved:true,approvalToken:enable.body.approvalToken});
  const input={program:'node',code:'console.log(42)',cwd:root,args:[],timeoutMs:1000};
  const preview=await executor.execute(input);assert.equal(preview.status,409);assert.equal(ran,0);
  const wrong=await executor.execute({...input,code:'console.log(99)',approved:true,approvalToken:preview.body.approvalToken});assert.equal(wrong.status,409);assert.equal(ran,0);
  const result=await executor.execute({...input,approved:true,approvalToken:preview.body.approvalToken});assert.equal(result.body.stdout,'42\n');assert.equal(source,input.code);
  assert.equal(fs.readdirSync(path.join(root,'.execution')).length,0,'temporary reviewed source is removed');
  assert.equal((await executor.execute({...input,approved:true,approvalToken:preview.body.approvalToken})).status,409);
  const beforeStop=await executor.execute(input);control.stop();control.resume();
  assert.equal((await executor.execute({...input,approved:true,approvalToken:beforeStop.body.approvalToken})).status,409);
  await assert.rejects(()=>executor.execute({...input,cwd:'C:\\Windows'}),/approved/);
  await assert.rejects(()=>executor.execute({...input,program:'powershell'}),/Node/);
  assert.equal(executor.status().isolated,false,'never describe working-directory restrictions as OS isolation');
  const native=createExecution({SANDBOX:root,safePath:name=>name===root?root:null,getConfig:()=>config,saveConfig(){},control});
  const standalone={program:'node',code:'console.log(process.argv[2])',args:['fixture argument 42'],cwd:root,timeoutMs:5000};
  const nativeOffer=await native.execute(standalone);
  const real=await native.execute({...standalone,approved:true,approvalToken:nativeOffer.body.approvalToken});
  assert.equal(real.body.success,true);assert.equal(real.body.stdout.trim(),'fixture argument 42');
  const hung={...standalone,code:'setInterval(()=>{},1000)',args:[],timeoutMs:100};
  const timeoutOffer=await native.execute(hung);
  const timeout=await native.execute({...hung,approved:true,approvalToken:timeoutOffer.body.approvalToken});
  assert.equal(timeout.body.timedOut,true);assert.equal(timeout.body.success,false);
  assert.equal(fs.readdirSync(path.join(root,'.execution')).length,0);
  assert.report();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
