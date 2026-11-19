/* ================= REVIEW ================= */
document.getElementById('reviewBtn').addEventListener('click',()=>{
 const p=document.getElementById('pitchBox').value.trim();
 if(!p){ alert('Paste your pitch first.'); return; }
 const type=document.getElementById('pitchType').value;
 sendChat('review','Type: '+type+'\n\nPitch:\n'+p);
});

