import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {audit, validateCards} from '../src/cli.mjs';
const scoped=pages=>({pages,body_scope:{reviewed:true,pages:pages.length?pages.map(p=>({number:p.number,text_start:0,text_end:p.text.length})):[{number:1,text_start:0,text_end:1}]}});

const example = JSON.parse(await fs.readFile(new URL('../examples/cards.json', import.meta.url), 'utf8'));
function fixture() {
  const cards = structuredClone(example);
  cards.pages[0].sections[0].items[0] = {text:'该方法提高检索效果。',kind:'paper',source_pages:[1],quote:'Our method improves retrieval.'};
  return cards;
}
test('evidence matching tolerates whitespace and Unicode forms', () => {
  assert.equal(audit(fixture(), scoped([{number:1,text:'Our method\n improves retrieval.'}])).passed, true);
});
test('fabricated evidence is rejected', () => {
  const report = audit(fixture(), scoped([{number:1,text:'An unrelated sentence.'}]));
  assert.equal(report.passed, false);
  assert.match(report.errors[0], /证据摘录/);
});
test('nonexistent pages are rejected', () => {
  assert.equal(audit(fixture(), scoped([{number:2,text:'Other page.'}])).passed, false);
});
test('interpretations also require source evidence', () => {
  const cards = fixture();
  Object.assign(cards.pages[0].sections[0].items[0],{kind:'interpretation',quote:''});
  assert.throws(() => validateCards(cards), /证据摘录/);
});
test('malformed tables are rejected before rendering', () => {
  const cards = fixture();
  cards.pages[0].sections[0].table = {headers:['a','b'],rows:[['one']]};
  assert.throws(() => validateCards(cards), /表格列数/);
});
