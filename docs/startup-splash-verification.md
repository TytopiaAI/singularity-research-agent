# 启动加载画面阶段性验证

日期：2026-10-13。仅修改源码和构建验证产物，未生成安装器或更新已安装应用。

追加 Sail：按用户提供的完整绘制代码新增全屏 Sail 水彩加载页，复用本地
p5.js/p5.brush 依赖及已有的绘制预算、画布尺寸限制、异常回退和动画卸载
机制。Sail、Willow、行星在每次 renderer 启动时各有三分之一概率被选择。

本次 Sail 类型检查和构建通过；扩展后的 Electron 验证涵盖全部三种选择、
两种水彩动画的离线绘制/缩放/异常回退/减少动态效果，以及窗口按钮和卸载。
13 项检查通过，HTTP 请求为 0，控制台错误为 0。
报告和截图：`.local-data/startup-splash-verification/1791864513480/`。
完整 Sail 和减少动态效果的截图已检查。验证使用 Electron 离屏窗口，避免
桌面显示状态影响截图采集；以下记录保留先前 Willow 的验证结果。

保留三颗行星环绕太阳的动画，新增用户提供的 Willow 水彩绘制动画。
每次 renderer 启动时等概率选择一种，React StrictMode、重渲染和窗口缩放
不会重新选择。Willow 覆盖整个应用窗口，使用本地固定版本 p5.js/p5.brush，
无需访问参考网站或 CDN。

原有 `runtime.phase === ready/error` 的完成逻辑保持不变；不会为播放完整动画
延长启动等待。绘制分批进行，最多以 960 像素长边创建 WebGL 画布；完成
加载后移除 iframe，释放绘制环境。绘制异常、Promise 错误或 WebGL 上下文
丢失时回退到原行星画面。减少动态效果模式下生成静态画作并停止循环。

验证结果：

- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/tsx/dist/cli.mjs scripts/build.ts`：通过。
- `node node_modules/vitest/vitest.mjs run`：20 个测试文件，109 个测试通过。
- `scripts/verify-startup-splash.cjs`：真实 Electron 验证通过。包含两种启动
  选择、StrictMode 和重渲染稳定性、离线绘制、画布比例、窗口缩放、三个窗口
  按钮、错误回退、无关消息隔离、减少动态效果和卸载清理。HTTP 请求为 0，
  控制台错误为 0。

最后一次验证报告和截图：
`.local-data/startup-splash-verification/1791862594999/`。
在正常可见的窗口时序下，Willow 绘制前 4.5 秒的采样为 113 帧；这是本机
阶段性观察，不代表所有设备的性能。截图已检查完整画面和缩放后的覆盖效果。

构建仍有既有的 renderer chunk 大小提示。没有运行安装器构建。
