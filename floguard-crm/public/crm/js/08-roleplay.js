/* ================= ROLEPLAY ================= */
function currentRoleplayPrompt(){
 const sc=SCENARIOS.find(s=>s.id===rpActive)||SCENARIOS[0];
 const productLine = sc.product || 'FrenchDrain';
 const packHint = formatKnowledgeForPrompt(productLine);
 const diff=document.getElementById('difficulty').value;
 const diffLine= diff.startsWith('Beginner') ? 'Difficulty is Beginner: be a little forgiving, raise soft objections, and warm up quickly to decent technique.'
 : diff.startsWith('Advanced') ? 'Difficulty is Advanced: be brutal and realistic - interrupt, threaten to hang up, stack objections, and only a genuinely excellent rep earns the close.'
 : 'Difficulty is Intermediate: realistic resistance, two or three solid objections, reward good technique honestly.';
 return ROLEPLAY_PROMPT_BASE+'\n\nYOUR CHARACTER: '+sc.persona+'\n\n'+diffLine+'\n\nProduct context for this scenario (the rep is selling this — react realistically to correct vs wrong pricing):\nProduct line: '+productLine+packHint;
}
(function initRp(){
 const sel=document.getElementById('scenarioSel');
 sel.innerHTML=SCENARIOS.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('');
 sel.addEventListener('change',()=>{ const sc=SCENARIOS.find(s=>s.id===sel.value); document.getElementById('personaDesc').textContent=sc.desc; });
 document.getElementById('personaDesc').textContent=SCENARIOS[0].desc;
})();
document.getElementById('startRp').addEventListener('click',async ()=>{
 rpActive=document.getElementById('scenarioSel').value;
 chats.roleplay=[]; saveChats(); restore('roleplay');
 const sc=SCENARIOS.find(s=>s.id===rpActive);
 addMsg('roleplay','system','📞 Ringing… Scenario: '+sc.title+' ('+document.getElementById('difficulty').value+'). You opened the call — go.');
 // Prospect answers the phone first
 chats.roleplay.push({role:'user',content:'(The phone rings. Answer it in character, briefly, like a busy owner.)'}); saveChats();
 try{ const {content,meta}=await callOpenAI('roleplay',currentRoleplayPrompt(),chats.roleplay,''); chats.roleplay.push({role:'assistant',content,meta}); saveChats(); }catch(e){}
});
document.getElementById('gradeRp').addEventListener('click',async ()=>{
 if(!(chats.roleplay||[]).filter(m=>m.role==='user'&&!m.content.startsWith('(The phone rings')).length){ addMsg('roleplay','system','Nothing to grade yet — run the call first.'); return; }
 addMsg('roleplay','system','🏁 Roleplay ended. Coach is grading the call…');
 const sc=SCENARIOS.find(s=>s.id===rpActive)||SCENARIOS[0];
 const productLine = sc.product || 'FrenchDrain';
 const gradeSys = GRADE_PROMPT + formatKnowledgeForPrompt(productLine);
 const transcript=chats.roleplay.map(m=>(m.role==='user'?'REP: ':'PROSPECT: ')+m.content).join('\n');
 const history=[{role:'user',content:'Here is the transcript of my cold call roleplay. Grade it against the correct product playbook ('+productLine+').\n\n'+transcript}];
 try{
 const {content,meta}=await callOpenAI('roleplay',gradeSys,history,'grade '+transcript.slice(0,200));
 chats.roleplay.push({role:'assistant',content,meta}); saveChats();
 }catch(e){}
 rpActive=null;
});

