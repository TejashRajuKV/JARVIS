'use strict';
const a=require('./lib/assertions')('owner-actions'),crypto=require('node:crypto'),setup=require('../hello');
const routes=new Map();let guard;
const key=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'}),origin='http://localhost:3002';
const config={hello:{required:true,credId:'fixture',alg:-7,spki:key.publicKey.export({type:'spki',format:'der'}).toString('base64')}};
setup({use:f=>guard=f,get:(p,f)=>routes.set(p,f),post:(p,f)=>routes.set(p,f)},{getConfig:()=>config,saveConfig(){},ALLOWED_ORIGINS:new Set([origin])});
function response(){return {code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
function guarded(body,token,path='/api/browser/action'){const r=response();let ran=false;guard({method:'POST',path,body,headers:{'x-hello-token':token}},r,()=>ran=true);return {...r,ran};}
function proof(purpose){let r=response();routes.get('/api/hello/challenge')({body:{purpose}},r);a.equal(r.code,200);
 const challenge=r.body.challenge,cd=Buffer.from(JSON.stringify({type:'webauthn.get',origin,challenge,crossOrigin:false}));
 const ad=Buffer.concat([crypto.createHash('sha256').update('localhost').digest(),Buffer.from([5,0,0,0,1])]);
 const signature=crypto.sign('sha256',Buffer.concat([ad,crypto.createHash('sha256').update(cd).digest()]),key.privateKey);
 r=response();routes.get('/api/hello/verify')({body:{purpose,credId:'fixture',authenticatorData:ad.toString('base64'),clientDataJSON:cd.toString('base64'),signature:signature.toString('base64')}},r);a.equal(r.code,200);return r.body.token;}
const body={approved:true,approvalToken:'one-time',controlId:'save',action:'click'};
a.equal(guarded({action:'click'}).ran,true,'preview does not authenticate or execute a side effect');
const pending=guarded(body);a.equal(pending.code,403);a.match(pending.body.purpose,/^act[a-f0-9]{17}$/);
let token=proof(pending.body.purpose);a.equal(guarded({...body,controlId:'delete'},token).ran,false,'another target cannot use this proof');a.equal(guarded(body,token).ran,false,'failed use consumes proof');
token=proof(pending.body.purpose);a.equal(guarded(body,token,'/api/desktop/action').ran,false,'another endpoint cannot use proof');
token=proof(pending.body.purpose);a.equal(guarded(body,token).ran,true);a.equal(guarded(body,token).ran,false,'proof is one-time');
a.report();
