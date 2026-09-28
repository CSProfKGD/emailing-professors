import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeAnchor, resolveAnchor } from '../src/anchors.js';
test('anchors verify exact locations, relocate after earlier edits, and refuse changed context', () => {
 const text = 'A'.repeat(90) + 'One specific sentence matters.' + 'B'.repeat(90);
 const anchor = makeAnchor('specificity',text,90,111);
 assert.deepEqual(resolveAnchor(text,anchor),{start:90,end:111});
 assert.deepEqual(resolveAnchor('New opening. '+text,anchor),{start:103,end:124});
 assert.equal(resolveAnchor(text.replace('specific','generic'),anchor),null);
 assert.equal(resolveAnchor(text.replace('A'.repeat(64),'C'.repeat(64)),anchor),null);
});
test('duplicate quotes do not silently reattach to the wrong passage', () => {
 const a={sectionId:'x',exact:'quote',prefix:'before ',suffix:' after',start:999,end:1004};
 assert.equal(resolveAnchor('before quote after; before quote after',a),null);
 assert.deepEqual(resolveAnchor('wrong quote here; before quote after',a),{start:25,end:30});
});
test('selection validation and Unicode offsets match the browser', () => {
 const text='Hello 🧑‍🎓 researcher'; const start=text.indexOf('researcher'); const anchor=makeAnchor('x',text,start,text.length);
 assert.deepEqual(resolveAnchor(text,anchor),{start,end:text.length});
 assert.throws(()=>makeAnchor('x',text,4,2));
 assert.throws(()=>makeAnchor('x','x'.repeat(2100),0,2100));
});
test('full article copy remains verbatim and unwanted header is absent', async () => {
 const original=(await readFile('src/article.txt','utf8')).trimEnd();
 const sections=JSON.parse(await readFile('src/article.json','utf8'));
 assert.equal(sections.flatMap(s=>[...(s.heading?[s.heading]:[]),...s.paragraphs]).join('\n\n'),original);
 const html=await readFile('dist/index.html','utf8');
 for(const section of sections) for(const p of section.paragraphs) assert.ok(html.includes(p.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;')));
 assert.ok(!html.includes('Essays <span>'));
});
