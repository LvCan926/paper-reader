import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateCards,auditAssets,audit,prepare} from '../src/cli.mjs';
import {bodyPages} from '../src/body-scope.mjs';
import {arxivId,resolveArxivVersion,safeArchiveEntry,unpackSource} from '../src/arxiv.mjs';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

const fixture=JSON.parse(await fs.readFile(new URL('../examples/chapters.json',import.meta.url),'utf8'));
const source={body_scope:{reviewed:true,pages:[{number:1,text_start:0,text_end:8}]},pages:[{number:1,text:'evidence'}]};
const asset={id:'fig-1',type:'figure',scope:'body',label:'Figure 1',caption:'Original figure',source_page:1,box:[0.1,0.1,0.9,0.5],include:true};
test('six chapters are required in logical order',()=>{
  const cards=structuredClone(fixture);cards.chapters.reverse();
  assert.throws(()=>validateCards(cards),/六章/);
});
test('legacy physical pages accept any positive count',()=>{
  assert.doesNotThrow(()=>validateCards({title:'legacy',pages:[{title:'one',columns:2,sections:[{title:'s',items:[{text:'x',kind:'unknown',source_pages:[],quote:''}]}]}]}));
});
test('body figure inventory must be reviewed and fully included',()=>{
  assert.throws(()=>auditAssets(fixture,{reviewed:false,assets:[]},source),/核对/);
  assert.throws(()=>auditAssets(fixture,{reviewed:true,assets:[asset]},source),/没有放进/);
  const cards=structuredClone(fixture);cards.chapters[2].sections[0].images=[{asset_id:'fig-1'}];
  assert.equal(auditAssets(cards,{reviewed:true,assets:[asset]},source).included,1);
  assert.throws(()=>auditAssets(cards,{reviewed:true,assets:[{...asset,include:false}]},source),/正文图表/);
});

test('unreviewed scope and appendix evidence including shared pages are blocked',()=>{
  assert.throws(()=>bodyPages({pages:source.pages}),/body_scope/);
  const mixed={pages:[{number:1,text:'Main evidence. Appendix secret.'},{number:2,text:'Appendix only.'}],body_scope:{reviewed:true,pages:[{number:1,text_start:0,text_end:14}]}};
  const cards={title:'x',pages:[{title:'one',sections:[{title:'s',items:[{text:'x',kind:'paper',source_pages:[1],quote:'Main evidence.'}]}]}]};
  assert.equal(audit(cards,mixed).passed,true);
  cards.pages[0].sections[0].items[0].quote='Appendix secret.';
  assert.equal(audit(cards,mixed).passed,false);
  Object.assign(cards.pages[0].sections[0].items[0],{source_pages:[1,2],quote:'Main evidence.'});
  assert.equal(audit(cards,mixed).passed,false);
});

test('appendix assets and direct image paths cannot bypass body inventory',()=>{
  const cards=structuredClone(fixture);cards.chapters[2].sections[0].images=[{asset_id:'fig-1'}];
  assert.throws(()=>auditAssets(cards,{reviewed:true,assets:[{...asset,scope:'appendix'}]},source),/禁止收录附录/);
  assert.throws(()=>auditAssets(cards,{reviewed:true,assets:[{...asset,source_page:2}]},source),/正文范围/);
  cards.chapters[2].sections[0].images=[{path:'appendix.png',caption:'x'}];
  assert.throws(()=>auditAssets(cards,{reviewed:true,assets:[]},source),/asset_id/);
});

test('prepare sends only approved body text and never raw full-source TeX',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paper-reader-scope-'));
  try {
    await fs.writeFile(path.join(dir,'source.json'),JSON.stringify({file:'test.pdf',pages:[{number:1,text:'MAIN_TEXT|APPENDIX_SECRET'},{number:2,text:'APPENDIX_PAGE'}],body_scope:{reviewed:true,pages:[{number:1,text_start:0,text_end:9}]}}));
    await fs.writeFile(path.join(dir,'tex-source.txt'),'RAW_APPENDIX_LATEX');
    const prompt=await prepare(dir);
    assert.ok(prompt.includes('MAIN_TEXT'));
    for(const marker of ['APPENDIX_SECRET','APPENDIX_PAGE','RAW_APPENDIX_LATEX']) assert.ok(!prompt.includes(marker));
  } finally {
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('paper-reader-scope-'));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
test('arXiv links preserve new and legacy versioned identifiers',()=>{
  assert.equal(arxivId('https://arxiv.org/pdf/1706.03762v7.pdf'),'1706.03762v7');
  assert.equal(arxivId('https://arxiv.org/abs/hep-th/9901001v2'),'hep-th/9901001v2');
  assert.throws(()=>arxivId('https://example.com/abs/1706.03762'));
  assert.throws(()=>arxivId('https://arxiv.org/abs/../../secret'));
});
test('unversioned links resolve to the version displayed on abstract page',()=>{
  assert.equal(resolveArxivVersion('<meta name="citation_pdf_url" content="https://arxiv.org/pdf/1706.03762"><strong>arXiv:1706.03762v7</strong>','1706.03762'),'1706.03762v7');
  assert.equal(resolveArxivVersion('arXiv:1706.03762v7','1706.03762v2'),'1706.03762v2');
});
test('source archives reject traversal, absolute paths, and links',()=>{
  for(const name of ['../secret','/root/file','C:\\secret','dir/../../file']) assert.throws(()=>safeArchiveEntry({path:name,type:'File'}));
  assert.throws(()=>safeArchiveEntry({path:'safe.tex',type:'SymbolicLink'}));
  assert.doesNotThrow(()=>safeArchiveEntry({path:'figures/diagram.pdf',type:'File'}));
});
test('single gzip-compressed TeX source is supported',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paper-reader-'));
  try {
    const tex=Buffer.from('\\documentclass{article}\n\\begin{document}test\\end{document}');
    const r=await unpackSource(gzipSync(tex),dir);
    assert.equal(r.available,true);
    assert.equal(await fs.readFile(path.join(r.directory,'main.tex'),'utf8'),tex.toString());
  } finally {
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('paper-reader-'));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
