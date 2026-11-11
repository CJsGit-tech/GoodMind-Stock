---
version: alpha
name: PocketStocks Local Staging
description: 台股研究書庫、ETF 與法人研究，沿用既有深色畫布與薄荷色互動。
colors:
  primary: '#42dcc8'
  background: '#0a1013'
  surface: '#12181c'
  text: '#e8eef0'
  muted: '#a6b1b6'
  rule: '#2d3a40'
typography:
  sans:
    fontFamily: "Geist, Noto Sans TC, sans-serif"
  mono:
    fontFamily: "Geist Mono, Noto Sans TC, monospace"
rounded:
  DEFAULT: '6px'
  overlay: '8px'
spacing:
  page-max: '1300px'
  control-min: '44px'
components:
  button: {}
  search: {}
---

# PocketStocks Local Staging Design System

沿用現有研究產品的視覺語言與元件，不因功能移除重設其他頁面。

`src/index.css` 的 `.app-shell` banner tokens 是執行階段樣式來源；本檔是維護說明，不建立第二套 tokens。Geist／Noto Sans TC 用於文字，Geist Mono 用於數值。深色背景、薄荷色選取與焦點、全域可見捲軸、既有 shimmer 及減少動態規則維持。

## Canonical UI Map

| 能力 | Owner | 行為 |
| --- | --- | --- |
| 公開導覽 | src/application-navigation.tsx | 研究書庫、討論吧、主動式ETF、三大法人；登入區沿用現有控制 |
| 搜尋與篩選 | CatalogSearch／CatalogSelect | 沿用既有可操作與焦點狀態 |
| 研究文章 | ResearchArticleHeading／既有 reader | 保留文章、封面、圖表、來源與版本 |
| 路由 | src/App.tsx | 未知路由回研究書庫，保留其他合法深層連結 |

## Feature retirement

Owner 於 2026-10-22 要求移除 Dev 與 Production 所有股價試算功能，原試算／KD 設計規格不再適用。移除專屬頁面、導覽、樣式、計算與行情服務，沿用未知路由的書庫回復行為；不改 ETF／法人報告既有內容與來源。產品紀錄與驗收留在 Linear PS-321 及相關工單。
