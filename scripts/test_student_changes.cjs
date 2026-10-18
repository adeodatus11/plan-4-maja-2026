const {JSDOM}=require('jsdom');
const fs=require('fs'), path=require('path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const payload=JSON.parse(fs.readFileSync(path.join(root,'student-changes.json')));
const html=fs.readFileSync(path.join(root,'plan-lekcji-2026-09-07.html'),'utf8');
const source=fs.readFileSync(path.join(root,'student-changes.js'),'utf8');
async function create(data=payload) {
 const dom=new JSDOM(html,{runScripts:'outside-only',url:`https://plan.szkolamistrzow.info/plan-lekcji-2026-09-07.html?date=${payload.validFrom}`});
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
  // Zajęcia w godzinie bez lekcji w planie bazowym idą do pustej kratki, nie pod nagłówek.
  for(const c of payload.substitutions.filter(c=>c.freeSlot&&c.date===date)){
   const cap=doc.getElementById(c.className).caption.textContent;
   assert.ok(!cap.includes(`Zmiana ${c.date}, lekcja ${c.period}${c.groupName?' · '+c.groupName:''}`),`Wolna godzina pod nagłówkiem: ${c.className} ${c.date} l.${c.period} ${c.groupName}`);
  }
  const before=doc.querySelector('.table-shell').innerHTML;choose(date);assert.equal(doc.querySelector('.table-shell').innerHTML,before,'No duplicate changes');
 }
 // Znacznik przeniesienia na jego dzień i sprzątanie po przejściu dalej —
 // przeniesienie dobierane z bieżącej paczki, żeby test nie starzał się z datami.
 const isWeekday=iso=>![0,6].includes(new Date(iso+'T12:00:00Z').getUTCDay());
 const addDay=iso=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
 // Najpierw przeniesienie w oknie paczki, potem dowolne w okresie planu (cel poza
 // oknem też jest pokazywany). Paczka bez przeniesień (np. jeden dzień) też jest
 // poprawna — wtedy sprawdzamy samą nawigację.
 const inPlan=c=>c.type==='transfer'&&isWeekday(c.toDate)&&c.toDate>=doc.getElementById('plan-date').min&&c.toDate<doc.getElementById('plan-date').max&&doc.getElementById(c.className);
 const probe=payload.transfers.find(c=>inPlan(c)&&c.toDate>=payload.validFrom&&c.toDate<=payload.validTo)||payload.transfers.find(inPlan);
 if(probe){
  const mark=`Przeniesienie na lekcję ${probe.toPeriod}`, next=addDay(probe.toDate);
  const sameMarkNextDay=payload.transfers.some(c=>c.className===probe.className&&c.type==='transfer'&&c.toDate===next&&c.toPeriod===probe.toPeriod);
  choose(probe.toDate);
  assert.ok(doc.getElementById(probe.className).textContent.includes(mark),`Brak znacznika ${mark} w ${probe.className} ${probe.toDate}`);
  doc.getElementById('plan-next').click();
  assert.equal(doc.getElementById('plan-date').value,next);
  if(!sameMarkNextDay) assert.ok(!doc.getElementById(probe.className).textContent.includes(mark),`Znacznik z ${probe.toDate} został po przejściu na ${next}`);
  assert.ok(dom.window.location.search.includes(next));
 } else {
  choose(payload.validFrom);
  const next=addDay(payload.validFrom);
  doc.getElementById('plan-next').click();
  assert.equal(doc.getElementById('plan-date').value,next);
  assert.ok(dom.window.location.search.includes(next));
 }
 // Sobota w oknie paczki: brak tabeli, niezależnie od danych.
 let saturday=payload.validFrom; while(new Date(saturday+'T12:00:00Z').getUTCDay()!==6) saturday=addDay(saturday);
 choose(saturday);assert.equal(doc.querySelector('.table-shell').hidden,true,saturday);
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
  // Kilka przeniesień może trafić na tę samą lekcję (np. gr1 i gr2) — szukamy swojego.
  const marks=[...table.querySelectorAll('.student-change')].filter(e=>e.textContent.includes(`Przeniesienie na lekcję ${t.toPeriod}`));
  if(marks.length) assert.ok(marks.some(e=>e.textContent.includes(`(z lekcji ${t.period})`)),`Cel ${t.className} ${t.toDate} powinien mieć krótką formę: ${marks.map(e=>e.textContent).join(' | ')}`);
 }
 // Jednorazowe zmiany dnia: 13.10 skrócone lekcje od 8., 14.10 dzień wolny (DEN).
 const notice=doc.getElementById('plan-special-day');
 const timeOf=(table,period)=>[...table.tBodies[0].rows].find(r=>r.cells[0]?.textContent.trim()===String(period))?.cells[1].textContent.trim();
 choose('2026-10-13');
 assert.equal(doc.querySelector('.table-shell').hidden,false,'13.10 musi pokazywać plan');
 assert.equal(notice.hidden,false,'Brak komunikatu o skróconych lekcjach 13.10');
 for(const t of doc.querySelectorAll('table.plan')){
  for(const [n,expected] of [[7,'13:15 - 14:00'],[8,'14:05 - 14:35'],[9,'14:40 - 15:10'],[10,'15:15 - 15:45'],[11,'15:50 - 16:20'],[12,'16:25 - 16:55'],[13,'17:00 - 17:30'],[14,'17:35 - 18:05']]){
   const got=timeOf(t,n); if(got!==undefined) assert.equal(got,expected,`${t.id} lekcja ${n} 13.10`);
  }
 }
 const before13=doc.querySelector('.table-shell').innerHTML;choose('2026-10-13');assert.equal(doc.querySelector('.table-shell').innerHTML,before13,'Godziny 13.10 nie mogą się dublować');
 choose('2026-10-14');
 assert.equal(doc.querySelector('.table-shell').hidden,true,'14.10 to dzień wolny od zajęć');
 assert.equal(notice.hidden,false);assert.ok(notice.textContent.includes('Dzień Edukacji Narodowej'));
 assert.ok(doc.getElementById('plan-data-status').textContent.includes('Dzień wolny od zajęć lekcyjnych'));
 choose('2026-10-20');
 assert.equal(notice.hidden,true,'Komunikat nie może zostać na innym dniu');assert.equal(doc.querySelector('.table-shell').hidden,false);
 for(const t of doc.querySelectorAll('table.plan')){ const got=timeOf(t,8); if(got!==undefined) assert.equal(got,'14:05 - 14:50',`${t.id} lekcja 8 po 13.10`); }
 assert.equal(doc.querySelectorAll('.time-changed').length,0);
 choose('2027-01-01');assert.equal(doc.querySelector('.table-shell').hidden,true);
 console.log('PASS: all dates, all substitutions, transfer source/target, reset, navigation, weekend, one-off days and publication bounds');
})().catch(e=>{console.error(e);process.exit(1)});
