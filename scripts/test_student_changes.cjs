const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname, '..');
const payload=JSON.parse(fs.readFileSync(path.join(root,'student-changes.json')));
const dom=new JSDOM(fs.readFileSync(path.join(root,'plan-lekcji-2026-09-07.html'),'utf8'),{runScripts:'outside-only'});
let source=fs.readFileSync(path.join(root,'student-changes.js'),'utf8');source=source.replace('    fetch("student-changes.json', '    window.testAPI = {matchingCell, applyChanges}; return;\n    fetch("student-changes.json');dom.window.eval(source);
for(const kind of ['substitutions','transfers']){let count=0;for(const c of payload[kind]){const t=dom.window.document.getElementById(c.className);const cell=t&&dom.window.testAPI.matchingCell(t,c,kind==='transfers');if(cell)count++;else console.log('UNMATCHED',kind,JSON.stringify(c));}console.log(kind,count,'/',payload[kind].length);}
const c=payload.substitutions.find(c=>c.date==='2026-09-09'&&c.className==='1TFH'&&c.period===1);
const cell=dom.window.testAPI.matchingCell(dom.window.document.getElementById('1TFH'),c,false);require('assert').equal(cell.textContent.trim(),'Informatyka');
const assert = require('assert');
assert.equal(dom.window.testAPI.matchingCell(dom.window.document.getElementById('1TFH'), {...c, groupName: 'gr1'}, false), null);
assert.equal(dom.window.testAPI.matchingCell(dom.window.document.getElementById('1TFH'), {...c, sourceTeacher: 'UNKNOWN'}, false), null);
assert.equal(dom.window.testAPI.matchingCell(dom.window.document.getElementById('1TFH'), {...c, sourceTeacher: ''}, false), null);
dom.window.testAPI.applyChanges(payload);
assert.ok(![...dom.window.document.getElementById('1TFH').querySelectorAll('td')].some(td => td.textContent.includes('Język angielski') && td.textContent.includes('przychodzą później')));
require('assert').ok(cell.textContent.includes('przychodzą później'));assert.equal(dom.window.document.querySelectorAll('.student-change').length, payload.substitutions.length);
assert.equal(dom.window.document.querySelectorAll('.room-change-cell').length, payload.transfers.length);
console.log('REGRESSION PASS');
