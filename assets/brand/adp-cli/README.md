# ADP CLI 品牌资产

此目录是 ADP CLI 产品图标的权威资产来源。CLI 构建、后续安装程序以及其他产品界面应从这里消费资产，不应在各 package 中维护独立母版。

## 来源

- 设计交付包：`Logo vector file request.zip`
- SHA-256：`e3a298775f469ea9c87dff68b9dbb6c0a5a1f1dd83501c7666a41e5b843a0ec0`
- 设计版本：GRCB ADP CLI 图标 v2.1

原始 ZIP 不提交到仓库；哈希用于确认交付来源。设计工具生成的 HTML、JavaScript、缩略图和上传参考图也不属于产品资产。

## 目录职责

- `source/`：可编辑的正式矢量母版。
- `renditions/png/`：经过设计确认的多尺寸 PNG，不应从单一母版统一缩放覆盖。
- `platform/windows/icon.ico`：Windows CLI 可执行文件使用的正式 ICO。
- `preview/`：人工审查用的多尺寸对比图，不参与构建。
- `qa/`：几何与渲染验收记录。
- `archive/options/`：未采用但不重复的设计备选，不得作为生产资产引用。

## 尺寸策略

- `128px` 及以上使用大尺寸母版策略。
- `20px` 至 `64px` 使用小尺寸母版策略。
- `16px` 使用设计交付的专用栅格结果；当前没有能够精确复现它的独立矢量母版或生成脚本。
- Windows ICO 包含 `256/64/48/32/24/16` 六个 32-bit 图像条目。

## 当前消费者

`packages/opencode/script/build.ts` 在构建 Windows target 时引用 `platform/windows/icon.ico`；Web UI 使用本目录的正式 SVG、ICO 和 PNG 资产生成浏览器 favicon、PWA 图标以及页面内品牌标识。Desktop 图标和 README 展示资源仍需单独同步。
