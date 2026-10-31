import {spawn} from 'node:child_process';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
const directory=await mkdtemp(path.join(tmpdir(),'dropbeam-exe-test-'));
await copyFile(new URL('../dist/Dropbeam.exe',import.meta.url),path.join(directory,'Dropbeam.exe'));
const child=spawn(path.join(directory,'Dropbeam.exe'),['--no-open'],{cwd:directory,env:{...process.env,PORT:'0',PATH:''},windowsHide:true,stdio:['pipe','pipe','pipe']});
const timeout=setTimeout(()=>{child.kill();},20000);
try {
 let output='';const url=await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]+)/);if(match)resolve(new URL(match[0]));});child.once('error',reject);child.once('exit',()=>reject(Error('Executable exited before startup: '+output)));});
 const auth=url.hash.slice(1),base=url.origin;
 const api=(route,options={})=>fetch(base+'/api/admin/'+route,{...options,headers:{Authorization:'Bearer '+auth,...options.headers}});
 for(const asset of ['/','/app.js','/style.css'])assert.equal((await fetch(base+asset)).status,200);
 assert.ok((await (await fetch(base)).text()).includes('From your PC.'));
 const payload=Buffer.alloc(1024*1024,42);
 assert.equal((await api('upload',{method:'POST',body:payload,headers:{'X-Filename':'exe-test.bin'}})).status,201);
 const state=await (await api('state')).json();const response=await api('share?address='+state.addresses[0].address,{method:'POST'});assert.equal(response.status,200);const share=await response.json();assert.ok(share.qr.startsWith('data:image/png;base64,'));
 assert.equal((await fetch(base+'/t/'+share.id)).status,200);
 assert.deepEqual(Buffer.from(await (await fetch(base+'/t/'+share.id+'/file/'+state.files[0].id)).arrayBuffer()),payload);
 const exit=once(child,'exit');child.stdin.write('\n');await exit;
 console.log('Standalone EXE passed: isolated folder, empty PATH, embedded pages, QR generation, 1 MB transfer, clean shutdown.');
} finally {clearTimeout(timeout);if(child.exitCode===null){child.kill();await once(child,'exit');}await rm(directory,{recursive:true,force:true});}
