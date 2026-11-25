# 資料格式與匯入規格

**繁體中文** ｜ [English](DATA-SPEC.en.md)

節點類型與關係的完整清單見 [ONTOLOGY.md](ONTOLOGY.md)。完整範例見 [`examples/example-ops.json`](../examples/example-ops.json)（內容全部虛構）。

## 檔案格式

匯入檔是 JSON：`{ "ops": [ … ] }`（也可以直接是陣列）。操作依順序套用，**被引用的節點要排在前面**：先證據，再節點，最後關係。

```json
{ "ops": [
  { "op": "createNode", "node": { "id": "evidence:example", "type": "Evidence", "name": "來源原始標題",
      "attributes": { "url": "https://example.com/page", "publisher": "發布者", "published_at": "2025-03-15" } } },
  { "op": "createNode", "node": { "id": "company:example", "type": "Company", "name": "範例公司",
      "attributes": { "country": "TW", "name_en": "Example Co.", "verification_status": "reported", "evidence_ids": ["evidence:example"] } } },
  { "op": "createNode", "node": { "id": "industry:example", "type": "Industry", "name": "範例產業" } },
  { "op": "createEdge", "edge": { "predicate": "OPERATES_IN", "from": "company:example", "to": "industry:example",
      "attributes": { "verification_status": "reported", "evidence_ids": ["evidence:example"] } } }
] }
```

| 操作 | 欄位 |
|---|---|
| `createNode` | `node.type`、`node.name`（必填）；`node.id`、`node.attributes`（建議） |
| `createEdge` | `edge.predicate`、`edge.from`、`edge.to`（必填）；`edge.attributes` |
| `updateNode` | `id`（必填）；`name`、`attributes`。屬性值設為 `null` 代表刪除 |

## id 與名稱

- id 寫成 `前綴:英文-小寫-代稱`，且不可重複。常用前綴：`company:`、`product:`、`service:`、`business_line:`、`industry:`、`segment:`、`category:`、`technology:`、`application:`、`supply:`、`competition:`、`collaboration:`、`evidence:`。未提供時由匯入程式產生。
- `name` 使用繁體中文。英文或原文名稱放 `attributes.name_en`，別名放 `attributes.aliases`。
- `Evidence`、`Product`、`Service`、`Claim`、`TopicMention` 可保留原文（型號、來源標題）。其他類型的名稱沒有中文時，要加 `name_zh_missing: true`；原文本身就是通用中文寫法時用 `name_is_zh_usage: true`。**不要自行翻譯或杜撰中文名。**
- 屬性 key 一律 `snake_case`。除了各類型定義的欄位，可以加入自訂的 key-value。

## 可靠度與目前階段

- `verification_status`：`verified`（第一手公告或申報）、`reported`（二手或保留語氣）、`inferred`（分析推論）、`suggested`、`disputed`
- `lifecycle_status`：`announced`、`active`、`completed`、`expired`

計畫、送樣、合作備忘錄不等於量產或銷售。日期只在來源明確寫出時填寫。

## 來源（Evidence）

必填 `url`、`publisher`、`published_at`。來源沒有日期時省略 `published_at`，並加上 `"needs_review": ["published_at"]`。節點與關係用 `evidence_ids` 引用證據節點。

下列類型**至少要有 1 筆證據**：`SupplyRelationship`、`CompetitionAssessment`、`CustomerOpportunity`、`Collaboration`、`Event`。部分關係也要求證據，在 [ONTOLOGY.md](ONTOLOGY.md) 中標示 `*`。建議所有事實都附來源。

## 關係紀錄的寫法

公司之間的供應、合作、競爭**先建立一筆紀錄節點**，再用關係連到參與者。「供應給」「合作夥伴」「競爭者」由系統算出，不能直接匯入。

| 紀錄 | 必填屬性 | 必要關係 |
|---|---|---|
| `SupplyRelationship` | `stage`、`verification_status` | `HAS_SUPPLIER` 恰好 1、`HAS_BUYER` 恰好 1；品項用 `FOR_SUPPLIED_PRODUCT` / `FOR_SUPPLIED_SERVICE` |
| `Collaboration` | `collaboration_type`、`stage`、`verification_status` | `HAS_PARTICIPANT` 至少 2 |
| `CompetitionAssessment` | `competition_type`、`overlap_scope`、`basis`、`verification_status` | `OFFERING_A`、`OFFERING_B`（兩個不同商品）、`COMPETES_IN_SEGMENT`，各恰好 1 |
| `CustomerOpportunity` | `stage`、`verification_status` | `PROSPECTIVE_SELLER` 恰好 1、`TARGET_CUSTOMER` 至少 1 |

可選的值列在 [ONTOLOGY.md](ONTOLOGY.md)。供應階段 `unspecified`、`design_win`、`mass_production` 會顯示為目前的供應；`prospect`、`qualified`、`sampling` 顯示為可能供應。

建議的最小研究路徑：公司 → 產品或服務（`SELLS` 等）→ 市場區隔（`TARGETS_SEGMENT`）→ 產業（`SEGMENT_OF_INDUSTRY`）。公司也可用 `OPERATES_IN` 直接連到產業。

## 匯入時的檢查

整批全部通過才會寫入；任何一項失敗，整批都不寫入，並列出原因：

- 節點類型或關係不存在，或使用抽象類型
- 必填屬性缺少、資料型別錯誤、屬性 key 不是 `snake_case`
- 中文名稱規則不符
- id 重複；公司、產業、區隔、技術等的名稱、別名或股票代號與既有同類節點重複
- 關係方向或端點類型錯誤、端點不存在、連到自己、重複的關係
- 系統算出或建議類的關係
- 超過或未達關係紀錄的數量限制
- 缺少必要證據，或 `evidence_ids` 指向的不是證據節點

匯入程式**不會**查證來源內容是否支持該事實。查證請使用 [`goodmind-data` skill](../.claude/skills/goodmind-data/SKILL.md) 或人工覆核。

## 指令

```bash
npm run check -- my-data.json
npm run import -- my-data.json
npm run reset
```

- `check` 只檢查，不寫入。
- `import` 寫入本機的 `data/db.json`；匯入前的資料保留在 `data/db.backup.json`（只保留一份）。一次給多個檔案時依序處理，被拒絕的檔案會讓流程停止，先前已成功的檔案仍保留。
- `reset` 清空本機圖譜。

`data/` 中除了空白起始檔 `seed.json` 以外都不會被 git 追蹤。
