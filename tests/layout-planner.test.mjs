import test from 'node:test';
import assert from 'node:assert/strict';
import {packMeasured} from '../src/layout-planner.mjs';

const block=(ref,height,keepWithNext=false)=>({ref,height,keepWithNext});
const settings={firstHeight:100,otherHeight:120,gap:10};
const refs=pages=>pages.flat(2).map(b=>b.ref);

test('measured pagination preserves order and keeps a summary with its first section',()=>{
  const blocks=[block('background/summary',20,true),block('background/task',50),
    block('related/summary',20,true),block('related/routes',50),block('method',70)];
  const pages=packMeasured(blocks,settings);
  assert.equal(pages.length,1);
  assert.deepEqual(refs(pages),blocks.map(b=>b.ref));
  assert.deepEqual(pages[0].map(c=>c.map(b=>b.ref)),[
    ['background/summary','background/task'],['related/summary','related/routes'],['method']
  ]);
});

test('page count grows with measured content, with no artificial four-page limit',()=>{
  for(const count of [2,4,16]) {
    const blocks=Array.from({length:count},(_,i)=>block(`section${i}`,80));
    const pages=packMeasured(blocks,settings);
    assert.equal(pages.length,Math.ceil(count/3));
    assert.deepEqual(refs(pages),blocks.map(b=>b.ref));
    assert.ok(pages.every(p=>p.length===3));
  }
});

test('uses subsequent page capacity while preserving reading order',()=>{
  const blocks=[block('a',70),block('b',70),block('c',70),block('tall',110)];
  const pages=packMeasured(blocks,settings);
  assert.equal(pages.length,2);
  assert.equal(pages[1][0][0].ref,'tall');
  assert.deepEqual(refs(pages),['a','b','c','tall']);
});

test('balances columns when several arrangements fit the minimum page count',()=>{
  const pages=packMeasured(Array.from({length:6},(_,i)=>block(String(i),30)),settings);
  assert.equal(pages.length,1);
  assert.deepEqual(pages[0].map(c=>c.length),[2,2,2]);
});

test('rejects oversized units and linked groups instead of silently shrinking or dropping them',()=>{
  assert.throws(()=>packMeasured([block('wide',121)],settings),/超出单栏/);
  assert.throws(()=>packMeasured([block('summary',50,true),block('first',70)],settings),/超出单栏/);
  assert.throws(()=>packMeasured([block('invalid',NaN)],settings),/无法测量/);
  assert.throws(()=>packMeasured([block('first',110)],settings),/首页高度/);
});
