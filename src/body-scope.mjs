// 正文边界由 Codex 对照 PDF/源码核对；不根据关键词猜测并默默纳入附录。
export function bodyPages(source) {
  const scope=source.body_scope;
  if(scope?.reviewed!==true || !Array.isArray(scope.pages) || !scope.pages.length) throw new Error('请先核对 source.json 的 body_scope 正文边界并设置 reviewed:true');
  const seen=new Set();
  return scope.pages.map(range=>{
    const page=source.pages.find(p=>p.number===range.number);
    if(!page || seen.has(range.number)) throw new Error('body_scope 页码不存在或重复');
    seen.add(range.number);
    const start=range.text_start,end=range.text_end;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>page.text.length) throw new Error('body_scope 需要有效的正文 text_start/text_end 字符边界');
    return {...page,text:page.text.slice(start,end)};
  });
}
