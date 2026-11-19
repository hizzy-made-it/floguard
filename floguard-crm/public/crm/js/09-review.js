/* ================= REVIEW ================= */
document.getElementById('reviewBtn').addEventListener('click',()=>{
 const p=document.getElementById('pitchBox').value.trim();
 if(!p){ fgNotify('Paste your pitch first.', 'err'); document.getElementById('pitchBox')?.focus(); return; }
 const type=document.getElementById('pitchType').value;
 sendChat('review','Type: '+type+'\n\nPitch:\n'+p);
});

