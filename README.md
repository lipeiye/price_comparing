# 智采 AI 报价比价

> 企业灯具采购智能比价系统 — 上传 Excel 报价单，AI 自动对齐、比价、出报告。

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)](https://vite.dev/)
[![DeepSeek](https://img.shields.io/badge/AI-DeepSeek%20V4-536DFE)](https://www.deepseek.com/)
[![CloudBase](https://img.shields.io/badge/Cloud-Tencent%20CloudBase-0052CC)](https://cloud.tencent.com/product/tcb)

---

**智采 AI 报价比价**是一款面向灯具企业采购经理的智能比价工具。用户上传 2–3 份供应商 Excel 报价单，系统自动完成 Excel 解析、跨供应商价格对齐、AI 采购建议生成，并可选输出多维深度分析报告（Word/PDF）。

> **设计哲学**：比价表由代码保证，永不为空。AI 只做需要语言理解的部分，不参与价格计算。

## 核心能力

| 能力 | 说明 |
|------|------|
| 🧠 **代码对齐引擎** | 按表头文字识别价格列，按项目号跨家对齐，计算最低/最高/均价 |
| 🔍 **异常检测** | 漏报、量级差异 ≥2×、口径不明、模具费、规格篡改 |
| 🤖 **双 AI 模型** | V4 Flash 快速叙述（~30s）+ V4 Pro 深度报告（~120s，可选） |
| 📊 **比价表** | 逐项目对齐、最低价高亮、成本拆分明细 |
| 📄 **报告导出** | Word (.docx) 可编辑 + PDF 打印，零额外依赖 |

## 架构

```
浏览器端 (React 19 + Vite 8)
    │  Excel 解析 → 表格 JSON (几 KB)
    ▼
┌─────────────────────┐    可选     ┌──────────────────────┐
│  analyzeQuotes       │ ────────▶ │  generateReport       │
│  云函数 (~30s)       │  传递结果  │  云函数 (~120s)        │
│  ① align.js 代码对齐 │           │  DeepSeek V4 Pro      │
│  ② DeepSeek V4 Flash │           │  思考模式 深度分析     │
└─────────────────────┘           └──────────────────────┘
```

## 快速开始

```bash
cd quote-ai-demo
npm install
npm run dev        # 本地开发（Mock 模式）
npm run build      # 生产构建
```

## 部署

```bash
# 前端
npm run deploy:static

# 云函数
tcb fn code update analyzeQuotes -e <envId> --deployMode zip
tcb fn code update generateReport -e <envId> --deployMode zip
```

---

📖 **完整文档**：[quote-ai-demo/README.md](quote-ai-demo/README.md) — 架构设计、对齐引擎详解、环境变量、验收清单等。
