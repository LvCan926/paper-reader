# 从 arXiv 链接生成中文论文阅读稿

本地命令行工具。输入 arXiv 链接，下载同一版本的 PDF 和作者提供的源码包，再用 Codex 整理论文，导出中文 PDF、高清 PNG、HTML 及可编辑 LaTeX 源文件。

在 GitHub 上可直接打开 **[论文目录](library/README.md)**，点击论文查看 PDF。下载仓库后，也可用浏览器打开 **[分类阅读库](library/index.html)** 搜索论文。`library/` 按研究方向保存已经逐页复核的 PDF；源码、图表裁剪和 HTML 等中间文件保存在本机的 `work/` 与 `output/pdf/`。

```text
library/
  智能体/
    系统自适应/harnessforge.pdf
    自我改进/rsiflow.pdf
    强化学习与蒸馏/beyond-timestamps.pdf
  模型基础/
    Transformer/attention-is-all-you-need.pdf
    激活函数/gelu.pdf
```

新论文在 `paper.json` 设置 `"category": ["智能体", "自我改进"]`。完成视觉复核后执行 `npm run library`，自动更新分类 PDF、可搜索的离线 HTML 索引、Markdown 目录与 `catalog.json`。同步会检查 PDF 与复核时的 SHA-256 是否一致，尚未复核或已改变的文件不会作为新交付稿收录。没有本地构建缓存时保留已有目录及已发布 PDF；新草稿也不会替换上次已复核的版本。

结构为**背景、相关工作、方法、实验、局限、未来展望**。仅参考正文，附录内容和图表全部排除。默认采用等宽三栏横版：Codex 精编内容后，程序按真实字体、公式和图片高度自动分页，最后检查实际 PDF。背景、相关工作先于方法，但不强制各占首页一栏。六章是内容维度，不强制分别分页；总页数由内容与可读性决定。

当前 Attention 精读稿为 **4 页 A4 横版，每页等宽三栏**，包含全部正文 2 幅图、4 张表和 6 组公式。间距略紧凑，用少量浅色卡片突出重点。页面仅展示论文相关文字，不展示来源页码标签、整理说明或页数计数；证据保留在内部数据中。重新生成：

```powershell
npm run attention
```

此命令读取已整理的内容，完成自动分页、PDF 导出和实际 PDF 预览渲染，并更新 `attention-is-all-you-need.pdf`。若旧文件被阅读器锁定，则另存带时间戳的新版；实际交付路径记录在输出目录的 `latest-output.json`。

通用流程见 **[WORKFLOW.md](WORKFLOW.md)**。每篇论文保存 `content.json`、`assets.json`、`paper.json` 和仅含已核对正文的 `source.json`，没有论文专用构建脚本。`source.json` 保留原 PDF 指纹和正文证据，附录文本不纳入仓库中的该快照。首次克隆后需按下文下载固定版本原 PDF，才能重建案例。

同一套引擎已用于 GELU 论文：`npm run gelu`。该案例只使用正文 1–6 页，保留全部 7 幅正文图，排除参考文献及附录。两个案例都由通用 `build` 命令测量分页，当前均为 4 页，这不是固定模板页数。

重点框采用窄浅色标题条、白色正文、细边框；只有 `emphasis:true` 的少量小节突出显示，章节概述不自动套框。公式使用 LaTeX / KaTeX，PDF 由 Chromium 输出；同时导出未编译验证的 LaTeX 伴随文档。

## 1. 安装和看演示

需要 Node.js 22.13 或更新版本，推荐 24。PowerShell：

```powershell
cd paper-reading
npm ci
npx playwright install chromium
npm run demo
Start-Process .\output\demo\cards.html
```

`npm run demo` 保留旧版卡片布局的教学演示，不是实际论文摘要；查看新版效果可直接打开 `library/` 的 PDF，或补齐原 PDF 后运行 `npm run attention`。重新排版需要系统具备中文字体；当前正式版使用宋体和微软雅黑，其他系统的字体回退可能影响分页，导出后仍需视觉复核。

### 首次克隆后重建已有论文

`work/`、`output/`、`tmp/` 和 `node_modules/` 不提交。仓库保留可直接阅读的 PDF、中文内容、正文证据快照与图表坐标，不提交完整论文下载缓存。

以 Attention 为例，下载时使用 `--download-only`，随后通过已有配置构建：

```powershell
node src/cli.mjs fetch https://arxiv.org/abs/1706.03762v7 --out work/arxiv-download-check --download-only
npm run attention
```

| 配置目录 | 固定 arXiv 版本 | 下载目录（`--out`） |
| --- | --- | --- |
| `papers/attention-is-all-you-need` | `1706.03762v7` | `work/arxiv-download-check` |
| `papers/gelu` | `1606.08415v5` | `work/gelu` |
| `papers/harnessforge` | `2606.01779v1` | `work/harnessforge` |
| `papers/rsiflow` | `2610.21791v1` | `work/rsiflow` |
| `papers/beyond-timestamps` | `2609.33391v1` | `work/beyond-timestamps` |

替换版本与目录即可下载其他案例，然后运行 `node src/cli.mjs build papers/案例目录`。构建会校验下载 PDF 的 SHA-256 与已核对正文快照一致；不一致时应重新核对材料，不能直接放宽校验。正文快照只用于重建已整理稿，重新整理或更新论文版本仍需依 WORKFLOW.md 核对 PDF 与 TeX 引用链。

## 2. 从 arXiv 链接开始

```powershell
node src/cli.mjs fetch https://arxiv.org/abs/1706.03762 --out work/my-paper
```

上面是《Attention Is All You Need》的示例链接，替换为目标论文。接受 abs/pdf/html/src 链接或论文编号，也支持旧式编号和 v1/v2 等明确版本。

工具会：

1. 从摘要页确认具体版本，避免 PDF 与源码来自不同版本。
2. 从 arXiv 官方地址下载 PDF 与源码，顺序请求并留出间隔；不会自动重试限流响应。
3. 识别常见 tar.gz、tar 和单个 gzip TeX，检查路径、特殊文件及大小后解包。
4. 按页提取文本，并渲染所有页面供 Codex 查看。
5. 汇集 `.tex` 文字、列出入口与引用关系，准备阅读提示词和任务文件。

生成目录：

```text
work/my-paper/
  paper.pdf             原论文 PDF
  source.download       arXiv 原始源码响应
  latex-source/         解包后的作者源码、图、样式和参考文献等
  arxiv.json            请求编号、实际版本、下载状态和文件清单
  source.json           PDF 逐页文本和文件指纹
  paper.txt             便于直接阅读的提取文本
  previews/page-N.png   原论文逐页预览
  tex-source.txt        汇集的 TeX 文字（有源码时）
  tex-index.json        主文件候选、input/include 和图片引用（有源码时）
  assets.json           需核对的原图表清单
  prompt.txt            prepare 后写入六章要求、格式示例与正文材料
  codex-task.txt        可直接交给 Codex 执行的本地任务说明
  paper.json            通用构建配置；所有路径相对此文件
```

有些 arXiv 论文没有公开可用的 LaTeX 源码。工具会保留 PDF，在 `arxiv.json` 写明原因，不会用模型伪造作者源码。下载失败和“不提供 TeX”也会分别记录原因。源码包中的文件不会被自动编译或执行。

只下载而不提取预览：

```powershell
node src/cli.mjs fetch https://arxiv.org/abs/1706.03762v7 --out work/my-paper --download-only
```

再次运行会先确认版本，再复用已有 PDF 和可用源码。同一输出目录禁止混入另一篇论文或另一版本。

## 3. 用 Codex 整理内容并得到 PDF

可以直接在当前 Codex 对话里说：

> 请读取 work/my-paper/codex-task.txt，完成论文整理。先确认正文边界，再运行 prepare；只依据正文及其 TeX 核对公式，收录全部正文图表，排除附录的一切内容和图表，按六章提炼中文内容并导出 PDF，最后检查每一页。

Codex 负责读材料、查看图片、整理中文和操作本地文件，项目里的渲染器负责生成 PDF。使用当前 Codex 工作流时，不必调用本项目的 OpenAI API 接口；账户是否能使用 Codex 以你的实际登录与权限为准。

也可在已登录的 Codex CLI 中发起任务：

```powershell
codex --skip-git-repo-check "请读取 work/my-paper/codex-task.txt 并完成论文整理与 PDF 导出，检查全部输出页面。"
```

如果本机交互入口不接受该参数，在项目目录运行 `codex`，进入后粘贴上面的任务即可。不要使用 PowerShell 默认编码的文本管道传递整段中文提示词，直接让 Codex 读取 UTF-8 文件。

需要自动化时，官方 CLI 提供非交互入口：

```powershell
codex exec --skip-git-repo-check --sandbox workspace-write "请读取 work/my-paper/codex-task.txt，完成其中任务并导出 PDF。"
```

这些命令会真实发起 Codex 任务；本次只核对了已安装 CLI 的版本和帮助，没有额外启动一个 Codex 会话。源码解析、排版和下载不调用模型；整理论文需要 Codex 或其他模型。

### 中文内容的要求

| 章节 | 重点 |
| --- | --- |
| 背景 | 问题、动机、任务设定、核心贡献 |
| 相关工作 | 技术路线、已有不足、本文的联系与差异 |
| 方法 | 输入输出、关键机制、训练推理、公式与符号 |
| 实验 | 设置、基线、主要结果、消融、失败案例 |
| 局限 | 作者承认的不足、适用边界、证据覆盖范围 |
| 未来展望 | 作者明确提出的方向，不添加读者提案 |

每章有 `summary` 概述。各小节用简洁连贯的中文提炼，不逐句硬译，也不为了页数省略核心内容。论文没有明确给出未来工作时，要注明“原文未明确提出”，不能替作者编造计划。

## 4. 公式使用 LaTeX 源码

在 `cards.json` 的小节内使用：

```json
"formulas": [{
  "latex": "\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}\\!\\left(\\frac{QK^{\\mathsf T}}{\\sqrt{d_k}}\\right)V",
  "explanation": "Q、K、V 分别为查询、键和值；缩放后的相似度经过 softmax 得到注意力权重，再对 V 加权。正式稿需按论文核对。",
  "source_pages": [4],
  "quote": "这里替换为该页公式附近真实存在的连续原文摘录。"
}]
```

公式不加 `$` 或 `\[` 外层定界符。JSON 中反斜线写两次。有作者 `.tex` 时优先复用；自定义宏按定义展开，并核对主文件的引用链。源码包里未参与正文编译的旧稿、实验稿不能当作正文。

网页/PDF 中由 KaTeX 排版公式，同时生成 `cards.tex` 和 `formula-source.json`。**当前 PDF 由 Chromium 导出，并不是对 `cards.tex` 的编译结果。** XeLaTeX 不是当前流程的依赖，导出的完整 `.tex` 尚未通过真实 TeX 编译验证。

若之后安装 MiKTeX 或 TeX Live，可进入输出目录尝试：

```powershell
xelatex -no-shell-escape -interaction=nonstopmode -halt-on-error cards.tex
```

LaTeX 后端使用普通文档结构，分页与当前横版 HTML 模板可以不同。复杂自定义宏和很长公式仍可能需要手工调整。

## 5. 正文原图和原表必须收录

不能只生成一份精简中文表来替代论文原表。工具通过 `assets.json` 管理正文图表，每个收录项都必须放进阅读稿。

```json
{
  "reviewed": true,
  "assets": [{
    "id": "fig-1",
    "type": "figure",
    "scope": "body",
    "label": "Figure 1",
    "source_page": 3,
    "box": [0.30, 0.08, 0.70, 0.54],
    "caption": "原论文方法总览图的中文说明。坐标仅为示例，需查看目标论文后调整。",
    "include": true
  }]
}
```

- `type` 是 `figure` 或 `table`；收录图表的 `scope` 必须是 `body`。
- `box` 是左、上、右、下相对页面尺寸的比例，原点在左上角。渲染器按此从原 PDF 裁图，保留图形、表格和矢量文字的整体关系。
- 也可使用 `path` 指向已裁好的 PNG/JPEG，路径相对于 `assets.json`。使用现成图片时仍需自行核对它来自正确原文。
- 正文全部 `include:true`。附录文字、公式、实验、图表及相关解读全部排除；不能作为补充材料。
- `reviewed:true` 表示已对照原文完成清单核对，是核对记录，不是要求用户另行批准。
- `caption_candidates` 只是编号检索候选，可能把正文引用当图注，也可能遗漏。确认正文边界后只核对正文预览与参与正文编译的源码。

生成前先由 Codex 对照 PDF 和真实源码入口确认正文边界，在 `source.json` 写入 `body_scope:{reviewed:true,pages:[{number:1,text_start:0,text_end:正文末尾字符偏移}]}`。偏移按该页 `text` 的 JavaScript UTF-16 下标；正文与附录同页时也必须截断，不能仅凭页码放行。未核对边界时生成和正式导出会报错。

运行 `node src/cli.mjs prepare work/paper` 后，`prompt.txt` 只包含选定正文片段。完整下载的 PDF/TeX 留作原始输入存档，不会整体送给生成模型。若需要源码，Codex 只将正文引用链内的源码整理到 `tex-body.txt`，核对排除附录后设置 `body_scope.tex_reviewed:true`；否则提示词只使用正文 PDF 文本。`generate` 每次会重新执行 prepare，避免误用旧提示词。

正式导出会检查每条概述、段落和公式的页码及摘录是否在正文片段内；图片必须引用已核对的正文资产清单，附录资产即使填写 `include:true` 也会被拒绝。机器检查不能替代对正文范围和图表裁剪的核对。

在对应章节的小节内引用：

```json
"images": [{"asset_id": "fig-1"}, {"asset_id": "table-1"}]
```

每张图或表放在对应小节内，与中文解释就近排布，保留必要图注；原文页码仅保存在内部清单。非常长的图表可以拆成多个带子编号的裁剪项，避免文字缩得太小；裁剪时保留脚注、图例及单位。程序会拒绝正文清单项被排除、引用不存在的图表或已收录图表没有插入稿件的情况。**它只能检查已声明清单的覆盖，不能证明清单本身没有漏项**，所以仍需要 Codex 的逐页核对。

## 6. 通用构建与导出

```powershell
node src/cli.mjs audit work/my-paper/cards.json --source work/my-paper/source.json
node src/cli.mjs build work/my-paper
# 同一入口读取已完成的案例：
node src/cli.mjs build papers/attention-is-all-you-need/paper.json
node src/cli.mjs build papers/gelu/paper.json
```

`audit` 检查中文条目、章节概述和公式定位摘录的页码及文字。`paper` 是原文陈述，`interpretation` 是读者解释，两者都需要出处；`unknown` 表示缺失或待确认。摘录存在不能证明中文结论、公式或数据一定正确，仍需语义核对。

导出：

- `cards.pdf`：实际页数的中文阅读稿。
- `page-1.png` 至 `page-N.png`：宽 2880 像素的逐页预览；review-pdf 会用实际 PDF 重新渲染。
- `cards.html`：可离线打开，公式字体和图片已内嵌。
- `cards.tex`：完整中文 LaTeX 文档源码；配套图片在 `images/`。
- `formula-source.json`：公式 LaTeX、解释和出处。
- `page-plan.json`：自动生成的等宽三栏分页计划，附各模块实测高度。
- `layout-check.json`：各栏使用高度、占用比例和溢出检测结果。
- `pdf-verification.json`：实际 PDF 页数、页面尺寸与预览生成记录。

默认自动测量并生成 `page-plan.json`，不会加载遗留计划。每个概述和小节恰好放置一次，保持六章顺序，概述与首节同栏。可显式传 `--plan` 覆盖；仅用于必要的人工方案。

`paper.json` 配置示例（路径相对该文件）：

```json
{
  "content": "cards.json",
  "source": "source.json",
  "assets": "assets.json",
  "pdf": "paper.pdf",
  "output": "../../output/pdf/my-paper",
  "filename": "my-paper.pdf",
  "category": ["研究方向", "具体主题"]
}
```

每个小节需要唯一 `id`。少量重点小节可设 `emphasis:true`；`media_first:true` 将图表放在说明之前；`keep_with_next:true` 把连续小节绑定。超高模块或过宽公式会点名报错，需要按语义拆分或调整公式换行，不会自动缩字号、删图或丢内容。

构建后 `workflow-status.json` 为 `awaiting_visual_review`。查看全部实际 PDF 预览后，才能记录为 `reviewed` 并写下所查页码。图片裁剪是否完整、解释是否准确、留白是否合理，仍需 Codex 复核。`build` 是构建命令，不会自行调用模型理解论文。

## 7. 本地 PDF、其他模型和开发

已有 PDF 和源码目录：

```powershell
node src/cli.mjs extract paper.pdf --tex-source author-source --out work/my-paper
```

没有源码时省略 `--tex-source`。扫描 PDF 可生成预览，但没有 OCR，不适合直接交给文本 API 做可靠摘要。

保留可选的文本生成接口：

```powershell
node src/cli.mjs generate work/my-paper --provider ollama --model "本机实际模型名称"
# 或在进程环境中设置 OPENAI_API_KEY 后：
node src/cli.mjs generate work/my-paper --provider openai --model "账户可用的模型名称"
```

这两条接口只发送 `prompt.txt` 的文本，当前不发送图片或图表清单，也未实现长论文自动分块；不会完成原图表的核对和自动定位。建议此任务用 Codex 工作流。长论文先按章整理带页码证据，再汇总为六章。云接口会发送论文文本，按所选服务计费；项目不读取 `.env`，不会自动重试收费请求。

项目入口：`src/cli.mjs`；arXiv 下载：`src/arxiv.mjs`；通用构建：`src/workflow.mjs`；高度测量与分页：`src/layout-planner.mjs`；排版：`src/editorial-renderer.mjs` 与 `src/editorial.css`；实际 PDF 检查：`scripts/review-pdf.mjs`。旧版演示保留在 `src/renderer.mjs` 与 `src/style.css`。

```powershell
npm run check
npm test
```

测试覆盖六章结构、正文边界、同页附录拦截、提示词过滤、图表清单、引用摘录、arXiv 版本、归档路径防护、单文件 gzip TeX，以及自动分页的阅读顺序、概述绑定、栏高平衡和超高拒绝。分页测试覆盖一页、两页和六页，不依赖四页。

阅读库已有 Attention、GELU、HarnessForge、RSIFlow 和 Beyond Timestamps 五篇案例，均下载实际 PDF 和作者源码，经同一引擎生成。通用性指不同论文只更换数据和配置，不代表已覆盖所有扫描件、异常长公式及论文类型。Ollama/OpenAI 文本生成接口尚未用真实账户实测，导出的 TeX 尚未真实编译。

参考：[arXiv 下载文件的格式](https://info.arxiv.org/help/unpack.html)、[arXiv 使用规则](https://info.arxiv.org/help/api/tou.html)、[Codex CLI](https://learn.chatgpt.com/docs/codex/cli)、[Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[KaTeX](https://katex.org/docs/api)、[Playwright PDF](https://playwright.dev/docs/api/class-page#page-pdf)。
