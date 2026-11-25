# 股脈 GoodMind

**[繁體中文](#繁體中文) ｜ [English](#english)**

| 連結 Links | URL |
|---|---|
| 正式網站 Production site | https://good-mind-mxn7j5.v2.appdeploy.ai/ |
| 資料說明與方法 Data guide & methodology | https://good-mind-mxn7j5.v2.appdeploy.ai/#/docs |

---

## 繁體中文

股脈是一個產業知識圖譜研究平台：把公司、商品、市場與它們之間的供應、合作、競爭關係，連同資料來源整理成可查詢的圖譜。介面以繁體中文為主。

### 研究本體論與方法速覽

目前使用本體論 **4.0**（定義檔：[`goodmind-lite/lib/registry.v4.json`](goodmind-lite/lib/registry.v4.json)）。正式網站的資料說明頁列出 26 種可使用的節點類型（定義檔另含 1 種抽象的「商品」類型）與 81 種關係。部分類型與關係已定義，但還沒有資料。

#### 資料分層

| 層次 | 主要節點類型 | 回答的問題 |
|---|---|---|
| 主體與商品 | 公司、集團、事業單位、產品、服務、業務線 | 誰在做生意？賣什麼？ |
| 分類 | 產業、市場區隔、產品類別、技術、應用 | 屬於哪個市場？用什麼技術？ |
| 關係紀錄 | 供應紀錄、客戶商機、合作紀錄、競爭評估 | 公司之間發生了什麼？ |
| 來源 | 證據、主張 | 這件事是誰說的？ |
| 延伸 | 產業鏈階段、製程能力、工廠、終端需求、趨勢主題、事件、主題提及、ETF | 產業鏈位置、趨勢與持股 |

常見的研究路徑是：**公司 → 產品或服務 → 市場區隔 → 產業**。

#### 核心原則

1. **中文為主。** `name` 使用繁體中文；英文與原文名稱、別名、股票代號放在 `attributes`。找不到可靠的中文名稱時保留原文並標記 `name_zh_missing`，不自行翻譯或杜撰。
2. **屬性有彈性。** 節點與關係都有 `attributes`（自由的 JSON key-value，key 用 `snake_case`），各類型另有必填欄位。
3. **規則即資料。** 節點類型、關係方向與必填欄位都登記在定義檔中。
4. **單一寫入關卡。** 寫入前檢查類型、方向、必填欄位、重複公司與基數限制；整批通過才寫入，否則退回並說明原因。
5. **事實要有來源。** 研究目標是每個事實都能追到證據。寫入關卡會對指定的類型與關係要求必填來源；舊資料中仍有缺漏，列在 `needs_review` 或品質檢查中。

#### 可靠度與目前階段分開記錄

- **可靠度** `verification_status`：已驗證 `verified`、有報導 `reported`、推論 `inferred`、建議 `suggested`、有爭議 `disputed`
- **目前階段** `lifecycle_status`：已公告、進行中、已完成、已失效

例如：已公告的合作備忘錄可以是「已驗證」，但不代表已經產生營收。互相矛盾的來源會保留並標示為有爭議。

#### 事實、推算與建議

- 供應、合作、競爭先記成一筆**關係紀錄**（附階段、可靠度與證據）。
- 公司之間的「供應給」「合作夥伴」「直接競爭者」等由紀錄**推算**，不能手動建立。
- 同市場或同技術只會產生**建議**（虛線顯示）。經人工接受後，才會建立標示為「推論」的紀錄。

#### 研究流程

新資料以專案內的 [`goodmind-refine`](.claude/skills/goodmind-refine/SKILL.md) 流程處理（較早匯入的資料不一定走過全部步驟）：

1. 盤點輸入資料並保存來源
2. 逐條擷取主張，附原文引句與出處
3. 依本體論草擬寫入內容
4. 比對既有節點，處理重複
5. 補足重要缺口
6. 機械檢查，再由未參與擷取的代理獨立查核
7. 打包：通過的紀錄可上傳；未通過的列為暫緩，並說明原因與解決方式

原則是寧可少而正確。這個流程只產生檔案；匯入與發布需另行確認。

#### 查詢方式（GQC）

可用條件找公司，並以「全部符合／任一符合／排除」組合。查詢只走登記過的路徑；相同的條件與資料會得到相同結果。每家公司只出現一次並列出符合的路徑與來源；缺資料標示為「未知」，不當成「沒有」。

> 圖譜僅供研究參考，不是投資建議。使用前請查核原始來源。

---

## English

GoodMind (股脈) is a research platform built on an industry knowledge graph. It organizes companies, offerings, markets, and the supply, collaboration and competition links between them, together with their sources. The interface is mainly in Traditional Chinese.

### Research ontology and methodology: quick overview

The current ontology is **4.0** (registry: [`goodmind-lite/lib/registry.v4.json`](goodmind-lite/lib/registry.v4.json)). The live data guide lists 26 usable node types (the registry also has 1 abstract "offering" type) and 81 relation types. Some types and relations are defined but have no data yet.

#### Layers

| Layer | Main node types | Question answered |
|---|---|---|
| Actors and offerings | Company, Corporate Group, Organization Unit, Product, Service, Business Line | Who does business, and what do they sell? |
| Classification | Industry, Market Segment, Product Category, Technology, Application | Which market is it in, and what technology does it use? |
| Relationship records | Supply Relationship, Customer Opportunity, Collaboration, Competition Assessment | What happened between companies? |
| Sources | Evidence, Claim | Who says so? |
| Extensions | Value Chain Stage, Capability, Facility, End Market, Topic, Event, Topic Mention, ETF | Value-chain position, trends and holdings |

The usual research chain is **company → product or service → market segment → industry**.

#### Core principles

1. **Chinese first.** `name` is in Traditional Chinese. English and original names, aliases and tickers go in `attributes`. Without a reliable Chinese name, keep the original and set `name_zh_missing`; never invent or translate one.
2. **Flexible attributes.** Nodes and relations carry `attributes`: free JSON key-value pairs with `snake_case` keys. Each type also has its own required fields.
3. **Rules as data.** Node types, relation directions and required fields are declared in the registry.
4. **One write gate.** Every write is checked for types, direction, required fields, duplicate companies and cardinality. A batch is saved only if all of it passes; otherwise it is rejected with reasons.
5. **Facts need sources.** The research goal is that every fact traces to evidence. The write gate requires sources for specified types and relations. Older data still has gaps, listed under `needs_review` or by the quality checks.

#### Reliability and stage are recorded separately

- **Reliability** `verification_status`: `verified`, `reported`, `inferred`, `suggested`, `disputed`
- **Stage** `lifecycle_status`: `announced`, `active`, `completed`, `expired`

For example, an announced MOU can be verified without implying any revenue. Conflicting sources are kept and marked as disputed.

#### Facts, derived links and suggestions

- Supply, collaboration and competition are first stored as **relationship records**, with stage, reliability and evidence.
- Company-to-company links such as "supplies to", "collaborates with" and "direct competitor" are **derived** from those records and cannot be created by hand.
- A shared market or technology only produces a **suggestion** (drawn as a dotted line). A record marked as inferred is created only after a person accepts it.

#### Research pipeline

New data goes through the project's [`goodmind-refine`](.claude/skills/goodmind-refine/SKILL.md) workflow (earlier imports did not necessarily pass every step):

1. Inventory the inputs and save the sources
2. Extract one claim per fact, with a verbatim quote and its location
3. Draft write operations that follow the ontology
4. Match against existing nodes and resolve duplicates
5. Fill the gaps that matter
6. Run mechanical checks, then have a separate agent that did not do the extraction verify
7. Package: passing records are ready to upload; the rest are held, with the reason and what would unblock them

A smaller batch that is right is better than a full one built on guesses. The workflow only produces files; importing and publishing need separate approval.

#### Querying (GQC)

Find companies by combining conditions with all / any / not. Queries follow only registered paths, so the same conditions on the same data give the same results. Each company appears once, with its matching paths and sources. Missing data is reported as "unknown", not treated as "no".

> The graph is for research only and is not investment advice. Check the original sources before relying on it.

---

## 專案結構與本機執行 Repository and local setup

| 路徑 Path | 說明 Description |
|---|---|
| `goodmind-lite/` | 主要應用程式 Main app (React + Vite, Express API); [details](goodmind-lite/README.md) |
| `goodmind-lite/docs/` | [資料匯入與部署指南 Data import and deployment guide](goodmind-lite/docs/DATA-IMPORT-AND-APPDEPLOY.md) |
| `deploy-goodmind/` | 由建置腳本產生的 AppDeploy 版本 AppDeploy bundle generated by `goodmind-lite/deploy/build_appdeploy.py` |
| `local-app/` | 早期的 Next.js 本機版本 Earlier local Next.js copy |
| `export/` | 早期的本體論與關係匯出 Earlier ontology and relation exports |
| `.claude/skills/goodmind-refine/` | 研究資料整理流程 Research data workflow |

```bash
cd goodmind-lite
npm install
cp .env.local.example .env.local
npm run dev
```

開啟 Open http://localhost:3100

**資料版本 Data versions:** 2026-11-25 檢視時，正式網站顯示 443 個節點與 553 條關係。儲存庫中的本機資料 (`goodmind-lite/data/seed.json`) 較新，尚未等同於正式網站。
As checked on 2026-11-25, the live site showed 443 nodes and 553 relations. The local data in this repository (`goodmind-lite/data/seed.json`) is newer and does not match the live site.

### 早期本機版本 Earlier local app

```bash
cd local-app && npm install && npm run dev
```

開啟 Open http://localhost:3000/good-mind 。管理登入為本機模擬用的預設值 `admin` / `goodmind-local`（見 `.env.local.example`）；AI 功能以本機模擬執行，不需要 API 金鑰。
The admin sign-in is a local placeholder, `admin` / `goodmind-local` (see `.env.local.example`). AI features are simulated locally and need no API key.
