import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan} from '../src/editorial-renderer.mjs';

const cards={chapters:[{id:'method',title:'Method',summary:{text:'summary'},sections:[{id:'formula',title:'Formula',items:[]}]}]};
const plan={pages:[{title:'Mechanism',columns:[{width:1,blocks:[{ref:'method/summary'},{ref:'method/formula'}]}]}]};
test('page plan accounts for every summary and section exactly once',()=>{
  assert.equal(validatePlan(cards,plan).size,2);
  const missing=structuredClone(plan);missing.pages[0].columns[0].blocks.pop();
  assert.throws(()=>validatePlan(cards,missing),/遗漏/);
  const duplicate=structuredClone(plan);duplicate.pages[0].columns[0].blocks.push({ref:'method/formula'});
  assert.throws(()=>validatePlan(cards,duplicate),/重复/);
});
test('page plan rejects stale references, invalid widths and illegible image limits',()=>{
  const stale=structuredClone(plan);stale.pages[0].columns[0].blocks[1].ref='method/deleted';
  assert.throws(()=>validatePlan(cards,stale),/未知/);
  const width=structuredClone(plan);width.pages[0].columns[0].width=-1;
  assert.throws(()=>validatePlan(cards,width),/正数/);
  const tiny=structuredClone(plan);tiny.pages[0].columns[0].blocks[1].image_height=20;
  assert.throws(()=>validatePlan(cards,tiny),/图像高度/);
});

test('mixed horizontal bands retain complete, unique coverage',()=>{
  const mixed={pages:[{title:'Mechanism',bands:[
    {height:300,columns:[{width:1,blocks:[{ref:'method/summary'}]}]},
    {columns:[{width:2,blocks:[{ref:'method/formula',media_layout:'side'}]}]}
  ]}]};
  assert.equal(validatePlan(cards,mixed).size,2);
  const duplicate=structuredClone(mixed);
  duplicate.pages[0].bands[1].columns[0].blocks.push({ref:'method/summary'});
  assert.throws(()=>validatePlan(cards,duplicate),/重复/);
  const height=structuredClone(mixed);
  height.pages[0].bands[0].height=-10;
  assert.throws(()=>validatePlan(cards,height),/分区高度/);
  const layout=structuredClone(mixed);
  layout.pages[0].bands[1].columns[0].blocks[0].media_layout='overlay';
  assert.throws(()=>validatePlan(cards,layout),/图文布局/);
});

test('equal-three-column plans reject unequal widths and wrong column counts',()=>{
  const content={chapters:[{id:'background',title:'Background',summary:{text:'summary'},sections:[
    {id:'task',title:'Task',items:[]},{id:'problem',title:'Problem',items:[]}
  ]}]};
  const equal={layout:'equal-three-column',pages:[{title:'Context',columns:[
    {width:1,blocks:[{ref:'background/summary'}]},
    {width:1,blocks:[{ref:'background/task'}]},
    {width:1,blocks:[{ref:'background/problem'}]}
  ]}]};
  assert.equal(validatePlan(content,equal).size,3);
  const uneven=structuredClone(equal);uneven.pages[0].columns[0].width=1.5;
  assert.throws(()=>validatePlan(content,uneven),/等宽三栏/);
  const two=structuredClone(equal);two.pages[0].columns.pop();
  assert.throws(()=>validatePlan(content,two),/等宽三栏/);
});
