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
 // Nazwa grupy z arkusza musi pasować do planu, inaczej wpis ląduje przy nagłówku.
 // Puste sourceGroups znaczy, że planu nie dało się rozwiązać — to osobny przypadek.
 for(const c of [...payload.substitutions,...payload.transfers]){
  if(!c.groupName||!c.sourceGroups.length) continue;
  assert.ok(c.sourceGroups.some(g=>[c.groupName.toLowerCase(),'cała klasa'].includes(g.toLowerCase())),
   `Grupa nie pokryta planem: ${c.date} ${c.className}|${c.groupName} wobec ${JSON.stringify(c.sourceGroups)}`);
 }
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
 const touches=iso=>payload.transfers.some(c=>c.date===iso||c.toDate===iso);
 // Pierwszy dzień roboczy po paczce, którego nie dotyka żadne przeniesienie.
 let afterPackage=nextWeekday(payload.validTo);
 while(touches(afterPackage)) afterPackage=nextWeekday(afterPackage);
 assert.ok(afterPackage<=doc.getElementById('plan-date').max,`Data kontrolna ${afterPackage} wypada poza okresem planu`);
 choose(afterPackage);assert.equal(doc.querySelectorAll('.student-change').length,0,afterPackage);assert.ok(doc.getElementById('plan-data-status').textContent.includes('Brak opublikowanej'));
 // Przeniesienie celujące poza okres paczki musi być widoczne w nowym miejscu.
 for(const t of payload.transfers.filter(c=>c.type==='transfer'&&(c.toDate<payload.validFrom||c.toDate>payload.validTo))){
  if(t.toDate>doc.getElementById('plan-date').max||[0,6].includes(new Date(t.toDate+'T12:00:00Z').getUTCDay())) continue;
  choose(t.toDate);
  const table=doc.getElementById(t.className);
  assert.ok(table,`Brak tabeli ${t.className}`);
  const marks=[...table.querySelectorAll('.student-change')];
  assert.ok(marks.some(e=>e.textContent.includes(`Przeniesienie na lekcję ${t.toPeriod}`)),
   `Brak znacznika docelowego ${t.className} ${t.toDate} lekcja ${t.toPeriod}`);
  assert.equal(table.querySelectorAll('caption .student-change').length,0,
   `Znacznik docelowy ${t.className} ${t.toDate} trafił przy nagłówku`);
  const st=doc.getElementById('plan-data-status').textContent;
  assert.ok(st.includes('Przeniesienia na')&&st.includes('brak danych o zastępstwach'),
   `Komunikat poza paczką musi mówić o braku danych o zastępstwach: ${st}`);
 }
 // Cel przeniesienia między dniami musi mówić, z którego dnia lekcja przyszła.
 const maxDate=doc.getElementById('plan-date').max, minDate=doc.getElementById('plan-date').min;
 const dayName=iso=>new Intl.DateTimeFormat('pl-PL',{weekday:'long',timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'));
 const genitive={'poniedziałek':'poniedziałku','wtorek':'wtorku','środa':'środy','czwartek':'czwartku','piątek':'piątku','sobota':'soboty','niedziela':'niedzieli'};
 for(const t of payload.transfers.filter(c=>c.type==='transfer'&&c.date!==c.toDate)){
  if(t.toDate<minDate||t.toDate>maxDate||[0,6].includes(new Date(t.toDate+'T12:00:00Z').getUTCDay())) continue;
  choose(t.toDate);
  const table=doc.getElementById(t.className); if(!table) continue;
  const target=[...table.querySelectorAll('.student-change')].find(e=>e.textContent.includes(`Przeniesienie na lekcję ${t.toPeriod}`));
  assert.ok(target,`Brak znacznika docelowego ${t.className} ${t.toDate}`);
  const txt=target.textContent;
  assert.ok(txt.includes(genitive[dayName(t.date)]),`Cel ${t.className} ${t.toDate} nie podaje dnia źródłowego: ${txt}`);
  assert.ok(txt.includes(`lekcja ${t.period}`),`Cel ${t.className} ${t.toDate} nie podaje lekcji źródłowej: ${txt}`);
 }
 // Przeniesienie w obrębie jednego dnia zostaje przy krótkiej formie.
 for(const t of payload.transfers.filter(c=>c.type==='transfer'&&c.date===c.toDate)){
  if([0,6].includes(new Date(t.toDate+'T12:00:00Z').getUTCDay())) continue;
  choose(t.toDate);
  const table=doc.getElementById(t.className); if(!table) continue;
  const target=[...table.querySelectorAll('.student-change')].find(e=>e.textContent.includes(`Przeniesienie na lekcję ${t.toPeriod}`));
  if(target) assert.ok(target.textContent.includes(`z lekcji ${t.period}`),`Cel ${t.className} ${t.toDate} powinien mieć krótką formę: ${target.textContent}`);
 }
 choose('2027-01-01');assert.equal(doc.querySelector('.table-shell').hidden,true);
 console.log('PASS: all dates, all substitutions, transfer source/target, reset, navigation, weekend and publication bounds');
})().catch(e=>{console.error(e);process.exit(1)});
