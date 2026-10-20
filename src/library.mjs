import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const html=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function categoryPath(category) {
  if(!Array.isArray(category)||!category.length||category.some(s=>typeof s!=='string'||!s.trim()||/[\\/:*?"<>|]/.test(s)||s==='.'||s==='..'||/[. ]$/.test(s))) {
    throw new Error('category 必须为目录名数组，不含路径分隔符或上级目录');
  }
  return path.join(...category);
}
export async function syncLibrary(papersDir='papers',libraryDir='library') {
  const root=path.resolve(libraryDir),entries=[],targets=new Set();
  // A checkout includes published PDFs but excludes local build caches.
  // Keep those verified entries when no replacement has been reviewed locally.
  let published=[];
  try {published=await read(path.join(root,'catalog.json'));}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  if(!Array.isArray(published))throw new Error('阅读库 catalog.json 必须为数组');
  const owners=new Map();
  for(const entry of published) {
    if(typeof entry.path!=='string'||typeof entry.config!=='string'||typeof entry.title!=='string'
      ||!Number.isInteger(entry.pages)||entry.pages<1||!/^[a-f0-9]{64}$/.test(entry.sha256??'')) throw new Error('阅读库条目格式无效');
    categoryPath(entry.category);
    const file=path.resolve(root,entry.path),relative=path.relative(root,file);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!file.endsWith('.pdf')) throw new Error('阅读库 PDF 路径必须位于阅读库中');
    const hash=createHash('sha256').update(await fs.readFile(file)).digest('hex');
    if(hash!==entry.sha256)throw new Error(`已收录的 PDF 指纹不符：${entry.path}`);
    const key=file.toLowerCase();
    if(targets.has(key))throw new Error(`分类目录文件名冲突：${entry.path}`);
    targets.add(key);owners.set(key,path.resolve(root,entry.config));
    entries.push(entry);
  }
  for(const dir of await fs.readdir(papersDir,{withFileTypes:true})) {
    if(!dir.isDirectory()) continue;
    const configFile=path.resolve(papersDir,dir.name,'paper.json');
    let config;try {config=await read(configFile);} catch(error) {if(error.code==='ENOENT')continue;throw error;}
    if(!config.category) continue;
    const base=path.dirname(configFile),out=path.resolve(base,config.output??'output');
    let state;try {state=await read(path.join(out,'workflow-status.json'));} catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(state.status!=='reviewed') {console.log(`尚未视觉复核，暂不收录：${dir.name}`);continue;}
    const bytes=await fs.readFile(state.pdf),hash=createHash('sha256').update(bytes).digest('hex');
    if(hash!==state.visual_review?.pdf_sha256) throw new Error(`${dir.name} 的 PDF 已改变，需要重新视觉复核`);
    const filename=config.filename??path.basename(state.pdf);
    if(path.basename(filename)!==filename||!filename.endsWith('.pdf')) throw new Error('PDF 文件名无效');
    const folder=path.join(root,categoryPath(config.category)),dest=path.join(folder,filename);
    if(targets.has(dest.toLowerCase())&&owners.get(dest.toLowerCase())!==configFile) throw new Error(`分类目录文件名冲突：${dest}`);
    targets.add(dest.toLowerCase());
    owners.set(dest.toLowerCase(),configFile);
    await fs.mkdir(folder,{recursive:true});
    let actual=dest;
    try {await fs.writeFile(dest,bytes);}
    catch(error) {
      if(!['EBUSY','EPERM','EACCES'].includes(error.code))throw error;
      actual=path.join(folder,`${filename.slice(0,-4)}-${hash.slice(0,8)}.pdf`);
      await fs.writeFile(actual,bytes);
    }
    const content=await read(path.resolve(base,config.content)),source=await read(path.resolve(base,config.source));
    const verify=await read(path.join(out,'pdf-verification.json'));
    const previous=entries.findIndex(e=>path.resolve(root,e.config)===configFile);
    if(previous>=0)entries.splice(previous,1);
    entries.push({title:content.title,category:config.category,pages:verify.actual_pages,
      path:path.relative(root,actual).replaceAll('\\','/'),sha256:hash,
      arxiv:source.arxiv?.id??null,config:path.relative(root,configFile).replaceAll('\\','/')});
  }
  entries.sort((a,b)=>a.category.join('/').localeCompare(b.category.join('/'),'zh-CN')||a.title.localeCompare(b.title));
  await fs.mkdir(root,{recursive:true});
  await fs.writeFile(path.join(root,'catalog.json'),JSON.stringify(entries,null,2));
  const url=s=>s.split('/').map(encodeURIComponent).join('/');
  const rows=entries.map(e=>`| ${e.category.join(' / ')} | [${e.title.replaceAll('|','\\|')}](${url(e.path)}) | ${e.pages} | ${e.arxiv?`[${e.arxiv}](https://arxiv.org/abs/${e.arxiv})`:''} |`);
  await fs.writeFile(path.join(root,'README.md'),`# 中文论文阅读库\n\n按研究方向分类的已复核 PDF。点击论文标题打开阅读稿；原始材料和排版文件保留在 work/ 与 output/pdf/。\n\n| 研究方向 | 论文 | 页数 | 原文 |\n| --- | --- | ---: | --- |\n${rows.join('\n')}\n\n更新：\`node src/cli.mjs library\`。新论文在 paper.json 中设置 category，完成视觉复核后再收录。\n`);
  await fs.writeFile(path.join(root,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>中文论文阅读库</title><style>body{max-width:1100px;margin:60px auto;padding:0 24px;font:16px/1.7 "Microsoft YaHei",sans-serif;color:#263c45;background:#fafbf9}h1{font-size:30px}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:16px;border-bottom:1px solid #d9e2e1}th{background:#eef4f3}a{color:#215b74;text-decoration:none}a:hover{text-decoration:underline}.category{white-space:nowrap;color:#607477}input{padding:12px;width:calc(100% - 26px);margin:12px 0 24px;border:1px solid #b9c9cd;border-radius:4px;font:inherit}</style><h1>中文论文阅读库</h1><input aria-label="搜索论文或方向" placeholder="搜索论文或研究方向" oninput="document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase()))"><table><thead><tr><th>研究方向</th><th>论文</th><th>页数</th><th>原文</th></tr></thead><tbody>${entries.map(e=>`<tr><td class="category">${e.category.map(html).join('<br>')}</td><td><a href="${url(e.path)}">${html(e.title)}</a></td><td>${e.pages}</td><td>${e.arxiv?`<a href="https://arxiv.org/abs/${html(e.arxiv)}">arXiv</a>`:''}</td></tr>`).join('')}</tbody></table></html>`);
  console.log(`阅读库已收录 ${entries.length} 篇：${root}`);
  return entries;
}
