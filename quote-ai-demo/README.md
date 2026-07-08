# 智采 AI 报价比价 Demo

企业采购报价比价网站 Demo。本地第一阶段使用 Mock 数据，支持上传 2-3 份供应商 Excel 报价单，展示分析过程、结构化比价表、异常项和 AI 采购建议。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物位于 `dist/`。部署静态托管时请上传 `dist` 目录内部内容，确保托管根目录直接包含 `index.html` 和 `assets/`。

## 演示模式

默认启用 Mock：

```env
VITE_USE_MOCK=true
VITE_ANALYZE_API_URL=
```

真实 AI 接口必须由后端或 CloudBase 云函数调用，不能把 API Key 写入前端。

## 真实 AI 接入准备

前端通过 `VITE_ANALYZE_API_URL` 调用后端接口。正式测试真实 AI 时再设置：

```env
VITE_USE_MOCK=false
VITE_ANALYZE_API_URL=https://你的-cloudbase-api-url
```

CloudBase 云函数位于 `cloudfunctions/analyzeQuotes/`，它会：

1. 接收 2-3 份 `.xlsx` Excel 报价单。
2. 校验文件数量、扩展名和 10 MB 大小限制。
3. 读取工作表前 80 行、前 18 列。
4. 将结构化表格内容发送给兼容 Chat Completions 的 AI 接口。
5. 只把 JSON 结果返回给前端。

云函数环境变量：

```env
AI_API_KEY=
AI_API_BASE_URL=https://api.moonshot.ai/v1
AI_API_ENDPOINT=https://api.moonshot.ai/v1/chat/completions
AI_MODEL=kimi-k2.7-code
```

`AI_API_ENDPOINT` 优先级高于 `AI_API_BASE_URL`。如果只设置 `AI_API_BASE_URL`，云函数会自动拼接 `/chat/completions`。如果只配置 `AI_API_KEY`，云函数会默认使用 Kimi 官方接口和 `kimi-k2.7-code` 模型。

## 部署说明

当前推荐部署到腾讯云 CloudBase 静态网站托管。根据腾讯云 2026 年官方文档，CloudBase 静态网站托管支持 HTML/CSS/JavaScript 静态资源部署，并内置 HTTPS；默认首页文档为 `index.html`；默认域名为 `*.tcloudbaseapp.com`，主要用于开发和测试。

部署前构建：

```bash
npm run build
```

静态托管上传时请上传 `dist/` 内部内容，不要把整个 `dist` 目录嵌套为一层。托管根目录应直接包含 `index.html` 和 `assets/`。

## Demo 验收点

- 上传 1 份时按钮禁用
- 上传 2-3 份时按钮启用
- 第 4 份文件被拒绝
- 非 XLSX 文件被拒绝
- 可删除文件并更新状态
- 分析过程逐步展示
- Mock 结果可展示比价表、异常和建议
- `npm run build` 成功

## 30 秒演示脚本

这是一个面向企业采购人员的 AI 报价比价工具。采购人员只需要上传两到三家供应商的 Excel 报价单，系统就会读取商品名称、规格、数量、单价和税费信息。分析完成后，系统会把同类商品对齐到同一张表里，自动标出最低价、漏报、规格不一致和含税口径差异。最后，AI 会生成一份简洁的采购建议，帮助采购人员快速发现异常，减少人工比价时间。
