import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const old=JSON.parse(await fs.readFile(new URL('examples/cards.json',root),'utf8'));
const item=text=>({text,kind:'unknown',source_pages:[],quote:''});
const section=(title,text,tone='blue')=>({title,tone,items:[item(text)]});
const chapter=(id,title,summary,sections)=>({id,title,columns:2,summary:item(summary),sections});
const cards={title:'中文论文阅读稿：六章结构教学演示',subtitle:'背景 → 相关工作 → 方法 → 实验 → 局限 → 未来展望；页数由内容决定',source_label:'教学示例 / 不对应真实论文',chapters:[
  chapter('background','背景：研究问题与动机','本章用简洁中文回答：作者研究什么问题，为什么值得解决，现有办法在哪里遇到困难。',old.pages[0].sections.slice(0,2)),
  chapter('related_work','相关工作：技术路线与本文的位置','按技术路线归纳已有研究，解释本文沿用了什么、改进了什么，以及比较需要哪些条件。',[
    section('按技术思路分组','将论文讨论的相关工作分成两到四类，每类概述核心思路、适用问题及不足；不根据常识补充未经核实的引用。'),
    section('联系、差异与比较条件','写清已有方法依赖什么、本文改变了哪一步。作者对其他工作的评价和读者自己的比较推断要分开标识。','gold')
  ]),
  chapter('method','方法：机制、公式与原论文图','先概括输入、处理步骤和输出，再解释关键模块、训练目标及符号；复杂的方法可以占多页。',old.pages[1].sections),
  chapter('experiments','实验：设置、结果与证据','先对齐模型、数据、预算和指标，再总结主要结果、消融和失败案例；原论文正文图表全部收录。',old.pages[2].sections),
  chapter('limitations','局限：结论成立的边界','区分作者明确指出的不足、实验没有覆盖的情形，以及读者基于材料提出的判断。',[
    old.pages[3].sections[0],section('如何表达材料不足','论文没有讨论的成本、泛化或评测条件应标为信息缺失，不能将未测试直接解释为失败。','gold')
  ]),
  chapter('future_work','未来展望：作者明确提出的方向','仅整理正文中作者提出的后续工作；若原文没有提出，直接说明缺失。',[
    section('作者明确提出的方向','提炼论文结论或讨论中的未来工作，附原文页码和摘录；原文没有提出时写“原文未明确提出”。','green'),
    section('计划与结论的边界','作者提出的未来方向尚不等于已验证结果；只按正文交代的范围概述，不补写研究计划。','gold')
  ])
]};
await fs.writeFile(new URL('examples/chapters.json',root),JSON.stringify(cards,null,2),'utf8');
