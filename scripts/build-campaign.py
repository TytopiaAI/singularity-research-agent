"""Compose editable posters around real, cropped application captures."""
import os
from pathlib import Path
from PIL import Image
import base64, json, re, shutil

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/singularity-campaign-2026-10-22'
ASSETS=OUT/'assets'; ASSETS.mkdir(exist_ok=True)
SHOTS=OUT/'screenshots'
def crop(name, box, target=None):
    im=Image.open(SHOTS/(name+'.png')).convert('RGB')
    w,h=im.size; im=im.crop(tuple(round(v*(w if i%2==0 else h)) for i,v in enumerate(box)))
    dest=ASSETS/((target or name)+'.jpg');im.save(dest,quality=96,subsampling=0);return dest

reader=crop('reader-final',(.065,.07,.99,.98),'reader')
context=crop('reader-context',(.735,.785,.985,.977),'reader-context-detail')
translation=crop('reader-context',(.755,.345,.985,.69),'reader-translation-detail')
graph=crop('field-graph',(.24,.30,.67,.81),'field-graph')
overview=crop('field-overview',(.245,.285,.95,.965),'field-summary')
cards=crop('field-papers',(.245,.16,.95,.88),'field-papers')
project=crop('project-experiment',(.245,.24,.95,.965),'project')
writing=crop('writing',(.233,.38,.95,.97),'writing')
voice=crop('voice',(.065,.08,.99,.98),'voice')
library=crop('library',(.065,.08,.99,.98),'library')
home_source=Path(os.environ['SINGULARITY_HOME_SHOT'])
home=Image.open(home_source).convert('RGB');w,h=home.size
home=home.crop((int(w*.075),int(h*.074),int(w*.984),int(h*.973)))
home.save(ASSETS/'home.jpg',quality=96,subsampling=0)
shutil.copy2(ROOT/'build/icon-ui.png',ASSETS/'singularity.png')
def data(file):
    p=Path(file);mime='image/png' if p.suffix=='.png' else 'image/jpeg'
    return 'data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode()
logo=data(ASSETS/'singularity.png')
def screenshot(file,label,style='',extra=''):
    return f'<figure class="screen {extra}" style="{style}"><figcaption><span class="dots"><i></i><i></i><i></i></span><span>{label}</span><small>SINGULARITY</small></figcaption><img src="{data(file)}" alt="{label} · 应用真实界面截图"/></figure>'
def feature(num,title,body):
    return f'<article class="feature"><span class="feature-no">{num}</span><h3>{title}</h3><p>{body}</p></article>'
def base(num,kicker,body,cls):
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>Singularity · {kicker}</title><style>{CSS}</style></head><body><main class="poster {cls}">
<div class="grain"></div><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div>
<header class="brand"><div class="wordmark"><img src="{logo}"><em>Singularity</em></div><div class="edition">THE RESEARCH WORKSPACE<br><b>{kicker}</b><span>2026.10 &nbsp; / &nbsp; {num:02d}—05</span></div></header>
{body}<footer><div><strong>All in one.</strong><span>One to master every stage.</span></div><small>真实界面 · 示例研究内容 &nbsp; / &nbsp; {num:02d}</small></footer></main></body></html>'''

CSS='''
*{box-sizing:border-box}html,body{margin:0;width:1080px;background:#e5e2da}body{font-family:"Microsoft YaHei","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}.poster{position:relative;width:1080px;height:1440px;overflow:hidden;background:#f5f2ea;color:#142630;--accent:#d45b42;--muted:#657174;--line:rgba(20,38,48,.15)}.grain{position:absolute;inset:0;opacity:.18;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Cpath fill='%23777' opacity='.12' filter='url(%23n)' d='M0 0h140v140H0z'/%3E%3C/svg%3E");pointer-events:none}.brand{position:absolute;left:56px;right:56px;top:48px;height:64px;display:flex;justify-content:space-between;align-items:flex-start}.wordmark{display:flex;align-items:center;gap:13px}.wordmark img{width:52px;height:52px;object-fit:contain}.wordmark em{font:italic 700 40px Georgia,serif;letter-spacing:-1.7px}.edition{text-align:right;font-size:11px;letter-spacing:1.65px;line-height:1.5;color:var(--muted)}.edition b{font-weight:600;letter-spacing:2px;display:block}.edition span{display:block;margin-top:6px;font-size:12px;letter-spacing:1px}.eyebrow{font-family:Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:3px;color:var(--accent);margin:0 0 22px}.headline{position:absolute;left:60px;right:50px;top:163px}.headline h1{font-size:82px;line-height:1.13;letter-spacing:-3.5px;margin:0;font-weight:700}.headline h1 .accent{color:var(--accent)}.headline .sub{font-size:22px;line-height:1.65;color:var(--muted);margin:23px 0 0;letter-spacing:.2px}.screen{margin:0;position:absolute;background:#fcfaf4;border:1px solid rgba(255,255,255,.6);border-radius:19px;overflow:hidden;box-shadow:0 25px 60px -22px rgba(19,27,39,.5);color:#28353a}.screen figcaption{height:34px;display:flex;align-items:center;gap:14px;background:#fffefa;font-size:11px;border-bottom:1px solid #deded5;padding:0 16px;font-weight:600;letter-spacing:.5px}.screen figcaption small{font:9px Arial;letter-spacing:1.5px;margin-left:auto;color:#87908e}.dots{display:flex;gap:4px}.dots i{width:5px;height:5px;border-radius:50%;background:#c7c7bd}.dots i:first-child{background:#ed9b7e}.screen img{width:100%;height:calc(100% - 34px);object-fit:cover;object-position:top;display:block}.screen.contain img{object-fit:contain}.screen.bare figcaption{display:none}.screen.bare img{height:100%}.features{position:absolute;display:grid;grid-template-columns:repeat(3,1fr);gap:28px;left:60px;right:60px;top:1146px}.feature{position:relative;border-top:1px solid var(--line);padding:19px 0 0}.feature-no{font:12px Arial;letter-spacing:2px;color:var(--accent)}.feature h3{font-size:23px;letter-spacing:-.5px;margin:10px 0 9px;font-weight:700}.feature p{font-size:14px;line-height:1.85;color:var(--muted);margin:0}.ribbon{position:absolute;left:60px;right:60px;top:1307px;padding-top:15px;font-size:12px;letter-spacing:.5px;color:var(--muted);border-top:1px solid var(--line);display:flex;justify-content:space-between}.pill{display:inline-block;padding:9px 15px;border:1px solid var(--line);border-radius:99px;font-size:13px;background:rgba(255,255,255,.23)}footer{position:absolute;left:60px;right:60px;bottom:34px;display:flex;align-items:end;justify-content:space-between;border-top:1px solid var(--line);padding-top:17px}footer>div{display:flex;gap:12px;align-items:baseline}footer strong{font:700 21px Arial,sans-serif;letter-spacing:-.7px}footer span{font:13px Arial,sans-serif;color:var(--muted)}footer small{font-size:9px;letter-spacing:.7px;color:var(--muted)}.caption{position:absolute;font-size:12px;line-height:1.9;color:var(--muted);letter-spacing:.5px}.orbit{position:absolute;border:1px solid var(--line);border-radius:50%;pointer-events:none}.orbit-a{width:1000px;height:550px;right:-540px;top:140px;transform:rotate(-35deg);opacity:.5}.orbit-b{width:1020px;height:570px;right:-550px;top:130px;transform:rotate(-35deg);opacity:.25}.overview{background:radial-gradient(ellipse at 98% 8%,#4c4b3d55,transparent 40%),radial-gradient(ellipse at 0% 100%,#174e5270,transparent 65%),#102532;color:#f7f1e4;--accent:#e9c58d;--muted:#afc0c5;--line:#afc0c52c}.overview .headline{top:168px}.overview .all{font:700 113px/.98 Arial,sans-serif;letter-spacing:-7px;margin:0}.overview .every{font:27px/1.5 Arial,sans-serif;letter-spacing:-.7px;margin-top:14px;color:#d8e3e5}.overview h1{font-size:60px;line-height:1.25;margin-top:30px;letter-spacing:-2.8px}.overview .lead{font-size:19px;line-height:1.7;color:var(--muted);margin-top:16px}.overview .features{top:1160px}.overview .feature h3{font-size:22px}.overview .caption{top:1080px;left:70px}.overview .ribbon{top:1314px}.reading{background:radial-gradient(ellipse at 85% 44%,#e5d6b94c,transparent 60%),#f7f3e9}.reading .headline h1{font-size:83px}.reading .features{top:1140px}.reading .ribbon{top:1310px}.field{background:radial-gradient(ellipse at 100% 4%,#20626c66,transparent 50%),#13323b;color:#f2f1e8;--accent:#b9ded7;--muted:#adc5c7;--line:#acc9ca38}.field .headline h1{font-size:78px}.field .features{top:1165px}.field .feature h3{font-size:22px}.field .ribbon{top:1315px}.project{background:radial-gradient(ellipse at 10% 70%,#f2cbb25c,transparent 65%),#f1eee6;--accent:#b95542}.project .headline h1{font-size:81px}.workspace{background:radial-gradient(ellipse at 85% 35%,#c4c9e5a6,transparent 60%),radial-gradient(ellipse at 0% 100%,#bcd8da69,transparent 55%),#eeeef3;--accent:#5a5a8c;--muted:#667082}.workspace .headline h1{font-size:81px}.workspace .features{top:1148px}.workspace .ribbon{top:1314px}.callout{position:absolute;border-left:3px solid var(--accent);padding:0 0 0 18px;color:var(--muted);font-size:15px;line-height:1.9}.callout b{display:block;color:inherit;font-size:19px;margin-bottom:6px}.number{font:12px Arial;letter-spacing:2px}.quote{position:absolute;left:60px;font-size:17px;color:var(--muted)}
'''

CSS+='''.overview .headline{top:150px}.overview .eyebrow{margin-bottom:17px}.overview .all{font-size:108px;line-height:1}.overview .every{font-size:27px;line-height:1.3;margin-top:12px}.overview h1{font-size:55px;line-height:1.2;margin-top:24px}.overview .lead{font-size:18px;line-height:1.5;margin-top:14px}'''
body=f'''<section class="headline"><p class="eyebrow">ONE CONNECTED RESEARCH JOURNEY</p><div class="all">All in one.</div><div class="every">One to master every stage.</div><h1>从一个问题，<br>到一篇有依据的论文。</h1><p class="lead">把发现、阅读、对话、实验记录与写作，连成同一段研究历程。</p></section>
{screenshot(reader,'论文阅读 · 原文、译文与研究上下文','left:60px;top:575px;width:960px;height:520px;transform:rotate(-1.2deg)')}
{screenshot(graph,'领域知识库 · 方向 × 时间','left:640px;top:897px;width:380px;height:225px;transform:rotate(3deg)')}
{screenshot(writing,'论文写作 · 论证与证据','left:77px;top:899px;width:360px;height:218px;transform:rotate(-3deg)')}
<section class="features">{feature('01 / DISCOVER','发现值得研究的问题','领域论文、前沿主线与持续月报，<br>形成会生长的研究知识库。')}{feature('02 / INVESTIGATE','把阅读变成研究依据','划选翻译、多段提问与原文定位，<br>让想法始终连着来源。')}{feature('03 / CREATE','让研究走向完整论证','方法版本、实验反馈与关联稿件，<br>从探索一路积累到成稿。')}</section><div class="ribbon"><span>AI 工作台 / 语音对话 / 科研发现 / AI 新闻</span><span>论文库 / 研究项目 / 论文写作 / 文件</span></div>'''
posters=[('01-整体介绍',base(1,'OVERVIEW',body,'overview'))]

body=f'''<section class="headline"><p class="eyebrow">PAPER READING & LIBRARY</p><h1>读懂论文，<br><span class="accent">也留住证据。</span></h1><p class="sub">从划选的一句话，到可以追溯的研究材料。</p></section>
{screenshot(reader,'论文阅读 · PDF 原文与右侧阅读卡片','left:60px;top:488px;width:960px;height:605px')}
{screenshot(context,'连续添加选段 · 围绕上下文提问','left:674px;top:845px;width:330px;height:243px;transform:rotate(2.3deg)','contain')}
<section class="features">{feature('01 / TRANSLATE','顺着阅读，理解原文','划选词句与段落翻译；跨页拼接。<br>正文、附录分开译，公式保留，译文保存。')}{feature('02 / ASK','让提问带上上下文','连续添加多个选段，再一起提问。<br>高亮、笔记与图表解读，收进阅读卡片。')}{feature('03 / TRACE','每份材料，都有来处','区分论文事实与研究推演。<br>点击依据回到 PDF，随时加入研究项目。')}</section><div class="ribbon"><span>本地论文库 · 导入 / 标签 / 分组 / 搜索</span><span>原文 → 理解 → 证据 → 下一步研究</span></div>'''
posters.append(('02-论文阅读与翻译',base(2,'READ & UNDERSTAND',body,'reading')))

body=f'''<section class="headline"><p class="eyebrow">DISCOVERY → LIVING FIELD KNOWLEDGE</p><h1>一个领域，<br><span class="accent">越研究，越清晰。</span></h1><p class="sub">推荐、综述与知识库合在一起，让每次检索留下积累。</p></section>
{screenshot(graph,'关系图谱 · 按方向与时间组织论文','left:60px;top:494px;width:650px;height:494px')}
<div style="position:absolute;left:750px;top:520px;width:270px"><p class="eyebrow" style="font-size:11px;letter-spacing:2px">CONNECT THE PAPERS</p><h2 style="font-size:32px;line-height:1.5;margin:20px 0 25px">把论文放回<br>研究脉络。</h2><div style="font-size:17px;line-height:2.2;color:var(--muted);border-top:1px solid var(--line);padding-top:22px">按方向组织<br>沿时间积累<br>标注机制联系</div><p style="font-size:13px;line-height:1.9;color:var(--muted);margin-top:26px">图谱与综述文档相互补充，<br>既看单篇论文，也看整体发展。</p></div>
{screenshot(cards,'领域论文 · 方法、数据与评估','left:60px;top:1010px;width:516px;height:128px')}
<div class="callout" style="left:612px;top:1020px;width:390px"><b>看清联系，也保留边界。</b>时间线、相似线索与人工标注关系并列，<br>帮助形成下一步值得验证的问题。</div>
<section class="features">{feature('PAST / 过去','梳理近两年发展','按领域与子领域整理顶会顶刊、<br>arXiv 前沿，比较方法、数据与评估。')}{feature('PRESENT / 现在','聚焦三条研究主线','从推荐卡片看懂关键机制与贡献边界。<br>标星重点论文，下载并加入本地论文库。')}{feature('FUTURE / 未来','持续跟进，而非一次总结','综述文档随论文积累不断更新。<br>每月跟进新进展，保留自己的研究笔记。')}</section><div class="ribbon"><span>自定义主题 / 跨领域思路 / 重点收藏</span><span>关注数据泄漏、复现性与评估缺陷</span></div>'''
posters.append(('03-科研发现与领域知识库',base(3,'MAP YOUR FIELD',body,'field')))

body=f'''<section class="headline"><p class="eyebrow">RESEARCH PROJECTS & MANUSCRIPT STUDIO</p><h1>方法有来路。<br><span class="accent">写作有依据。</span></h1><p class="sub">把每一次迭代、每一份证据，带到最终的论证里。</p></section>
{screenshot(writing,'论文写作 · 段落职责、核心主张与证据边界','left:60px;top:491px;width:960px;height:505px')}
{screenshot(project,'研究项目 · 方法与实验记录','left:638px;top:858px;width:382px;height:266px;transform:rotate(2deg)')}
<div class="callout" style="left:65px;top:1020px;width:530px"><b>结果不理想，就带着反馈回到方法。</b>研究不是单行道。方法、实验与写作相互关联，<br>材料和版本随着项目一起保留下来。</div>
<section class="features">{feature('01 / METHOD','方法确立','跨论文收集材料，明确核心假设。<br>保存方法版本，积累讨论与验证计划。')}{feature('02 / EXPERIMENT','实验记录与迭代','记录数据、配置、结果和不足。<br>把实验反馈关联到对应的方法版本。')}{feature('03 / WRITE','从材料到稿件','关联研究项目与稿件，规划段落论证。<br>中英生成、版本比较、论证检查与采纳。')}</section><div class="ribbon"><span>主张 / 证据 / 适用边界：每一段都有自己的职责</span><span>材料可复用，论证可追溯</span></div>'''
posters.append(('04-研究项目与论文写作',base(4,'FROM IDEA TO ARGUMENT',body,'project')))

body=f'''<section class="headline"><p class="eyebrow">AI WORKSPACE · VOICE · FILES · NEWS</p><h1>一起想清楚，<br><span class="accent">再向前一步。</span></h1><p class="sub">文字、语音、文件与研究现场，在同一个工作空间相遇。</p></section>
{screenshot(ASSETS/'home.jpg','AI 工作台 · 工作区与对话','left:60px;top:489px;width:960px;height:530px')}
{screenshot(voice,'语音对话 · 连接论文与项目','left:593px;top:858px;width:427px;height:260px;transform:rotate(2.5deg)')}
<div class="callout" style="left:65px;top:1040px;width:480px"><b>带着已有研究继续讨论。</b>当前论文、项目材料和原文来源，<br>成为下一轮交流的起点。</div>
<section class="features">{feature('01 / THINK','文字与语音，接着思考','在工作区开展 AI 对话与任务。<br>语音围绕论文或项目交流，依据可回看。')}{feature('02 / WORK','文件与工具，协同工作','围绕本地工作区组织文件与任务。<br>需要确认的操作，由你掌握决定权。')}{feature('03 / FOLLOW','把灵感留在日常里','科研发现、AI 新闻与开源动态。<br>统一背景主题，让各个页面保持连贯。')}</section><div class="ribbon"><span>一个研究现场，多种交流与工作方式</span><span>独立功能，也能连接同一段研究</span></div>'''
posters.append(('05-AI工作台与语音',base(5,'THINK & WORK TOGETHER',body,'workspace')))

for name,html in posters:(OUT/(name+'.html')).write_text(html,encoding='utf-8')
(OUT/'manifest.json').write_text(json.dumps({'size':[2160,2880],'slogan':'All in one. One to master every stage.','posters':[n for n,_ in posters]},ensure_ascii=False,indent=2),encoding='utf-8')
gallery=''.join(f'<a href="{n}.html"><img src="{n}.png" alt="{n}"><b>{n[3:]}</b><span>查看可编辑 HTML</span></a>' for n,_ in posters)
(OUT/'index.html').write_text(f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Singularity 宣传海报</title><style>body{{margin:0;background:#102532;color:#f5f2e8;font:16px "Microsoft YaHei",sans-serif;padding:48px}}h1{{font:italic 44px Georgia;margin:0}}p{{color:#b8c8cc}}main{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;margin-top:36px}}a{{color:inherit;text-decoration:none}}img{{width:100%;border-radius:12px;box-shadow:0 20px 50px #0005}}b,span{{display:block;margin-top:12px}}span{{font-size:12px;color:#b8c8cc}}</style><h1>Singularity</h1><p>All in one. One to master every stage.</p><main>{gallery}</main></html>',encoding='utf-8')
print('Built 5 self-contained HTML posters.')
