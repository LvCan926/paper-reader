import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {categoryPath,syncLibrary} from '../src/library.mjs';

test('分类目录支持层级，拒绝路径逃逸与非法目录名',()=>{
  assert.equal(categoryPath(['智能体','自我改进']),path.join('智能体','自我改进'));
  for(const value of [[],['..'],['.'],['a/b'],['a\\b'],['C:'],['x '],['']])
    assert.throws(()=>categoryPath(value));
});

test('阅读库只发布匹配视觉复核指纹的 PDF，生成相对链接且拒绝过期复核',async t=>{
  const tempRoot=path.resolve('tmp/library-tests');
  await fs.mkdir(tempRoot,{recursive:true});
  const root=await fs.mkdtemp(path.join(tempRoot,'case-'));
  t.after(async()=>{
    const resolved=path.resolve(root);
    assert.equal(path.dirname(resolved),tempRoot);
    assert.ok(path.basename(resolved).startsWith('case-'));
    await fs.rm(resolved,{recursive:true,force:true});
  });
  const papers=path.join(root,'papers'),out=path.join(root,'output'),library=path.join(root,'library');
  await fs.mkdir(out,{recursive:true});
  const bytes=Buffer.from('test-pdf-bytes'),pdf=path.join(out,'paper.pdf');
  const sha=createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(pdf,bytes);
  const write=async(file,data)=>fs.writeFile(file,JSON.stringify(data));
  const state={status:'reviewed',pdf,visual_review:{pdf_sha256:sha}};
  await write(path.join(out,'workflow-status.json'),state);
  await write(path.join(out,'pdf-verification.json'),{actual_pages:3});
  const p=path.join(papers,'sample');await fs.mkdir(p,{recursive:true});
  await write(path.join(p,'paper.json'),{output:'../../output',filename:'sample.pdf',category:['智能体','自我改进'],content:'content.json',source:'source.json'});
  await write(path.join(p,'content.json'),{title:'A < B & C'});
  await write(path.join(p,'source.json'),{arxiv:{id:'1234.56789v1'}});
  const pending=path.join(papers,'pending');await fs.mkdir(pending,{recursive:true});
  await fs.mkdir(path.join(root,'pending-output'));
  await write(path.join(pending,'paper.json'),{output:'../../pending-output',category:['待审']});
  await write(path.join(root,'pending-output/workflow-status.json'),{status:'awaiting_visual_review'});
  const entries=await syncLibrary(papers,library);
  assert.equal(entries.length,1);assert.equal(entries[0].pages,3);
  assert.deepEqual(await fs.readFile(path.join(library,entries[0].path)),bytes);
  const html=await fs.readFile(path.join(library,'index.html'),'utf8');
  assert.ok(html.includes('A &lt; B &amp; C'));
  assert.ok(html.includes(encodeURIComponent('智能体')+'/'));
  assert.ok(html.includes('https://arxiv.org/abs/1234.56789v1'));
  // A fresh clone has the published library but no ignored output/ directory.
  await fs.unlink(path.join(out,'workflow-status.json'));
  assert.deepEqual(await syncLibrary(papers,library),entries);
  // A newer unreviewed build must not hide the last reviewed publication.
  await write(path.join(out,'workflow-status.json'),{...state,status:'awaiting_visual_review'});
  assert.deepEqual(await syncLibrary(papers,library),entries);
  await write(path.join(out,'workflow-status.json'),state);
  assert.deepEqual(await syncLibrary(papers,library),entries);
  await fs.writeFile(pdf,'modified');
  await assert.rejects(syncLibrary(papers,library),/需要重新视觉复核/);
  // The catalog may not import a PDF from outside the library.
  await write(path.join(library,'catalog.json'),[{...entries[0],path:'../output/paper.pdf'}]);
  await assert.rejects(syncLibrary(papers,library),/路径必须位于阅读库/);
});
