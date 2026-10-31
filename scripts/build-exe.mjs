import { build } from 'esbuild';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
if(process.platform!=='win32')throw Error('Build this executable on Windows.');
await mkdir('dist',{recursive:true});await mkdir('.runtime/build',{recursive:true});
await build({entryPoints:['desktop.mjs'],outfile:'.runtime/build/desktop.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',define:{'import.meta.url':JSON.stringify(new URL('../server.mjs',import.meta.url).href)}});
const assets=Object.fromEntries(['index.html','receive.html','style.css','app.js'].map(name=>[name,path.resolve('public',name)]));
await writeFile('.runtime/build/sea.json',JSON.stringify({main:path.resolve('.runtime/build/desktop.cjs'),output:path.resolve('.runtime/build/dropbeam.blob'),disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false,execArgvExtension:'none',assets}));
execFileSync(process.execPath,['--experimental-sea-config','.runtime/build/sea.json'],{stdio:'inherit'});
await copyFile(process.execPath,'dist/Dropbeam.exe');
execFileSync(process.execPath,['node_modules/postject/dist/cli.js','dist/Dropbeam.exe','NODE_SEA_BLOB','.runtime/build/dropbeam.blob','--sentinel-fuse','NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'],{stdio:'inherit'});
console.log('Built dist/Dropbeam.exe');
