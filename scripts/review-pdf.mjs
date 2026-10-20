import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCanvas} from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function reviewPDF(input,out=path.dirname(input)) {
await fs.mkdir(out,{recursive:true});
const pkg=path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const resource=name=>path.join(pkg,name).replaceAll('\\','/')+'/';
const task=pdfjs.getDocument({data:new Uint8Array(await fs.readFile(input)),isEvalSupported:false,useSystemFonts:true,cMapUrl:resource('cmaps'),cMapPacked:true,standardFontDataUrl:resource('standard_fonts'),wasmUrl:resource('wasm')});
const doc=await task.promise,records=[];
try{
  const layout=JSON.parse(await fs.readFile(path.join(path.dirname(input),'layout-check.json'),'utf8'));
  if(doc.numPages!==layout.pages) throw new Error(`实际 PDF ${doc.numPages} 页与页面计划 ${layout.pages} 页不一致`);
  for(let n=1;n<=doc.numPages;n++){
    const p=await doc.getPage(n),viewport=p.getViewport({scale:2880/p.getViewport({scale:1}).width});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    await fs.writeFile(path.join(out,`page-${n}.png`),canvas.toBuffer('image/png'));
    const text=(await p.getTextContent()).items.map(i=>i.str).join(' ');
    if(text.trim().length<50) throw new Error(`PDF 第 ${n} 页文本异常稀少`);
    records.push({page:n,size_points:p.view.slice(2),text_characters:text.length});
  }
  await fs.writeFile(path.join(path.dirname(input),'pdf-verification.json'),JSON.stringify({actual_pages:doc.numPages,matches_plan:true,previews_from:'actual_pdf',pages:records},null,2));
  console.log(`实际 PDF 共 ${doc.numPages} 页；已重新渲染逐页 PNG，等待视觉检查。`);
}finally{await task.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]) throw new Error('用法：node scripts/review-pdf.mjs 文件.pdf [预览目录]');
  await reviewPDF(process.argv[2],process.argv[3]);
}
