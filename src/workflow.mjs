import fs from 'node:fs/promises';
import path from 'node:path';
import {renderEditorial} from './editorial-renderer.mjs';
import {reviewPDF} from '../scripts/review-pdf.mjs';

export async function buildPaper(input,{out:overrideOut,plan:overridePlan}={}) {
  const configPath=path.resolve(input.endsWith('.json')?input:path.join(input,'paper.json'));
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  const base=path.dirname(configPath),resolve=file=>path.resolve(base,file);
  for(const key of ['content','source','assets','pdf']) {
    if(typeof config[key]!=='string'||!config[key]) throw new Error(`paper.json 缺少 ${key}`);
    try {await fs.access(resolve(config[key]));}
    catch {throw new Error(`缺少 ${key} 文件：${resolve(config[key])}。请依 WORKFLOW.md 完成正文整理与图表核对。`);}
  }
  const out=overrideOut?path.resolve(overrideOut):resolve(config.output??'output');
  const name=config.filename??'paper.pdf';
  if(path.basename(name)!==name||!name.endsWith('.pdf')) throw new Error('filename 必须是不含路径的 PDF 文件名');
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'workflow-status.json'),JSON.stringify({status:'building',config:configPath},null,2));
  await renderEditorial(resolve(config.content),out,resolve(config.source),{
    assetsPath:resolve(config.assets),pdfPath:resolve(config.pdf),
    ...(overridePlan?{planPath:path.resolve(overridePlan)}:{})
  });
  await reviewPDF(path.join(out,'cards.pdf'));
  let delivered=path.join(out,name);
  try {await fs.copyFile(path.join(out,'cards.pdf'),delivered);}
  catch(error) {
    if(!['EBUSY','EPERM','EACCES'].includes(error.code)) throw error;
    delivered=path.join(out,`${name.slice(0,-4)}-${Date.now()}.pdf`);
    await fs.copyFile(path.join(out,'cards.pdf'),delivered);
    console.log('旧 PDF 被占用，已另存新版。');
  }
  const state={status:'awaiting_visual_review',config:configPath,pdf:delivered,plan:path.join(out,'page-plan.json'),previews:out};
  await fs.writeFile(path.join(out,'latest-output.json'),JSON.stringify({pdf:delivered},null,2));
  await fs.writeFile(path.join(out,'workflow-status.json'),JSON.stringify(state,null,2));
  console.log(`已生成 ${delivered}。请逐页检查实际 PDF 预览；自动检查不替代内容与视觉复核。`);
  return state;
}
