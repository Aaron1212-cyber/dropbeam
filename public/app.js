const $=id=>document.getElementById(id);
const size=n=>n<1024?`${n} B`:n<1024**2?`${(n/1024).toFixed(1)} KB`:n<1024**3?`${(n/1024**2).toFixed(1)} MB`:`${(n/1024**3).toFixed(2)} GB`;
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function row(file){const el=document.createElement('div');el.className='file-row';const icon=document.createElement('span');icon.className='file-icon';icon.textContent=file.name.includes('.')?file.name.split('.').pop().slice(0,4).toUpperCase():'FILE';const info=document.createElement('div');info.className='file-info';const name=document.createElement('div');name.className='file-name';name.textContent=file.name;name.title=file.name;const bytes=document.createElement('div');bytes.className='file-size';bytes.textContent=size(file.size);info.append(name,bytes);el.append(icon,info);return el;}
if(location.pathname.startsWith('/t/')){
  const base=location.pathname.replace(/\/$/,'');let ended=false;
  async function receive(){try{const response=await fetch(base+'/info');const data=await response.json();if(!response.ok)throw Error(data.error);$('receive-subtitle').textContent=`${data.files.length} ${data.files.length===1?'file':'files'} · ${size(data.files.reduce((sum,f)=>sum+f.size,0))} · ready to download`;$('receive-list').replaceChildren(...data.files.map(file=>{const el=row(file);const a=document.createElement('a');a.className='download';a.textContent='Save ↓';a.href=base+'/file/'+file.id;a.download=file.name;a.setAttribute('aria-label','Download '+file.name);el.append(a);return el;}));$('receive-expiry').textContent='Available until '+new Date(data.expires).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});message('');}catch(e){$('receive-list').replaceChildren();$('receive-subtitle').textContent='No files available.';message(e.message,true);ended=true;}}
  receive();setInterval(()=>{if(!ended)receive();},15000);
}else{
  const auth=location.hash.slice(1)||sessionStorage.getItem('dropbeam-auth');
  if(location.hash){sessionStorage.setItem('dropbeam-auth',auth);history.replaceState(null,'',location.pathname);}
  let state={files:[],share:null},busy=false,filesKey='',addressKey='';
  async function api(route,options={}){const res=await fetch('/api/admin/'+route,{...options,headers:{Authorization:'Bearer '+auth,...options.headers}});const data=await res.json();if(!res.ok)throw Error(data.error);return data;}
  function render(){
    $('total').textContent=state.files.length?`${state.files.length} ${state.files.length===1?'file':'files'} / ${size(state.files.reduce((s,f)=>s+f.size,0))}`:'Nothing selected';
    const nextFilesKey=JSON.stringify(state.files)+busy;
    if(nextFilesKey!==filesKey){filesKey=nextFilesKey;$('file-list').replaceChildren(...state.files.map(file=>{const el=row(file),button=document.createElement('button');button.className='remove';button.textContent='×';button.disabled=busy;button.setAttribute('aria-label','Remove '+file.name);button.onclick=()=>action(()=>api('files/'+file.id,{method:'DELETE'}));el.append(button);return el;}));}
    const active=!!state.share;$('idle').hidden=active;$('active').hidden=!active;$('share').hidden=active;$('end').hidden=!active;$('share').disabled=busy||!state.files.length||!$('address').value;$('pick').disabled=busy;$('address').disabled=busy||active;
    $('live-label').textContent=active?'Ready to scan':'Waiting';$('live-label').classList.toggle('live',active);
    if(active){$('qr').src=state.share.qr;$('share-url').value=state.share.url;$('expiry').textContent=`Scan with your phone’s camera. Link ends at ${new Date(state.share.expires).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}.`;$('download-count').textContent=`${state.share.downloads} download responses completed`;}else{$('qr').removeAttribute('src');$('share-url').value='';}
  }
  async function refresh(){state=await api('state');const selected=$('address').value;const nextAddressKey=JSON.stringify(state.addresses);if(nextAddressKey!==addressKey){addressKey=nextAddressKey;$('address').replaceChildren(...state.addresses.map(a=>{const option=document.createElement('option');option.value=a.address;option.textContent=`${a.address} · ${a.name}`;return option;}));if(state.addresses.some(a=>a.address===selected))$('address').value=selected;}render();if(!state.addresses.length)message('No network found. Connect your PC to Wi-Fi or Ethernet.',true);}
  async function action(fn){if(busy)return;busy=true;message('');render();try{await fn();await refresh();}catch(e){message(e.message,true);}finally{busy=false;render();}}
  $('pick').onclick=()=>$('file-input').click();
  $('file-input').onchange=()=>{upload($('file-input').files);$('file-input').value='';};
  $('share').onclick=()=>action(()=>api('share?address='+encodeURIComponent($('address').value),{method:'POST'}));
  $('address').onchange=render;
  $('end').onclick=()=>action(async()=>{await api('end',{method:'POST'});message('Transfer ended. The old QR code no longer works.');});
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.share.url);message('Link copied.');}catch{$('share-url').select();message('Select and copy the link above.');}};
  function upload(input){const files=Array.from(input);if(!files.length)return;action(async()=>{for(const [i,file] of files.entries()){if(file.size>20*1024**3)throw Error('Files larger than 20 GB need to be split first.');await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/admin/upload');xhr.setRequestHeader('Authorization','Bearer '+auth);xhr.setRequestHeader('X-Filename',encodeURIComponent(file.name));xhr.upload.onprogress=e=>{$('progress').textContent=`Preparing ${i+1}/${files.length}: ${file.name} · ${e.lengthComputable?Math.round(e.loaded/e.total*100)+'%':'…'}`;};xhr.onload=()=>{if(xhr.status===201)resolve();else{try{reject(Error(JSON.parse(xhr.responseText).error));}catch{reject(Error('Could not prepare this file.'));}}};xhr.onerror=()=>reject(Error('Connection lost while preparing file.'));xhr.send(file);});}$('progress').textContent='Files ready to share.';}).finally(()=>{if($('progress').textContent.startsWith('Preparing'))$('progress').textContent='';});}
  for(const event of ['dragenter','dragover'])document.addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('dragover');});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('dropzone').classList.remove('dragover');});
  document.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragover');if(!busy)upload(e.dataTransfer.files);});
  refresh().catch(e=>message(e.message,true));setInterval(()=>{if(!busy)refresh().catch(()=>message('Dropbeam stopped. Restart it on your PC.',true));},4000);
}

// Keyboard interaction stays immediate; pointer presses get a little feedback.
document.addEventListener('keydown',()=>document.documentElement.classList.add('keyboard'));
document.addEventListener('pointerdown',()=>document.documentElement.classList.remove('keyboard'));
