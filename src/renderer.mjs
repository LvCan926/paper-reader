import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import katex from 'katex';
import {validateCards,audit,auditAssets,crop} from './cli.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const readJSON=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const texEsc=s=>String(s??'').replace(/[\\%&#_${}~^]/g,c=>({'\\':'\\textbackslash{}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$','{':'\\{','}':'\\}','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[c]));
const pictures=s=>[...(s.image?[s.image]:[]),...(s.images??[])];
const labels={paper:'原文',interpretation:'解读',unknown:'待确认'};
const citation=i=>i.source_pages?.length?`PDF p.${i.source_pages.join(',')}`:'原文未确认';

export async function renderDocument(cardsPath,out,sourcePath,demo=false,options={}) {
  if(!demo&&!options.legacyLayout) {
    const {renderEditorial}=await import('./editorial-renderer.mjs');
    return renderEditorial(cardsPath,out,sourcePath,options);
  }
  const cards=validateCards(await readJSON(cardsPath));
  const chapters=cards.chapters??cards.pages;
  let source,manifest;
  if(!demo) {
    if(!sourcePath) throw new Error('正式导出需要 --source source.json');
    source=await readJSON(sourcePath);
    const report=audit(cards,source);
    if(!report.passed) throw new Error(report.errors.join('\n'));
    if((cards.chapters || chapters.some(c=>c.sections.some(s=>pictures(s).length))) && !options.assetsPath) throw new Error('阅读稿需要 --assets assets.json；必须核对正文图表清单');
    if(options.assetsPath) {
      manifest=await readJSON(options.assetsPath);
      auditAssets(cards,manifest,source);
    }
  }
  await fs.mkdir(out,{recursive:true});
  const imageDir=path.join(out,'images');
  await fs.mkdir(imageDir,{recursive:true});
  const assets=new Map();
  if(manifest?.assets.some(a=>a.include&&!a.path)) {
    if(!options.pdfPath) throw new Error('从原 PDF 裁剪图表需要 --pdf paper.pdf');
    const hash=createHash('sha256').update(await fs.readFile(options.pdfPath)).digest('hex');
    if(hash!==source.sha256) throw new Error('--pdf 与 source.json 的文件指纹不一致');
  }
  for(const [index,a] of (manifest?.assets??[]).entries()) {
    if(!a.include) continue;
    const dest=path.join(imageDir,`original-${index+1}.png`);
    if(a.path) {
      const original=path.resolve(path.dirname(options.assetsPath),a.path);
      assets.set(a.id,{...a,path:original});
    } else {
      await crop(options.pdfPath,a.source_page,a.box.join(','),dest);
      assets.set(a.id,{...a,path:path.resolve(dest)});
    }
  }
  let css=await fs.readFile(path.join(ROOT,'src/style.css'),'utf8');
  let mathCSS=await fs.readFile(path.join(ROOT,'node_modules/katex/dist/katex.min.css'),'utf8');
  const fonts=[...new Set([...mathCSS.matchAll(/url\((fonts\/[^)]+)\)/g)].map(m=>m[1]))];
  for(const f of fonts) mathCSS=mathCSS.replaceAll(`url(${f})`,`url(data:font/${path.extname(f).slice(1)};base64,${(await fs.readFile(path.join(ROOT,'node_modules/katex/dist',f))).toString('base64')})`);
  const htmlGroups=[], texGroups=[], formulas=[];
  let imageNumber=0;
  const itemHTML=i=>`<li><span class="tag ${i.kind}">${labels[i.kind]}</span>${esc(i.text)}<small title="${esc(i.quote)}">${citation(i)}</small></li>`;
  const itemTeX=i=>`${texEsc(`[${labels[i.kind]}] ${i.text} (${citation(i)})`)}\\par\n`;
  const block=(title,body,tone='blue',extra='')=>`<section class="block ${['blue','red','green','gold'].includes(tone)?tone:'blue'} ${extra}"><h3>${esc(title)}</h3>${body}</section>`;
  for(const [chapterIndex,chapter] of chapters.entries()) {
    const blocks=[],tex=[];
    if(chapter.summary) {
      blocks.push(block('本章概述',`<ul>${itemHTML(chapter.summary)}</ul>`,'blue','summary'));
      tex.push(itemTeX(chapter.summary));
    }
    for(const section of chapter.sections) {
      const sectionStart=blocks.length;
      blocks.push(block(section.title,`<ul>${section.items.map(itemHTML).join('')}</ul>`,section.tone,section.wide?'wide':''));
      tex.push(`\\subsection*{${texEsc(section.title)}}\n${section.items.map(itemTeX).join('\n')}`);
      const fspec=[...(section.formula?[{latex:section.formula,explanation:'',source_pages:section.items[0].source_pages,quote:section.items[0].quote}]:[]),...(section.formulas??[])];
      for(const f of fspec) {
        const math=katex.renderToString(f.latex,{displayMode:true,throwOnError:true,trust:false,strict:'error'});
        blocks.push(block(`${section.title} · 公式`,`<div class="formula">${math}</div><p class="explanation">${esc(f.explanation??'')}</p><small>${citation(f)}</small>`,section.tone,f.placement==='column'?'':'wide'));
        tex.push(`\\[${f.latex}\\]\n${texEsc(f.explanation??'')}\\par\n${texEsc(citation(f))}\\par`);
        formulas.push({chapter:chapter.title,section:section.title,...f});
      }
      if(section.table) {
        const t=section.table;
        blocks.push(block(`${section.title} · 整理表`,`<table><thead><tr>${t.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,section.tone,'wide'));
        tex.push(`\\begin{tabularx}{\\linewidth}{${t.headers.map(()=>'X').join('')}}\n\\toprule\n${t.headers.map(texEsc).join(' & ')} \\\\\n\\midrule\n${t.rows.map(r=>r.map(texEsc).join(' & ')+' \\\\').join('\n')}\n\\bottomrule\n\\end{tabularx}`);
      }
      for(const img of pictures(section)) {
        const a=img.asset_id?assets.get(img.asset_id):{path:path.resolve(path.dirname(cardsPath),img.path),caption:img.caption,label:img.label??'原图表',source_page:img.source_page};
        if(!a) throw new Error(`找不到图表 ${img.asset_id}`);
        const ext=path.extname(a.path).toLowerCase();
        const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[ext];
        if(!mime) throw new Error('图表必须为 PNG/JPEG，矢量原图可从 PDF 页面裁剪');
        const bytes=await fs.readFile(a.path);
        const relative=`images/asset-${++imageNumber}${ext}`;
        await fs.writeFile(path.join(out,relative),bytes);
        const caption=`${a.caption}${a.source_page?`（${a.label}，PDF p.${a.source_page}）`:''}`;
        blocks.push(block(a.label??'原论文图表',`<figure><img src="data:${mime};base64,${bytes.toString('base64')}"/><figcaption>${esc(caption)}</figcaption></figure>`,section.tone,`${img.placement==='column'?'':'wide'} media-block`));
        tex.push(`\\par\\medskip\n\\includegraphics[width=\\linewidth,height=.65\\textheight,keepaspectratio]{${relative}}\\par\n${texEsc(caption)}\\par\\medskip`);
      }
      if(section.keep_together) {
        const parts=blocks.splice(sectionStart);
        blocks.push(`<div class="block-group wide">${parts.join('')}</div>`);
      }
    }
    htmlGroups.push(`<article class="sheet" data-chapter="${esc(chapter.id??String(chapterIndex))}"><header><b>中文论文阅读稿 / PAPER READING</b><span class="paper-name">${esc(cards.title)}</span><span>${esc(cards.source_label??'')}</span></header><div class="page-title"><div class="index">${String(chapterIndex+1).padStart(2,'0')}</div><div><p>${esc(chapter.eyebrow??'CHINESE READING NOTES')}</p><h1>${esc(chapter.title)}</h1><div class="subtitle">${esc(cards.subtitle??cards.title)}</div></div></div><main style="--columns:${chapter.columns??2}">${blocks.join('')}</main><footer><span>${demo?'教学演示 · 不对应真实论文':'AI 辅助整理 · 请核对原文 · 页码均为 PDF 文件页码'}</span><span class="page-number"></span></footer></article>`);
    texGroups.push(`\\section*{${texEsc(chapter.title)}}\n${tex.join('\n\n')}`);
  }
  const tex=`% Generated source. Compile with XeLaTeX. Original paper source is never executed.\n\\documentclass[UTF8,fontset=fandol]{ctexart}\n\\usepackage[a4paper,margin=18mm]{geometry}\n\\usepackage{amsmath,amssymb,graphicx,tabularx,booktabs}\n\\setlength{\\parindent}{0pt}\n\\setlength{\\parskip}{5pt}\n\\title{${texEsc(cards.title)}}\n\\author{}\\date{}\n\\begin{document}\n\\maketitle\n${demo?'教学演示，不对应真实论文。\\par\n':''}${texGroups.join('\n\n')}\n\\end{document}\n`;
  await fs.writeFile(path.join(out,'cards.tex'),tex,'utf8');
  await fs.writeFile(path.join(out,'formula-source.json'),JSON.stringify(formulas,null,2));
  const htmlPath=path.resolve(out,'cards.html');
  await fs.writeFile(htmlPath,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(cards.title)}</title><style>${mathCSS}\n${css}</style><body class="${cards.layout==='compact'?'paper-compact':''}">${htmlGroups.join('')}</body></html>`,'utf8');
  const {chromium}=await import('playwright');
  const browser=await chromium.launch();
  try {
    const p=await browser.newPage({viewport:{width:1440,height:1018},deviceScaleFactor:2});
    await p.goto(pathToFileURL(htmlPath).href);
    await p.emulateMedia({media:'print'});
    await p.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
    const layout=await p.evaluate(()=>{
      const originals=[...document.querySelectorAll('.sheet')];
      const errors=[];
      for(const original of originals) {
        const baseTitle=original.querySelector('h1').textContent;
        const blocks=[...original.querySelector('main').children];
        original.querySelector('main').replaceChildren();
        let current=original;
        while(blocks.length) {
          const b=blocks.shift(),main=current.querySelector('main');
          main.append(b);
          if(main.scrollHeight<=main.clientHeight+2) continue;
          b.remove();
          if(!main.children.length) {
            const items=[...b.querySelectorAll('li')];
            if(items.length>1) {
              const parts=items.map((item,i)=>{const clone=b.cloneNode(true);clone.querySelector('ul').replaceChildren(item);if(i) clone.querySelector('h3').textContent+='（续）';return clone;});
              blocks.unshift(...parts);
              continue;
            }
            errors.push(`单个模块过高，无法分页：${b.textContent.slice(0,80)}`);
            break;
          }
          const next=original.cloneNode(true);
          next.querySelector('main').replaceChildren();
          next.querySelector('h1').textContent=baseTitle+'（续）';
          current.after(next);current=next;blocks.unshift(b);
        }
      }
      const sheets=[...document.querySelectorAll('.sheet')];
      sheets.forEach((s,i)=>{s.querySelector('.index').textContent=String(i+1).padStart(2,'0');s.querySelector('.page-number').textContent=`${i+1} / ${sheets.length}`;});
      for(const e of document.querySelectorAll('main,.block,.formula,td,th,header,.page-title')) if(e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2) errors.push(`内容溢出：${e.textContent.slice(0,70)}`);
      return {pages:sheets.length,chapters:sheets.map((s,i)=>({page:i+1,chapter:s.dataset.chapter})),errors};
    });
    await fs.writeFile(htmlPath,await p.content(),'utf8');
    if(layout.errors.length) throw new Error(layout.errors.join('\n')+'\nHTML 已保存；请拆分单条过长内容或检查公式。');
    await p.pdf({path:path.join(out,'cards.pdf'),printBackground:true,preferCSSPageSize:true});
    for(let i=0;i<layout.pages;i++) await p.locator('.sheet').nth(i).screenshot({path:path.join(out,`page-${i+1}.png`)});
    // 删除旧版多余的自动生成页，避免页数减少后混入旧图。
    for(const f of await fs.readdir(out)) if(/^page-\d+\.png$/.test(f)&&Number(f.match(/\d+/)[0])>layout.pages) await fs.unlink(path.join(out,f));
    // 只清理本工具命名的多余图片，页数/图表减少后不残留旧版资产。
    for(const f of await fs.readdir(imageDir)) {
      const match=/^(original|asset)-(\d+)\.png$/.exec(f);
      const limit=match?.[1]==='original'?(manifest?.assets.length??0):imageNumber;
      if(match && Number(match[2])>limit) await fs.unlink(path.join(imageDir,f));
    }
    await fs.writeFile(path.join(out,'layout-check.json'),JSON.stringify({...layout,overflow:[],pixels:[2880,2036],demo,tex_compiled:false},null,2));
    console.log(`已按内容排为 ${layout.pages} 页：${out}/cards.pdf、cards.tex、cards.html 和 page-1.png ~ page-${layout.pages}.png`);
  } finally {await browser.close();}
}
