# 全文翻译阅读布局修订（2026-10-22）

## 行为

- 左侧保留原始 PDF；右侧每段先显示原文，再显示中文。点击中文或按 Enter/Space，定位并高亮左侧对应段落；选择译文文字不会误触定位。
- 参考 [EasyRead](https://github.com/Edwardxlai/easyread) 的阅读设计原则，采用纸色背景、中文衬线字体、舒适行宽和行距，提供 15–24 px 字号调整及深色样式。实现使用本项目组件。
- 将矢量图形与位图区域合并为完整图表，避免坐标值、图内标签和流程图文字成为独立翻译段落；保留图注与靠近页底的正文，排除居中的页码。
- 从 PDF 字体、字形位置和分数线恢复数学表达式；KaTeX 在本地排版行内及独立公式，保留分数、上下标、撇号和公式编号。数学单元与上标引用使用不可改写的占位符传递给翻译模型，并校验回传完整性。
- 对无法可靠排版的复杂公式保留原文裁图，供核对，不猜测补写符号。PDF 字体编码及复杂版式仍可能需要进一步适配。

## 旧翻译

布局版本更新为 3。原缓存先备份，再迁移；兼容的译文复用。旧译文若丢失数学结构，会重新成为待翻译段落，使用界面的继续翻译操作补齐。迁移本身不调用模型。

## 验证

- 全量 26 个测试文件、145 项测试通过；TypeScript 检查及开发构建通过。没有生成安装器、安装或更新快捷方式。
- 使用真实论文 *Reason Through the Latent! Making Latent Visual Reasoning Necessary* 验证第 2–5 页：整图、完整图注、分数分母 `m_i(0)`、中文行内数学、段落定位、字号、深色和窄分栏。
- 隔离环境使用缓存副本和明确标注的离线中文样例，没有调用模型；因此本轮验证覆盖排版、数学保护和交互，不代表重新评估了在线模型翻译质量。
- 原始已安装论文和翻译缓存的 SHA256 保持不变。
- 原有选词翻译、跨页拼接、提问上下文、分栏调整、工具栏溢出菜单及 100%/125%/150% 缩放交互回归通过。

报告和截图：

- `.local-data/bilingual-reading-verification/1792651668194/report.json`
- `.local-data/bilingual-reading-verification/1792651668194/bilingual-math-reading.png`
- `.local-data/bilingual-reading-verification/1792651668194/whole-chart-reading.png`
- `.local-data/reader-translation-verification/1792651699070/report.json`

可重复运行的入口：`scripts/verify-bilingual-reading.cjs --pdf <论文路径> --cache <缓存路径>` 与 `scripts/verify-reader-translation.cjs`，均通过本地 Electron 执行。

## 首页主题同步（2026-10-22）

移除翻译面板独立的固定纸色，让标题栏、翻译控制区和正文区域共同透出首页所选主题背景；正文、原文和分隔线使用全局文字颜色变量。五种背景（浅黄、浅蓝、浅紫、浅绿、透明）在浅色和深色模式下均通过实时切换验证，保留数学排版、字号和段落定位。报告：`.local-data/bilingual-reading-verification/1792656147525/report.json`，浅蓝截图：同目录 `blue-theme-reading.png`。本次未打包安装。
