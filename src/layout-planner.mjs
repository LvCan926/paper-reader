import {chromium} from 'playwright';

// Preserve reading order. Summaries and explicitly linked blocks cannot be orphaned.
export function packMeasured(blocks,{firstHeight,otherHeight,gap=17,columns=3}) {
  if(!blocks.length) throw new Error('没有可排版的内容');
  const groups=[];
  for(let i=0;i<blocks.length;) {
    const group={blocks:[],height:0};
    do {
      const b=blocks[i++];
      if(!Number.isFinite(b.height)||b.height<=0) throw new Error(`无法测量 ${b.ref}`);
      group.height+=(group.blocks.length?gap:0)+b.height;
      group.blocks.push(b);
      if(!b.keepWithNext||i===blocks.length) break;
    } while(i<blocks.length);
    groups.push(group);
  }
  for(const g of groups) if(g.height>Math.max(firstHeight,otherHeight))
    throw new Error(`内容组超出单栏高度：${g.blocks.map(b=>b.ref).join(', ')}。请按语义拆分小节或图表，不能缩小字号。`);

  // Try the fewest pages first, then balance columns without reordering content.
  for(let pages=1;pages<=groups.length;pages++) {
    const slots=pages*columns,cache=new Map();
    function solve(slot,start) {
      if(slot===slots) return start===groups.length?{cost:0,parts:[]}:null;
      const key=`${slot}:${start}`;
      if(cache.has(key)) return cache.get(key);
      const capacity=slot<columns?firstHeight:otherHeight;
      let best=null,used=0;
      if(start===groups.length) {
        // Empty columns are permitted only at the end of the final page.
        if(slot>=slots-columns) best={cost:slots-slot,parts:Array.from({length:slots-slot},()=>[])};
      } else for(let end=start;end<groups.length;end++) {
        used+=(end>start?gap:0)+groups[end].height;
        if(used>capacity) break;
        const tail=solve(slot+1,end+1);
        if(!tail) continue;
        const cost=(1-used/capacity)**2+tail.cost;
        if(!best||cost<best.cost) best={cost,parts:[groups.slice(start,end+1).flatMap(g=>g.blocks),...tail.parts]};
      }
      cache.set(key,best);
      return best;
    }
    const found=solve(0,0);
    if(found) return Array.from({length:pages},(_,p)=>found.parts.slice(p*columns,(p+1)*columns));
  }
  throw new Error('内容无法排入三栏。请检查首个内容组是否超过首页高度。');
}

export async function planAutomatically({cards,createSheet,style}) {
  const sequence=cards.chapters.flatMap(c=>[
    {ref:`${c.id}/summary`,chapter:c.title,keepWithNext:true},
    ...c.sections.map(s=>({
      ref:`${c.id}/${s.id}`,chapter:c.title,keepWithNext:s.keep_with_next===true,
      ...(s.emphasis?{highlight:true}:{}),
      ...(s.media_first?{media_layout:'top'}:{})
    }))
  ]);
  const probe={title:cards.chapters.map(c=>c.title).slice(0,3).join(' · '),columns:[
    {width:1,blocks:sequence},{width:1,blocks:[]},{width:1,blocks:[]}
  ]};
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1019}});
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${style}</style>${createSheet({...probe,hero:true})}${createSheet(probe)}`);
    await page.evaluate(async()=>{
      await document.fonts.ready;
      await Promise.all([...document.images].map(i=>i.decode()));
    });
    const measurement=await page.evaluate(()=>{
      const sheets=[...document.querySelectorAll('.sheet')];
      const blocks=[...sheets[0].querySelectorAll('.section')].map(e=>({
        ref:e.dataset.ref,height:e.getBoundingClientRect().height
      }));
      const overflow=[...sheets[0].querySelectorAll('.section,.formula,p,h2,figcaption')]
        .filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent.slice(0,80));
      return {
        firstHeight:sheets[0].querySelector('main').getBoundingClientRect().height-8,
        otherHeight:sheets[1].querySelector('main').getBoundingClientRect().height-8,
        gap:parseFloat(getComputedStyle(sheets[0].querySelector('.section')).marginBottom),
        blocks,overflow
      };
    });
    if(measurement.overflow.length) throw new Error(`三栏宽度内存在横向溢出，请调整公式换行或表格结构：\n${measurement.overflow.join('\n')}`);
    const measured=sequence.map((b,i)=>({...b,height:measurement.blocks[i].height}));
    const pages=packMeasured(measured,measurement).map((cols,i)=>({
      title:[...new Set(cols.flat().map(b=>b.chapter))].join(' · '),
      ...(i===0?{hero:true}:{}),
      columns:cols.map(bs=>({width:1,blocks:bs.map(({height,chapter,keepWithNext,...b})=>b)}))
    }));
    return {
      version:3,format:'a4-landscape',layout:'equal-three-column',
      generated_by:'measured-flow',measurement,pages
    };
  } finally {await browser.close();}
}
