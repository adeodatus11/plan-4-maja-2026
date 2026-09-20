const {JSDOM}=require('jsdom');
const fs=require('fs'), path=require('path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const payload=JSON.parse(fs.readFileSync(path.join(root,'student-changes.json')));
const html=fs.readFileSync(path.join(root,'plan-lekcji-2026-09-07.html'),'utf8');
const source=fs.readFileSync(path.join(root,'student-changes.js'),'utf8');
async function create(data=payload) {
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://plan.szkolamistrzow.info/plan-lekcji-2026-09-07.html?date=2026-09-21#1TFA'});
 dom.window.fetch=async()=>({ok:true,json:async()=>data});
 dom.window.eval(source);
 await new Promise(resolve=>setImmediate(resolve));
 return dom;
}
(async()=>{
 const dom=await create(), doc=dom.window.document;
 const choose=date=>{ const input=doc.getElementById('plan-date');input.value=date;input.dispatchEvent(new dom.window.Event('change')); };
 for(const c of [...payload.substitutions,...payload.transfers]) assert.ok(doc.getElementById(c.className),`Missing class ${c.className}`);
 const dates=[...new Set(payload.substitutions.map(c=>c.date))];
 for(const date of dates){
  choose(date);
  const expected=payload.substitutions.filter(c=>c.date===date).length + payload.transfers.reduce((n,c)=>n+(c.type==='transfer' ? Number(c.date===date)+Number(c.toDate===date) : 0),0);
  const roomFallbacks=doc.querySelectorAll('caption .student-change.room-change').length;
  assert.equal(doc.querySelectorAll('.student-change').length,expected+roomFallbacks, date);
  assert.equal(doc.querySelectorAll('.room-change-cell').length+roomFallbacks,payload.transfers.filter(c=>c.type==='room'&&c.date===date).length);
  for (const c of payload.transfers.filter(c=>c.type==='room'&&c.date===date)) {
   const table=doc.getElementById(c.className);
   assert.ok([...table.querySelectorAll('.room-change-cell')].some(cell=>cell.getAttribute('aria-label')===`Zmiana sali: ${c.fromRoom} na ${c.toRoom}`) || [...table.querySelectorAll('caption .room-change')].some(cell=>cell.textContent.includes(`lekcja ${c.period}`)&&cell.textContent.includes(`sala ${c.fromRoom} → ${c.toRoom}`)), JSON.stringify(c));
  }
  const day=new Date(date+'T12:00:00Z').getUTCDay();
  for(const t of doc.querySelectorAll('table.plan')) {
   assert.equal([...t.tHead.rows[0].cells].filter(c=>!c.hidden).length,3);
   assert.equal(t.tHead.rows[0].cells[day+1].hidden,false);
  }
  const before=doc.querySelector('.table-shell').innerHTML;choose(date);assert.equal(doc.querySelector('.table-shell').innerHTML,before,'No duplicate changes');
 }
 choose('2026-09-21');
 assert.ok(doc.getElementById('1TFA').textContent.includes('Przeniesienie na lekcję 3'));
 doc.getElementById('plan-next').click();
 assert.equal(doc.getElementById('plan-date').value,'2026-09-22');
 assert.ok(!doc.getElementById('1TFA').textContent.includes('Przeniesienie na lekcję 3'));
 assert.ok(dom.window.location.search.includes('2026-09-22'));
 choose('2026-09-26');assert.equal(doc.querySelector('.table-shell').hidden,true);
 // Pierwszy dzień roboczy po paczce — liczony z danych, żeby nie starzał się z każdą nową paczką.
 const nextWeekday=iso=>{const d=new Date(iso+'T12:00:00Z');do{d.setUTCDate(d.getUTCDate()+1);}while([0,6].includes(d.getUTCDay()));return d.toISOString().slice(0,10);};
 const afterPackage=nextWeekday(payload.validTo);
 assert.ok(afterPackage<=doc.getElementById('plan-date').max,`Data kontrolna ${afterPackage} wypada poza okresem planu`);
 choose(afterPackage);assert.equal(doc.querySelectorAll('.student-change').length,0,afterPackage);assert.ok(doc.getElementById('plan-data-status').textContent.includes('Brak opublikowanej'));
 choose('2027-01-01');assert.equal(doc.querySelector('.table-shell').hidden,true);
 console.log('PASS: all dates, all substitutions, transfer source/target, reset, navigation, weekend and publication bounds');
})().catch(e=>{console.error(e);process.exit(1)});
