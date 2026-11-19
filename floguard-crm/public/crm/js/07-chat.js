/* ================= CHAT ENGINE ================= */
function addMsg(mode,role,content,meta){
 const wrap=document.getElementById('msgs-'+mode);
 const d=document.createElement('div');
 d.className='msg '+(role==='user'?'u':role==='system'?'sys':'a');
 d.textContent=content;
 if(meta){ const m=document.createElement('span'); m.className='meta'; m.textContent=meta; d.appendChild(m); }
 wrap.appendChild(d); wrap.scrollTop=wrap.scrollHeight;
 return d;
}
function restore(mode){
 const wrap=document.getElementById('msgs-'+mode); wrap.innerHTML='';
 (chats[mode]||[]).forEach(m=>addMsg(mode,m.role==='assistant'?'a':m.role,m.content,m.meta));
 if(!(chats[mode]||[]).length){
 const hello={coach:"Coach here. Ask me anything, hit a quick drill on the left, or open a lead from the tracker and press its Coach button — I'll build you the exact call plan.",
 roleplay:"Pick a scenario on the left and press Start. I'll become the prospect and answer the phone. When you're done, press End & Get Graded.",
 review:"Paste a pitch above and press Review — you'll get a score out of 100 and coffee-chat coaching on exactly what to sharpen."}[mode];
 addMsg(mode,'system',hello);
 }
}
async function callOpenAI(mode,systemPrompt,history,userText){
 if(currentUser&&(currentUser.locked||(currentUser.tokens_used>=currentUser.tokens_limit))){
 showUsageLock(); throw new Error('TOKEN_LIMIT');
 }
 const {model,auto}=pickModel(mode,userText);
 const messages=[{role:'system',content:systemPrompt},...history.map(m=>({role:m.role,content:m.content}))];
 const body={model,messages,mode};
 if(!/^o\d/.test(model)){ body.temperature=(mode==='roleplay')?0.9:0.7; body.max_tokens=900; }
 else body.max_completion_tokens=1400;
 const holder=addMsg(mode,'a','…thinking');
 try{
 const r=await fetch('/crm/api/academy-chat',{
 method:'POST',
 headers:{'Content-Type':'application/json','Authorization':'Bearer '+(getToken()||'')},
 body:JSON.stringify(body)
 });
 const raw=await r.text();
 let data=null;
 try{ data=JSON.parse(raw); }catch(e){}
 if(!r.ok){
 const det=data?.detail;
 if(r.status===402||(det&&det.error==='TOKEN_LIMIT')||(typeof det==='object'&&det?.error==='TOKEN_LIMIT')){
 if(currentUser){ currentUser.locked=true; if(det){ currentUser.tokens_used=det.tokens_used??currentUser.tokens_used; currentUser.tokens_limit=det.tokens_limit??currentUser.tokens_limit; } }
 updateTokenPill(); showUsageLock();
 holder.remove(); addMsg(mode,'system','Token limit reached — AI paused until admin approves more usage.'); throw new Error('TOKEN_LIMIT');
 }
 let msg='AI error '+r.status;
 if(typeof det==='string') msg+=': '+det;
 else if(det?.message) msg+=': '+det.message;
 else if(det?.error) msg+=': '+(typeof det.error==='string'?det.error:JSON.stringify(det.error));
 else if(data?.error?.message) msg+=': '+data.error.message;
 else if(data?.error) msg+=': '+(typeof data.error==='string'?data.error:JSON.stringify(data.error));
 else msg+=': '+(raw||'').slice(0,200);
 holder.remove(); addMsg(mode,'system',msg); throw new Error(msg);
 }
 if(data?.academy&&currentUser){
 currentUser.tokens_used=data.academy.tokens_used;
 currentUser.tokens_limit=data.academy.tokens_limit;
 currentUser.locked=!!data.academy.locked;
 updateTokenPill();
 if(currentUser.locked) showUsageLock();
 }
 const content=data?.choices?.[0]?.message?.content||'(empty response)';
 holder.remove();
 const meta='via '+model+(auto?' · Auto':'');
 addMsg(mode,'a',content,meta);
 return {content,meta};
 }catch(err){
 if(holder.parentNode) holder.remove();
 if(err.message==='TOKEN_LIMIT') throw err;
 if(!String(err.message||'').startsWith('AI error')) addMsg(mode,'system','Network error reaching AI: '+(err.message||err));
 throw err;
 }
}
function goTabIfHidden(name){ const p=document.getElementById('p-'+name); if(!p.classList.contains('on')) goTab(name); }

async function sendChat(mode,promptText){
 const inp=document.getElementById('in-'+mode);
 const text=(promptText!=null?promptText:inp.value).trim();
 if(!text) return;
 if(promptText==null) inp.value='';
 addMsg(mode,'user',text);
 chats[mode]=chats[mode]||[]; chats[mode].push({role:'user',content:text}); saveChats();
 let sys;
 if(mode==='coach'){
 // If message declares CATEGORY: X, switch active playbook
 const mCat=(text.match(/CATEGORY:\s*(FrenchDrain|SumpPump|YardDrainage|Maintenance|PropertyMgmt)/i)||[])[1];
 if(mCat) lastCoachCategory = categoryKey(mCat);
 const lead = lastCoachLeadId!=null ? state.find(x=>x.id===lastCoachLeadId) : null;
 sys = buildCategoryCoachPrompt(lastCoachCategory||'FrenchDrain', lead);
 } else if(mode==='roleplay') sys = currentRoleplayPrompt();
 else {
 // Pitch review: detect product from type label or CATEGORY line
 const mCat=(text.match(/CATEGORY:\s*(FrenchDrain|SumpPump|YardDrainage|Maintenance|PropertyMgmt)/i)||[])[1];
 const t=(text.match(/Type:\s*(\w+)/i)||[])[1]||'';
 const revCat = mCat ? categoryKey(mCat)
 : /sump|crawl|battery|backup/i.test(t+text.slice(0,200)) ? 'SumpPump'
 : /grading|catch basin|channel drain|lanai|patio|swale/i.test(t+text.slice(0,200)) ? 'YardDrainage'
 : /maintenance|service plan|inspection|monitor/i.test(t+text.slice(0,200)) ? 'Maintenance'
 : /property manage|hoa|landlord|portfolio|rentals/i.test(t+text.slice(0,200)) ? 'PropertyMgmt'
 : 'FrenchDrain';
 sys = REVIEW_PROMPT + formatKnowledgeForPrompt(revCat);
 }
 try{
 const {content,meta}=await callOpenAI(mode,sys,chats[mode],text);
 chats[mode].push({role:'assistant',content,meta}); saveChats();
 if(mode==='roleplay'){ const m=content.match(/score[:\s]+(\d{1,3})\s*\/?\s*100/i)||content.match(/Score:\s*(\d{1,3})/i); if(m) recordPractice('roleplay', Math.min(100,+m[1]), 'roleplay grade'); }
 if(mode==='review'){ const m=content.match(/score[:\s]+(\d{1,3})/i); if(m){ const sc=Math.min(100,+m[1]); document.getElementById('lastScore').textContent=sc; recordPractice('review', sc, 'pitch review'); } }
 }catch(e){ /* already surfaced */ }
}
['coach','roleplay'].forEach(mode=>{
 document.getElementById('send-'+mode).addEventListener('click',()=>sendChat(mode));
 document.getElementById('in-'+mode).addEventListener('keydown',e=>{
 if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(mode); }
 });
 document.getElementById('clear-'+mode).addEventListener('click',()=>{
 if(confirm('Clear this conversation?')){ chats[mode]=[]; saveChats(); if(mode==='roleplay') rpActive=null; restore(mode); }
 });
});
document.getElementById('clear-review').addEventListener('click',()=>{
 if(confirm('Clear review history?')){ chats.review=[]; saveChats(); document.getElementById('lastScore').textContent='—'; restore('review'); }
});
document.querySelectorAll('.qp').forEach(b=>b.addEventListener('click',()=>{ goTab('coach'); sendChat('coach',b.dataset.q); }));

