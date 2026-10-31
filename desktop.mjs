import { createDropbeam } from './server.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

async function main() {
  let app;
  const firstPort=Number(process.env.PORT||47831);
  for(let offset=0;offset<10;offset++) {
    try { app=await createDropbeam({port:firstPort===0?0:firstPort+offset});break; }
    catch(error) { if(error.code!=='EADDRINUSE')throw error; }
  }
  if(!app)throw Error('No free port found. Close another Dropbeam window and try again.');
  console.log(`\n  Dropbeam\n\n  ${app.localUrl}\n\n  Keep this window open while transferring.\n  Press Enter to stop Dropbeam.\n`);
  if(!process.argv.includes('--no-open'))spawn('explorer.exe',[app.localUrl],{windowsHide:true,stdio:'ignore'}).unref();
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await app.close();process.exit();};
  const input=createInterface({input:process.stdin,output:process.stdout});
  input.once('line',close);
  process.on('SIGINT',close);process.on('SIGTERM',close);
}
main().catch(error=>{
  console.error('Dropbeam could not start: '+error.message+'\nPress Enter to close.');
  createInterface({input:process.stdin,output:process.stdout}).once('line',()=>process.exit(1));
});
