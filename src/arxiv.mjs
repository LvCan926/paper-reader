import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import * as tar from 'tar';

export function arxivId(input) {
  let id = input.trim().replace(/^arxiv:/i,'');
  if (/^https?:/i.test(id)) {
    const u = new URL(id);
    if (!['arxiv.org','www.arxiv.org','export.arxiv.org'].includes(u.hostname) || u.username || u.password) throw new Error('只接受 arxiv.org 的论文链接');
    id = decodeURIComponent(u.pathname).replace(/^\/(abs|pdf|html|src|e-print)\//,'').replace(/\.pdf$/,'');
  }
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v[1-9]\d*)?$/.test(id)) throw new Error('无法识别 arXiv 编号，请使用 https://arxiv.org/abs/编号');
  return id;
}

export function safeArchiveEntry(entry) {
  const name = entry.path.replaceAll('\\','/');
  if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(p => p === '..' || p.includes(':')) || /[\x00-\x1f]/.test(name)) throw new Error(`拒绝不安全的源码路径：${entry.path}`);
  if (!['File','OldFile','Directory'].includes(entry.type)) throw new Error(`拒绝源码中的链接或特殊文件：${entry.path}`);
}

export function resolveArxivVersion(html, requestedId) {
  if (/v\d+$/.test(requestedId)) return requestedId;
  const meta=html.match(/name=["']citation_pdf_url["'][^>]*content=["'][^"']*\/pdf\/([^"']+)/i)?.[1]?.replace(/\.pdf$/,'');
  const candidates=[...(meta?[meta]:[]),...[...html.matchAll(/arXiv:([A-Za-z0-9./-]+v\d+)/g)].map(m=>m[1])];
  const version=candidates.find(id=>id.replace(/v\d+$/,'')===requestedId && /v\d+$/.test(id));
  if (!version) throw new Error('未能确认 arXiv 论文版本，请使用包含 v1/v2 等版本的链接');
  return arxivId(version);
}

async function download(url, dest) {
  const r = await fetch(url,{headers:{'User-Agent':'PaperReadingCards/0.2 (local personal paper reader; single requests)'},signal:AbortSignal.timeout(120000)});
  if (!r.ok) throw new Error(`arXiv 下载失败 HTTP ${r.status}：${url}${r.status === 429 ? '；请稍后重试，勿连续请求' : ''}`);
  if (!['arxiv.org','export.arxiv.org','www.arxiv.org'].includes(new URL(r.url).hostname)) throw new Error('arXiv 下载被重定向至未知站点');
  const chunks=[]; let total=0;
  for await (const chunk of r.body) {
    total += chunk.length;
    if (total > 80*1024*1024) throw new Error('单个下载超过 80 MB，请手动获取');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  await fs.writeFile(dest,bytes);
  return bytes;
}

export async function unpackSource(bytes, out) {
  const sourceDir=path.join(out,'latex-source');
  await fs.mkdir(sourceDir,{recursive:true});
  if ((await fs.readdir(sourceDir)).length) throw new Error('latex-source 已有内容；请使用新的 --out 目录，避免混入其他版本源码');
  let raw=bytes;
  if (raw[0] === 0x1f && raw[1] === 0x8b) raw=gunzipSync(raw,{maxOutputLength:160*1024*1024});
  if (raw.subarray(0,5).toString() === '%PDF-') return {available:false,reason:'arXiv 返回的是 PDF，没有提供 LaTeX 源码'};
  if (/^\s*(?:<!doctype html|<html)/i.test(raw.subarray(0,1000).toString())) throw new Error('arXiv 返回网页，未得到源码包；请检查访问限制');
  const tarPath=path.join(out,'source.unpacked.tar');
  let entries=[];
  // 源码也可能是单个 gzip 压缩的 TeX 文件。
  if (raw.subarray(257,262).toString()==='ustar' || raw.subarray(0,512).includes(0)) {
    await fs.writeFile(tarPath,raw);
    let total=0, violation;
    await tar.t({file:tarPath,strict:true,onentry:e=>{
      try { safeArchiveEntry(e); } catch (err) { violation ??= err; }
      total += e.size;
      entries.push({path:e.path,type:e.type,size:e.size});
      if (entries.length>5000 || total>300*1024*1024) violation ??= new Error('源码展开后文件过多或体积超过限制');
    }});
    if (violation) throw violation;
    if (!entries.length) throw new Error('源码归档为空或格式不支持');
    await tar.x({file:tarPath,cwd:sourceDir,strict:true,preservePaths:false,filter:(name,e)=>{safeArchiveEntry(e);return true;}});
    await fs.unlink(tarPath);
  } else {
    const text=raw.toString('utf8');
    if (!/\\(?:documentclass|documentstyle|begin\{document\}|input|section)/.test(text)) return {available:false,reason:'源码不是可识别的 LaTeX/TeX 文件'};
    await fs.writeFile(path.join(sourceDir,'main.tex'),raw);
    entries=[{path:'main.tex',type:'File',size:raw.length}];
  }
  const texFiles=entries.filter(e=>e.path.toLowerCase().endsWith('.tex')).map(e=>e.path);
  return {available:texFiles.length>0,reason:texFiles.length ? undefined : '源码包中没有 .tex 文件',directory:sourceDir,tex_files:texFiles,files:entries};
}

export async function fetchArxiv(input, out) {
  const requestedId=arxivId(input);
  out=path.resolve(out);
  await fs.mkdir(out,{recursive:true});
  // 用 abs 页解析带版本的 id，确保 PDF 与源码对应同一次投稿。
  const landing=await download(`https://arxiv.org/abs/${requestedId}`,path.join(out,'abstract.html'));
  const html=landing.toString('utf8');
  const base=requestedId.replace(/v\d+$/,'');
  const id=resolveArxivVersion(html,requestedId);
  if (id.replace(/v\d+$/,'') !== base) throw new Error('arXiv 返回的论文编号不匹配');
  let cached;
  try {cached=JSON.parse(await fs.readFile(path.join(out,'arxiv.json'),'utf8'));} catch {}
  if(cached?.resolved_id && cached.resolved_id!==id) throw new Error('输出目录已有其他论文或版本，请使用新的 --out 目录');
  if(cached?.resolved_id===id&&cached.source.available) {
    try {
      const pdf=path.join(out,'paper.pdf'),directory=path.join(out,'latex-source');
      await fs.access(pdf);await fs.access(directory);
      console.log(`复用已下载的 arXiv:${id} PDF 与源码`);
      return {...cached,pdf,source:{...cached.source,directory}};
    } catch {}
  }
  await new Promise(r=>setTimeout(r,3100));
  const pdfPath=path.join(out,'paper.pdf');
  const pdf=await download(`https://arxiv.org/pdf/${id}`,pdfPath);
  if (pdf.subarray(0,5).toString() !== '%PDF-') throw new Error('下载响应不是 PDF，可能触发访问限制');
  await new Promise(r=>setTimeout(r,3100));
  let source;
  try {
    const archive=await download(`https://arxiv.org/src/${id}`,path.join(out,'source.download'));
    source=await unpackSource(archive,out);
  } catch (error) {
    source={available:false,reason:error.message};
  }
  const record={requested_id:requestedId,resolved_id:id,url:`https://arxiv.org/abs/${id}`,pdf:pdfPath,source};
  await fs.writeFile(path.join(out,'arxiv.json'),JSON.stringify(record,null,2));
  console.log(`已下载 arXiv:${id} PDF；${source.available ? `找到 ${source.tex_files.length} 个 TeX 文件` : `源码不可用：${source.reason}`}`);
  return record;
}
