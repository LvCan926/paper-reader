import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import katex from 'katex';
import {audit,auditAssets,crop} from './cli.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const math=(latex,displayMode=false)=>katex.renderToString(latex,{displayMode,throwOnError:true,trust:false,strict:'error'});
const rich=s=>String(s??'').split(/(\$[^$\n]+\$|\*\*[^*]+\*\*)/g).map(t=>t.startsWith('$')?math(t.slice(1,-1)):t.startsWith('**')?`<strong>${esc(t.slice(2,-2))}</strong>`:esc(t)).join('');
const texEsc=s=>String(s??'').replace(/[\\%&#_${}~^]/g,c=>({'\\':'\\textbackslash{}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$','{':'\\{','}':'\\}','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[c]));
const texRich=s=>String(s??'').split(/(\$[^$\n]+\$|\*\*[^*]+\*\*)/g).map(t=>t.startsWith('$')?t:t.startsWith('**')?`\\textbf{${texEsc(t.slice(2,-2))}}`:texEsc(t)).join('');

export const pageBands=p=>p.bands??[{columns:p.columns}];

function collectBlocks(cards) {
  const all=new Map();
  for(const c of cards.chapters??[]) {
    all.set(`${c.id}/summary`,{title:c.title,items:[c.summary],summary:true});
    for(const s of c.sections) {
      if(!s.id||all.has(`${c.id}/${s.id}`)) throw new Error('每个小节需要唯一 id');
      all.set(`${c.id}/${s.id}`,s);
    }
  }
  return all;
}

export function validatePlan(cards,plan) {
  if(!Array.isArray(plan?.pages)||!plan.pages.length) throw new Error('页面计划需要非空 pages');
  const all=collectBlocks(cards);
  const seen=new Set();
  for(const p of plan.pages) {
    if(!p.title||!Array.isArray(pageBands(p))||!pageBands(p).length) throw new Error('页面需要 title 与非空分区');
    if(plan.layout==='equal-three-column'&&(pageBands(p).length!==1||pageBands(p)[0].columns?.length!==3||pageBands(p)[0].columns.some(c=>c.width!==1))) throw new Error('等宽三栏版式每页必须恰有三个 width=1 的栏目');
    for(const band of pageBands(p)) {
    if(!Array.isArray(band.columns)||!band.columns.length||band.columns.length>4) throw new Error('分区需要 1–4 栏');
    if(band.height!==undefined&&(!Number.isFinite(band.height)||band.height<100||band.height>900)) throw new Error('分区高度应为 100–900 像素');
    for(const c of band.columns) {
      if(!Number.isFinite(c.width)||c.width<=0||!Array.isArray(c.blocks)||(!c.blocks.length&&plan.generated_by!=='measured-flow')) throw new Error('栏目需要正数 width 和 blocks');
      for(const b of c.blocks) {
        if(!all.has(b.ref)||seen.has(b.ref)) throw new Error(`未知或重复的模块：${b.ref}`);
        if(b.image_height!==undefined && (!Number.isFinite(b.image_height)||b.image_height<100||b.image_height>700)) throw new Error('图像高度应为 100–700 像素');
        if(b.media_layout!==undefined&&!['side','top','bottom'].includes(b.media_layout)) throw new Error('未知图文布局');
        seen.add(b.ref);
      }
    }
    }
  }
  const missing=[...all.keys()].filter(k=>!seen.has(k));
  if(missing.length) throw new Error(`页面计划遗漏内容：${missing.join(', ')}`);
  return all;
}

export async function renderEditorial(cardsPath,out,sourcePath,options) {
  if(!sourcePath||!options.assetsPath||!options.pdfPath) throw new Error('紧凑排版需要 --source、--assets 和 --pdf');
  const cards=await read(cardsPath),source=await read(sourcePath),manifest=await read(options.assetsPath);
  let plan=options.planPath?await read(options.planPath):null;
  const report=audit(cards,source);
  if(!report.passed) throw new Error(report.errors.join('\n'));
  const coverage=auditAssets(cards,manifest,source),blocks=plan?validatePlan(cards,plan):collectBlocks(cards);
  if(createHash('sha256').update(await fs.readFile(options.pdfPath)).digest('hex')!==source.sha256) throw new Error('原 PDF 指纹与 source.json 不匹配');
  await fs.mkdir(path.join(out,'images'),{recursive:true});
  const assets=new Map(),usedImages=new Set();
  for(const a of manifest.assets.filter(a=>a.include)) {
    const filename=`images/${a.id}.png`;
    if(!/^[a-z0-9-]+$/i.test(a.id)) throw new Error('图表 id 只能包含字母、数字和连字符');
    const dest=path.join(out,filename);
    if(a.path) await fs.copyFile(path.resolve(path.dirname(options.assetsPath),a.path),dest);
    else await crop(options.pdfPath,a.source_page,a.box.join(','),dest);
    const bytes=await fs.readFile(dest);
    assets.set(a.id,{...a,filename,url:`data:image/png;base64,${bytes.toString('base64')}`});
    usedImages.add(path.basename(filename));
  }
  let mathCSS=await fs.readFile(path.join(ROOT,'node_modules/katex/dist/katex.min.css'),'utf8');
  for(const f of new Set([...mathCSS.matchAll(/url\((fonts\/[^)]+)\)/g)].map(m=>m[1]))) mathCSS=mathCSS.replaceAll(`url(${f})`,`url(data:font/${path.extname(f).slice(1)};base64,${(await fs.readFile(path.join(ROOT,'node_modules/katex/dist',f))).toString('base64')})`);
  const css=await fs.readFile(path.join(ROOT,'src/editorial.css'),'utf8');
  const formulas=[],texPages=[];
  const sectionHTML=b=>{
    const s=blocks.get(b.ref);
    const text=s.items.map(i=>`<p>${rich(i.text)}</p>`).join('');
    const equations=(s.formulas??[]).map(f=>{
      return `<div class="formula">${math(f.latex,true)}</div><p class="formula-note">${rich(f.explanation)}</p>`;
    }).join('');
    const figures=(s.images??[]).map(i=>{
      const a=assets.get(i.asset_id);
      const limit=b.image_height??(a.type==='figure'?400:undefined);
      return `<figure data-asset="${esc(a.id)}"><img src="${a.url}" alt="${esc(a.label)}"${limit?` style="max-height:${limit}px;width:auto"`:''}><figcaption>${rich(a.caption)}</figcaption></figure>`;
    }).join('');
    const table=s.table?`<table class="data-table"><thead><tr>${s.table.headers.map(h=>`<th>${rich(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(row=>`<tr>${row.map(v=>`<td>${rich(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'';
    const content=text+equations+table;
    const mediaFirst=b.media_layout==='top'||s.media_first;
    const body=b.media_layout==='side'?`<div class="figure-side">${figures}<div class="figure-text">${content}</div></div>`:b.media_layout==='bottom'?content+figures:mediaFirst?figures+content:content+figures;
    return `<section class="section ${esc(s.tone??'blue')} ${s.summary?'brief':''} ${b.highlight?'highlight':''}" data-ref="${esc(b.ref)}"><h2>${esc(s.title)}</h2><div class="section-body">${body}</div></section>`;
  };
  const createSheet=p=>`<article class="sheet equal-three-column"><header class="running-head"><span>${esc(cards.title)}</span><span>${esc(p.title)}</span></header>${p.hero?`<div class="hero"><div><h1>${esc(cards.title)}</h1><p>${esc(cards.source_label)}</p></div><p class="hero-summary">${esc(cards.subtitle)}</p></div>`:`<h1 class="page-heading">${esc(p.title)}</h1>`}<main>${pageBands(p).map(band=>`<div class="band"${band.height?` style="height:${band.height}px;flex:none"`:''}>${band.columns.map(c=>`<div class="column" style="--weight:${c.width}">${c.blocks.map(sectionHTML).join('')}</div>`).join('')}</div>`).join('')}</main></article>`;
  if(!plan) {
    const {planAutomatically}=await import('./layout-planner.mjs');
    plan=await planAutomatically({cards,createSheet,style:mathCSS+'\n'+css});
    validatePlan(cards,plan);
  }
  for(const s of blocks.values()) for(const f of s.formulas??[]) formulas.push({section:s.title,...f});
  const sectionTeX=b=>{
    const s=blocks.get(b.ref);
    const text=s.items.map(i=>texRich(i.text)+'\\par').join('\n');
    const figures=(s.images??[]).map(i=>{const a=assets.get(i.asset_id);return `\\begin{center}\\includegraphics[width=\\linewidth,height=${b.image_height?(b.image_height/1018*.82).toFixed(3):'.54'}\\textheight,keepaspectratio]{${a.filename}}\\end{center}\n{\\footnotesize ${texRich(a.caption)}}\\par`;}).join('\n');
    const table=s.table?`\\begin{tabularx}{\\linewidth}{${s.table.headers.map(()=>'X').join('')}}\n${s.table.headers.map(texRich).join(' & ')}\\\\\\hline\n${s.table.rows.map(r=>r.map(texRich).join(' & ')+'\\\\').join('\n')}\n\\end{tabularx}`:'';
    return `\\subsection*{${texEsc(s.title)}}\n${s.media_first?figures:''}\n${text}\n${(s.formulas??[]).map(f=>`\\[${f.latex}\\]\n${texRich(f.explanation)}\\par`).join('\n')}\n${table}\n${s.media_first?'':figures}`;
  };
  const htmlPages=plan.pages.map((p,i)=>{
    texPages.push(`\\section*{${texEsc(i===0?cards.title:p.title)}}\n${pageBands(p).map(band=>{
      const total=band.columns.reduce((a,c)=>a+c.width,0);
      return band.columns.map(c=>`\\begin{minipage}[t]{${(c.width/total*.94).toFixed(3)}\\textwidth}\n${c.blocks.map(sectionTeX).join('\n')}\n\\end{minipage}`).join('\\hfill\n');
    }).join('\\par\\medskip\n')}`);
    return createSheet(p).replace('sheet equal-three-column',`sheet ${plan.layout==='equal-three-column'?'equal-three-column':''}`);
  });
  const htmlPath=path.resolve(out,'cards.html');
  await fs.writeFile(htmlPath,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(cards.title)} · 中文速查</title><style>${mathCSS}\n${css}</style><body>${htmlPages.join('')}</body></html>`);
  await fs.writeFile(path.join(out,'cards.tex'),`% Editable LaTeX companion; the delivered PDF is printed from the HTML layout.\n\\documentclass[UTF8,fontset=fandol]{ctexart}\n\\usepackage[a4paper,landscape,margin=8mm]{geometry}\n\\usepackage{amsmath,amssymb,graphicx,titlesec,tabularx}\n\\titleformat{\\section}{\\large\\bfseries}{}{0pt}{}\n\\titleformat{\\subsection}{\\small\\bfseries}{}{0pt}{}\n\\titlespacing*{\\subsection}{0pt}{5pt}{3pt}\n\\setlength{\\parindent}{0pt}\\setlength{\\parskip}{3pt}\n\\pagestyle{empty}\n\\begin{document}\\fontsize{10}{14}\\selectfont\n${texPages.join('\n\\newpage\n')}\n\\end{document}\n`);
  await fs.writeFile(path.join(out,'formula-source.json'),JSON.stringify(formulas,null,2));
  await fs.writeFile(path.join(out,'page-plan.json'),JSON.stringify(plan,null,2));
  const {chromium}=await import('playwright');
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1019},deviceScaleFactor:2});
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
    const layout=await page.evaluate(()=>{
      const errors=[],columns=[];
      for(const [pi,s] of [...document.querySelectorAll('.sheet')].entries()){
        const pageBottom=s.querySelector('main').getBoundingClientRect().bottom;
        for(const [bi,band] of [...s.querySelectorAll('.band')].entries()){
        const bottom=Math.min(pageBottom,band.getBoundingClientRect().bottom);
        if(band.getBoundingClientRect().bottom>pageBottom+1) errors.push(`第 ${pi+1} 页分区超出页面`);
        for(const [ci,c] of [...band.querySelectorAll('.column')].entries()){
          const children=[...c.children],first=c.getBoundingClientRect().top,last=children.at(-1)?.getBoundingClientRect().bottom??first;
          columns.push({page:pi+1,band:bi+1,column:ci+1,used:Math.round(last-first),available:Math.round(bottom-first),fill:Math.round((last-first)/(bottom-first)*100)});
          if(last>bottom+1) errors.push(`第 ${pi+1} 页分区 ${bi+1} 第 ${ci+1} 栏超高 ${Math.ceil(last-bottom)}px`);
        }
        }
      }
      for(const e of document.querySelectorAll('.section,.formula,p,h2,figcaption')) if(e.scrollWidth>e.clientWidth+2) errors.push(`横向溢出：${e.textContent.slice(0,70)}`);
      return {pages:document.querySelectorAll('.sheet').length,columns,errors};
    });
    await fs.writeFile(path.join(out,'layout-check.json'),JSON.stringify({...layout,mode:'editorial',tex_compiled:false},null,2));
    for(let i=0;i<plan.pages.length;i++) await page.locator('.sheet').nth(i).screenshot({path:path.join(out,`page-${i+1}.png`)});
    if(layout.errors.length) throw new Error(layout.errors.join('\n')+'\n请调整页面计划或内容，禁止自动缩小字号。');
    await page.emulateMedia({media:'print'});
    await page.pdf({path:path.join(out,'cards.pdf'),printBackground:true,preferCSSPageSize:true});
    // 仅清理由本工具生成且不再使用的旧页和旧图片。
    for(const f of await fs.readdir(out)) if(/^page-\d+\.png$/.test(f)&&Number(f.match(/\d+/)[0])>plan.pages.length) await fs.unlink(path.join(out,f));
    for(const f of await fs.readdir(path.join(out,'images'))) if(/^(original|asset)-\d+\.png$/.test(f)||(/^(fig|table)-\d+\.png$/.test(f)&&!usedImages.has(f))) await fs.unlink(path.join(out,'images',f));
    await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({pages:plan.pages.length,scope:'body_only',evidence:report,assets:coverage,planned_blocks:blocks.size,formula_groups:formulas.length,layout_errors:[],tex_compiled:false},null,2));
    console.log(`已完成 ${plan.pages.length} 页紧凑速查排版：${out}/cards.pdf`);
  }finally{await browser.close();}
}
