'use strict';
const $=id=>document.getElementById(id);
const API='https://generativelanguage.googleapis.com';
const S={get key(){return localStorage.key_gemini||''},get lang(){return localStorage.lang||'vi'},get model(){const m=localStorage.model;if(!m||/^gemini-[12]\./.test(m)){localStorage.model='gemini-3.8-flash';return'gemini-3.8-flash'}return m},get tr(){return localStorage.liveTr!=='0'}};
// ---------- IndexedDB ----------
let dbp=new Promise((res,rej)=>{const r=indexedDB.open('ghiamai',1);r.onupgradeneeded=()=>r.result.createObjectStore('rec',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function tx(mode,fn){const db=await dbp;return new Promise((res,rej)=>{const t=db.transaction('rec',mode),s=t.objectStore('rec'),r=fn(s);t.oncomplete=()=>res(r&&r.result);t.onerror=()=>rej(t.error)})}
const dbPut=o=>tx('readwrite',s=>s.put(o)),dbGet=id=>tx('readonly',s=>s.get(id)),dbAll=()=>tx('readonly',s=>s.getAll()),dbDel=id=>tx('readwrite',s=>s.delete(id));
// ---------- Recording ----------
let mr,chunks=[],t0=0,acc=0,tick,marks=[],wake,stream;
const fmt=s=>{s=Math.floor(s);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
const elapsed=()=>acc+(mr&&mr.state==='recording'?(Date.now()-t0)/1000:0);
function pickMime(){for(const m of['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'])if(window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m))return m;return''}
async function lockWake(){try{if('wakeLock'in navigator)wake=await navigator.wakeLock.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&mr&&mr.state!=='inactive')lockWake()});
// ---------- Live text ----------
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let sr,srOn=false,liveFin=[],liveInt='';
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
function liveShow(){const el=$('live');el.innerHTML=liveFin.map(x=>'<span class="t">['+x.t+']</span> '+esc(x.s)+(x.vi?'\n<span class="vi">'+esc(x.vi)+'</span>':'')).join('\n')+(liveInt?'\n<span class="i">'+liveInt.replace(/</g,'&lt;')+'</span>':'');el.scrollTop=el.scrollHeight}
function liveNote(t){$('liveNote').textContent=t;$('liveNote').classList.toggle('hidden',!t)}
function liveStart(){if(!SR)return;srOn=true;try{sr=new SR();sr.lang=localStorage.srLang||'ja-JP';sr.continuous=true;sr.interimResults=true;
 sr.onresult=e=>{liveInt='';for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i],x=r[0].transcript.trim();if(r.isFinal){if(x){const o={t:fmt(elapsed()),s:x};liveFin.push(o);trQueue(o)}}else liveInt+=x}liveShow()};
 sr.onerror=e=>{if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){srOn=false;liveNote('ℹ️ Không hiện được chữ trực tiếp trên máy này, nhưng ghi âm vẫn chạy bình thường.')}};
 sr.onend=()=>{if(liveInt){const o={t:fmt(elapsed()),s:liveInt};liveFin.push(o);trQueue(o);liveInt='';liveShow()}if(srOn&&mr&&mr.state==='recording')setTimeout(()=>{if(srOn&&mr&&mr.state==='recording')try{sr.start()}catch(e){}},250)};
 sr.start()}catch(e){srOn=false;liveNote('ℹ️ Không hiện được chữ trực tiếp, nhưng ghi âm vẫn chạy bình thường.')}}
function liveStop(){srOn=false;if(sr)try{sr.stop()}catch(e){}}
let trPend=[],trBusy=false,trTimer=null,trWarned=false;
function trQueue(o){const l=(sr&&sr.lang)||localStorage.srLang||'ja-JP';if(!S.tr||!S.key||!/^(ja-JP|en-US)$/.test(l))return;trPend.push(o);if(!trTimer)trTimer=setTimeout(trRun,4000)}
async function trRun(){trTimer=null;if(trBusy){trTimer=setTimeout(trRun,1000);return}if(!trPend.length)return;const b=trPend.splice(0);trBusy=true;
 try{const src=b.map((x,i)=>(i+1)+'. '+x.s).join('\n');const out=await gen([{text:'Dịch sang tiếng Việt tự nhiên, chỉ trả bản dịch. Giữ nguyên đánh số từng dòng, mỗi dòng một câu.\n\n'+src}]);
  const ls=out.trim().split(/\n+/).map(s=>s.replace(/^\s*\d+[.)、:]\s*/,'').trim()).filter(Boolean);
  if(ls.length===b.length)b.forEach((x,i)=>x.vi=ls[i]);else b[b.length-1].vi=ls.join(' ');liveShow()}
 catch(e){if(!trWarned){trWarned=true;liveNote('ℹ️ Không dịch được tiếng Việt lúc này, chữ trực tiếp vẫn chạy.')}}
 finally{trBusy=false;if(trPend.length&&!trTimer)trTimer=setTimeout(trRun,4000)}}
const liveText=()=>liveFin.map(x=>'['+x.t+'] '+x.s+(x.vi?'\n    → '+x.vi:'')).join('\n')+(liveInt?'\n'+liveInt:'');
if(!SR)liveNote('ℹ️ Trình duyệt này không hỗ trợ hiện chữ trực tiếp.');
$('btnRec').onclick=async()=>{
 if(mr&&mr.state!=='inactive')return;
 try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}catch(e){return alert('Không truy cập được micro: '+e.message)}
 const mime=pickMime();mr=new MediaRecorder(stream,mime?{mimeType:mime}:{});chunks=[];marks=[];acc=0;
 mr.ondataavailable=e=>e.data.size&&chunks.push(e.data);mr.onstop=finish;mr.start(1000);t0=Date.now();
 tick=setInterval(()=>$('timer').textContent=fmt(elapsed()),500);lockWake();
 $('btnRec').classList.add('recording');liveFin=[];liveInt='';trPend=[];trWarned=false;if(SR){$('live').classList.remove('hidden');liveShow();liveNote('');liveStart();setTimeout(()=>{if(mr&&mr.state==='inactive'){liveStop();liveNote('ℹ️ Chữ trực tiếp xung đột với micro nên đã tắt.')}},1500)}['btnPause','btnMark','btnStop'].forEach(b=>$(b).disabled=false)};
$('btnPause').onclick=()=>{if(mr.state==='recording'){acc+=(Date.now()-t0)/1000;mr.pause();liveStop();$('btnPause').textContent='▶️ Tiếp tục'}else{t0=Date.now();mr.resume();liveStart();$('btnPause').textContent='⏸ Tạm dừng'}};
$('btnMark').onclick=()=>{marks.push(Math.floor(elapsed()));$('btnMark').textContent='🚩 Đánh dấu ('+marks.length+')'};
$('btnStop').onclick=()=>{acc=elapsed();liveStop();mr.stop();stream.getTracks().forEach(t=>t.stop());clearInterval(tick);if(wake)wake.release().catch(()=>{});wake=null;
 $('btnRec').classList.remove('recording');['btnPause','btnMark','btnStop'].forEach(b=>$(b).disabled=true);$('btnPause').textContent='⏸ Tạm dừng';$('btnMark').textContent='🚩 Đánh dấu'};
async function finish(){const type=(mr.mimeType||chunks[0]&&chunks[0].type||'audio/mp4').split(';')[0];await saveNew(new Blob(chunks,{type}),acc,marks.slice(),undefined,liveText());$('timer').textContent='00:00'}
$('fileIn').onchange=async e=>{const f=e.target.files[0];if(!f)return;let type=f.type||guessType(f.name);await saveNew(new Blob([f],{type}),0,[],f.name.replace(/\.[^.]+$/,''));e.target.value=''};
function guessType(n){const x=n.split('.').pop().toLowerCase();return{m4a:'audio/mp4',mp4:'audio/mp4',mp3:'audio/mp3',wav:'audio/wav',aac:'audio/aac',ogg:'audio/ogg',webm:'audio/webm',flac:'audio/flac'}[x]||'audio/mp4'}
async function saveNew(blob,dur,mk,title,live){const d=new Date();const r={id:String(d.getTime()),title:title||'Ghi âm '+d.toLocaleString('vi-VN'),created:d.getTime(),dur,marks:mk,tpl:$('tpl').value,audio:blob,transcript:'',summary:'',qa:[],live:live||''};
 await dbPut(r);render();openDetail(r.id);process(r.id)}
// ---------- Gemini ----------
const TPL={meeting:'cuộc họp',kaigo:'buổi họp bàn giao trong viện dưỡng lão (申し送り, kaigo): chú ý tình trạng từng người được chăm sóc, thuốc, ăn uống, bài tiết, ngã, việc cần theo dõi',interview:'buổi phỏng vấn',lecture:'bài giảng'};
const LANG={vi:'tiếng Việt',ja:'tiếng Nhật',both:'tiếng Việt, sau đó lặp lại toàn bộ bằng tiếng Nhật'};
function b64(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(blob)})}
async function audioPart(blob){const mime=blob.type||'audio/mp4';
 if(blob.size<15*1024*1024)return{inline_data:{mime_type:mime,data:await b64(blob)}};
 const st=await fetch(API+'/upload/v1beta/files',{method:'POST',headers:{'x-goog-api-key':S.key,'X-Goog-Upload-Protocol':'resumable','X-Goog-Upload-Command':'start','X-Goog-Upload-Header-Content-Length':blob.size,'X-Goog-Upload-Header-Content-Type':mime,'Content-Type':'application/json'},body:JSON.stringify({file:{display_name:'rec'}})});
 if(!st.ok)throw new Error('Tải file lỗi: '+await st.text());const url=st.headers.get('x-goog-upload-url');
 const up=await fetch(url,{method:'POST',headers:{'X-Goog-Upload-Offset':'0','X-Goog-Upload-Command':'upload, finalize'},body:blob});
 let f=(await up.json()).file;
 while(f.state==='PROCESSING'){await new Promise(r=>setTimeout(r,3000));f=await(await fetch(API+'/v1beta/'+f.name,{headers:{'x-goog-api-key':S.key}})).json()}
 if(f.state==='FAILED')throw new Error('Google không xử lý được file');return{file_data:{mime_type:f.mimeType||mime,file_uri:f.uri}}}
async function pickModel(){const j=await(await fetch(API+'/v1beta/models?pageSize=200',{headers:{'x-goog-api-key':S.key}})).json();
 const ms=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/','')).filter(n=>/^gemini-[\d.]+-flash$/.test(n));
 ms.sort((a,b)=>parseFloat(b.slice(7))-parseFloat(a.slice(7)));return ms[0]}
async function gen(parts,retry){if(!S.key)throw new Error('Chưa có khoá API. Vào ⚙️ Cài đặt.');
 const r=await fetch(API+'/v1beta/models/'+S.model+':generateContent',{method:'POST',headers:{'x-goog-api-key':S.key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts}]})});
 const j=await r.json();
 if(!r.ok&&!retry&&(r.status===404||/no longer available|not found|not supported/i.test((j.error&&j.error.message)||''))){const m=await pickModel().catch(()=>null);if(m&&m!==S.model){localStorage.model=m;return gen(parts,true)}}
 if(!r.ok)throw new Error((j.error&&j.error.message)||r.status);
 return(j.candidates&&j.candidates[0].content&&j.candidates[0].content.parts||[]).map(p=>p.text||'').join('')}
async function process(id){const r=await dbGet(id);setStatus(id,'⏳ Đang chuyển thành văn bản và tóm tắt... (có thể mất vài phút)');
 try{const ap=await audioPart(r.audio);
  const mk=r.marks.length?'\nNgười dùng đã đánh dấu các mốc quan trọng tại: '+r.marks.map(fmt).join(', ')+'. Hãy chú ý nội dung quanh các mốc này.':'';
  const prompt=`Đây là bản ghi âm một ${TPL[r.tpl]}. Hãy trả lời theo đúng định dạng sau:
===TRANSCRIPT===
Chép lại nguyên văn toàn bộ lời nói bằng ngôn ngữ gốc (thường là tiếng Nhật), chia theo người nói và có mốc thời gian, mỗi dòng dạng: [mm:ss] 話者1: ...
===SUMMARY===
Viết bằng ${LANG[S.lang]}, gồm các mục:
## Tóm tắt
## Ý chính
## Quyết định
## Việc cần làm (ai – việc gì – hạn)
Không bịa thông tin; mục nào không có thì ghi "Không có".${mk}`;
  const out=await gen([ap,{text:prompt}]);const [a,b]=out.split('===SUMMARY===');
  r.transcript=(a||'').replace('===TRANSCRIPT===','').trim();r.summary=(b||out).trim();await dbPut(r);setStatus(id,'');}
 catch(e){setStatus(id,'❌ Lỗi: '+e.message+' — bấm 🔄 Xử lý lại.')}
 render();if(cur===id)fill(await dbGet(id))}
// ---------- UI ----------
let cur=null,statuses={};
function setStatus(id,t){statuses[id]=t;if(cur===id)$('dStatus').textContent=t;render()}
async function render(){const q=$('search').value.toLowerCase();const all=(await dbAll()).sort((a,b)=>b.created-a.created);
 $('list').innerHTML='';all.filter(r=>!q||(r.title+r.transcript+r.summary).toLowerCase().includes(q)).forEach(r=>{const li=document.createElement('li');
  li.innerHTML='<b></b><small></small>';li.querySelector('b').textContent=r.title;
  li.querySelector('small').textContent=new Date(r.created).toLocaleString('vi-VN')+(r.dur?' · '+fmt(r.dur):'')+(statuses[r.id]?' · '+statuses[r.id].slice(0,30):r.summary?' · ✅':'');
  li.onclick=()=>openDetail(r.id);$('list').appendChild(li)});
 if(!all.length)$('list').innerHTML='<li class="small">Chưa có bản ghi nào.</li>'}
$('search').oninput=render;
let url;
async function openDetail(id){cur=id;const r=await dbGet(id);if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(r.audio);$('dAudio').src=url;fill(r);showTab('summary');$('detail').showModal()}
function fill(r){$('dTitle').value=r.title;$('dStatus').textContent=statuses[r.id]||'';$('tab-summary').textContent=r.summary||'(chưa có)';$('tab-transcript').textContent=r.transcript||(r.live?'(đang chờ AI — chữ trực tiếp:)\n'+r.live:'(chưa có)');$('tab-live').textContent=r.live||'(không có)';
 $('dMarks').innerHTML='';r.marks.forEach(s=>{const b=document.createElement('span');b.className='mark';b.textContent='🚩 '+fmt(s);b.onclick=()=>{$('dAudio').currentTime=Math.max(0,s-5);$('dAudio').play()};$('dMarks').appendChild(b)});
 $('answers').innerHTML='';(r.qa||[]).forEach(x=>addQA(x.q,x.a))}
function addQA(q,a){const d=document.createElement('div');d.style.margin='10px 0';d.textContent='❓ '+q+'\n💬 '+a;$('answers').prepend(d)}
function showTab(t){document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));['summary','transcript','live','ask'].forEach(x=>$('tab-'+x).classList.toggle('hidden',x!==t))}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.t));
$('dClose').onclick=()=>{$('detail').close();cur=null;$('dAudio').pause()};
$('dTitle').onchange=async()=>{const r=await dbGet(cur);r.title=$('dTitle').value||r.title;await dbPut(r);render()};
$('dRedo').onclick=()=>process(cur);
$('dDel').onclick=async()=>{if(!confirm('Xoá bản ghi này?'))return;await dbDel(cur);$('dClose').onclick();render()};
async function asText(){const r=await dbGet(cur);return r.title+'\n\n【TÓM TẮT】\n'+r.summary+'\n\n【VĂN BẢN】\n'+r.transcript}
$('dCopy').onclick=async()=>{try{await navigator.clipboard.writeText(await asText());alert('Đã sao chép')}catch(e){alert('Không sao chép được')}};
$('dShare').onclick=async()=>{const t=await asText();if(navigator.share)navigator.share({title:$('dTitle').value,text:t}).catch(()=>{});else alert('Máy không hỗ trợ chia sẻ')};
$('dExport').onclick=async()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([await asText()],{type:'text/plain'}));a.download=$('dTitle').value+'.txt';a.click()};
$('btnAsk').onclick=async()=>{const q=$('q').value.trim();if(!q)return;const r=await dbGet(cur);if(!r.transcript)return alert('Chưa có văn bản');$('btnAsk').disabled=true;
 try{const a=await gen([{text:'Dựa vào bản ghi sau, trả lời câu hỏi bằng tiếng Việt (trừ khi được hỏi bằng ngôn ngữ khác). Nếu bản ghi không có thông tin thì nói rõ.\n\nBẢN GHI:\n'+r.transcript+'\n\nTÓM TẮT:\n'+r.summary+'\n\nCÂU HỎI: '+q}]);
  r.qa=(r.qa||[]).concat({q,a});await dbPut(r);addQA(q,a);$('q').value=''}catch(e){alert('Lỗi: '+e.message)}$('btnAsk').disabled=false};
// settings
$('btnSettings').onclick=()=>{$('sKey').value=S.key;$('sLang').value=S.lang;$('sModel').value=S.model;$('sSr').value=localStorage.srLang||'ja-JP';$('sTr').checked=S.tr;$('settings').showModal()};
$('sSave').onclick=()=>{localStorage.key_gemini=$('sKey').value.trim();localStorage.lang=$('sLang').value;localStorage.srLang=$('sSr').value;localStorage.liveTr=$('sTr').checked?'1':'0';localStorage.model=$('sModel').value.trim()||'gemini-3.8-flash';$('settings').close()};
$('sClose').onclick=()=>$('settings').close();
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();
if('serviceWorker'in navigator){const had=!!navigator.serviceWorker.controller;let rl=false;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had&&!rl){rl=true;location.reload()}});
 navigator.serviceWorker.register('sw.js?v=4',{updateViaCache:'none'}).then(reg=>{reg.update().catch(()=>{});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})})}).catch(()=>{})}
render();if(!S.key)setTimeout(()=>$('btnSettings').onclick(),300);
