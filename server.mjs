import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { isSea, getAsset } from 'node:sea';

const root = isSea() ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
const token = () => randomBytes(24).toString('hex');
const local = address => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
const MAX_UPLOAD = 20 * 1024 ** 3;
export async function createDropbeam({port=47831, host='0.0.0.0', lifetime=30*60*1000}={}) {
  const admin = token(), files = new Map(), streams = new Set();
  const temp = await mkdtemp(path.join(tmpdir(), 'dropbeam-'));
  let share = null, revision = 0;
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, list]) => list
    .filter(n => n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
    .map(n => ({name, address:n.address})))
    .sort((a,b) => Number(/virtual|vbox|vmware|ethernet 2/i.test(a.name))-Number(/virtual|vbox|vmware|ethernet 2/i.test(b.name)));
  const metadata = () => [...files.values()].map(({id,name,size}) => ({id,name,size}));
  function revoke() { share = null; revision++; for (const stream of streams) stream.destroy(); streams.clear(); }
  const timer = setInterval(() => { if (share && Date.now() >= share.expires) revoke(); },1000);
  timer.unref();
  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (status, body) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url,'http://localhost'), route = url.pathname;
      const adminRoute = route.startsWith('/api/admin/');
      if (adminRoute && (!local(req.socket.remoteAddress) || req.headers.authorization !== `Bearer ${admin}`)) return send(403,{error:'Open Dropbeam using its local launch link.'});
      if (adminRoute && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`) return send(403,{error:'Origin blocked.'});
      if (route === '/api/admin/state' && req.method === 'GET') {
        if (share && Date.now() >= share.expires) revoke();
        return send(200,{files:metadata(), addresses, share});
      }
      if (route === '/api/admin/upload' && req.method === 'POST') {
        const size = Number(req.headers['content-length']);
        if (!Number.isSafeInteger(size) || size<0 || size>MAX_UPLOAD) return send(413,{error:'Drag uploads are limited to 20 GB. Split larger files first.'});
        const name = decodeURIComponent(req.headers['x-filename'] || 'file').split(/[\\/]/).pop().replace(/[\x00-\x1f]/g,'').slice(0,240) || 'file';
        const id=token(), filename=path.join(temp,id); let count=0;
        const limiter = new Transform({transform(chunk,encoding,cb) { count+=chunk.length; cb(count>MAX_UPLOAD ? new Error('File too large') : null,chunk); }});
        try { await pipeline(req,limiter,createWriteStream(filename,{flags:'wx'})); }
        catch (error) { await rm(filename,{force:true}); throw error; }
        files.set(id,{id,name,path:filename,size:count,temp:true}); revoke();
        return send(201,{files:metadata()});
      }
      if (route.startsWith('/api/admin/files/') && req.method === 'DELETE') {
        const id=route.split('/').pop(), file=files.get(id); revoke();
        if (file?.temp) await rm(file.path,{force:true}); files.delete(id);
        return send(200,{files:metadata()});
      }
      if (route === '/api/admin/share' && req.method === 'POST') {
        if (!files.size) return send(400,{error:'Choose at least one file first.'});
        const address = url.searchParams.get('address');
        if (!addresses.some(a => a.address === address)) return send(400,{error:'Select a local network address.'});
        revoke(); const generation=revision;
        const id=token(), link=`http://${address}:${server.address().port}/t/${id}`;
        const qr=await QRCode.toDataURL(link,{width:280,margin:3,color:{dark:'#161916',light:'#ffffff'}});
        if (generation !== revision) return send(409,{error:'Files changed. Try sharing again.'});
        share={id,url:link,expires:Date.now()+lifetime,qr,downloads:0};
        return send(200,share);
      }
      if (route === '/api/admin/end' && req.method === 'POST') { revoke(); return send(200,{ok:true}); }
      const match=route.match(/^\/t\/([a-f0-9]+)(?:\/(info|file)(?:\/([a-f0-9]+))?)?$/);
      if (match) {
        if (!share || share.id !== match[1] || Date.now()>=share.expires) return send(410,{error:'This transfer has ended. Ask the sender for a new QR code.'});
        if (!['GET','HEAD'].includes(req.method)) return send(405,{error:'Method not allowed.'});
        if (match[2] === 'info') return send(200,{files:metadata(),expires:share.expires});
        if (match[2] === 'file') {
          const file=files.get(match[3]); if (!file) return send(404,{error:'File not found.'});
          const current = share;
          const info=await stat(file.path);
          if (share !== current) return send(410,{error:'Transfer ended.'});
          if (!info.isFile() || info.size!==file.size) return send(409,{error:'The original file changed. Ask the sender to add it again.'});
          let start=0,end=file.size-1,status=200;
          if (req.headers.range) {
            const range=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
            if (!range || (!range[1]&&!range[2])) {res.setHeader('Content-Range',`bytes */${file.size}`);return send(416,{error:'Invalid range.'});}
            if (!range[1]) start=Math.max(0,file.size-Number(range[2]));
            else {start=Number(range[1]);if(range[2])end=Math.min(Number(range[2]),end);}
            if (start>end || start>=file.size) {res.setHeader('Content-Range',`bytes */${file.size}`);return send(416,{error:'Invalid range.'});}
            status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${file.size}`);
          }
          res.writeHead(status,{'Content-Type':'application/octet-stream','Content-Length':Math.max(0,end-start+1),'Accept-Ranges':'bytes','Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`});
          if (req.method==='HEAD' || file.size===0) return res.end();
          const stream=createReadStream(file.path,{start,end}); streams.add(stream);
          try {await pipeline(stream,res);if(share===current) current.downloads++;} finally {streams.delete(stream);}
          return;
        }
      }
      const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
      const asset=match ? 'receive.html' : assets[route];
      if (asset && req.method==='GET') {
        if (route==='/' && !local(req.socket.remoteAddress)) return send(403,{error:'Scan a transfer QR code to receive files.'});
        res.setHeader('Content-Type',asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html; charset=utf-8');
        return res.end(isSea() ? getAsset(asset,'utf8') : await readFile(path.join(root,'public',asset)));
      }
      send(404,{error:'Not found.'});
    } catch(error) {
      if (!res.headersSent && !res.destroyed) send(500,{error:error.code==='ENOENT'?'The original file is no longer available.':error.code==='ENOSPC'?'Not enough disk space for a local copy.':'Could not finish this operation. Please try again.'});
      else res.destroy();
    }
  });
  server.requestTimeout=0;
  try { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);}); }
  catch(error) { clearInterval(timer);await rm(temp,{recursive:true,force:true});throw error; }
  const localUrl=`http://127.0.0.1:${server.address().port}/#${admin}`;
  async function close() {clearInterval(timer);revoke();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
  return {server,admin,localUrl,close};
}
async function runCli() {
  const app=await createDropbeam({port:Number(process.env.PORT||47831)});
  console.log(`Dropbeam is ready: ${app.localUrl}\nKeep this process running while transferring.`);
  if(process.argv.includes('--open')) spawn('explorer.exe',[app.localUrl],{windowsHide:true,stdio:'ignore'}).unref();
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit();});
}
if (!isSea() && process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) runCli().catch(error=>{console.error(error.message);process.exitCode=1;});
