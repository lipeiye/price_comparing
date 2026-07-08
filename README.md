# 智采 AI 报价比价

> 上传 Excel 报价单，自动对齐、比价、出报告。

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)](https://vite.dev/)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-V4-536DFE)](https://www.deepseek.com/)
[![CloudBase](https://img.shields.io/badge/CloudBase-0052CC)](https://cloud.tencent.com/product/tcb)

---

面向灯具企业采购经理的比价工具。上传 2–3 份供应商报价单，系统自动完成：

- **逐项对齐** — 不管各家的列顺序怎么排，按表头文字找到价格列，按项目号对齐到同一行
- **异常标记** — 漏报、量级差 2 倍以上、总价口径不明、模具费，自动标出来
- **采购建议** — 最低价是谁、哪些规格被供应商改了、下一步该找谁谈
- **深度报告**（可选）— 七章分析报告，可导出 Word 编辑或直接打印 PDF

```mermaid
flowchart LR
    A[上传 Excel] --> B[浏览器端解析]
    B --> C[云函数：代码对齐 + AI 建议]
    C --> D[比价表 + 异常列表]
    D -.->|可选| E[云函数：深度分析报告]
    E --> F[Word / PDF 导出]
```

## 本地运行

```bash
cd quote-ai-demo
npm install
npm run dev        # 默认 Mock 模式，适合调 UI
npm run build      # 生产构建 → dist/
```

## 部署

```bash
# 前端
npm run deploy:static

# 云函数（两个）
tcb fn code update analyzeQuotes -e <envId> --deployMode zip
tcb fn code update generateReport -e <envId> --deployMode zip
```

```bash
# 部署后验证
curl "https://<网关>/api/analyzeQuotes?ping=1"
# → {"success":true,"pong":true,"version":"v4-align-engine-185s"}
```

---

📖 [完整文档](quote-ai-demo/README.md) — 对齐引擎、云函数环境变量、验收清单
