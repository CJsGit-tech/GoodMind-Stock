# 本體論參考 Ontology reference

版本 Version **4.0.0**。本文件由 `npm run docs:ontology` 從程式產生，請勿手動修改。
Generated from the code by `npm run docs:ontology`; do not edit by hand. 定義檔 Source: [`lib/registry.v4.json`](../lib/registry.v4.json), [`lib/ontology.ts`](../lib/ontology.ts)。

資料格式與匯入規則見 For the file format and import rules see [DATA-SPEC.md](DATA-SPEC.md) / [DATA-SPEC.en.md](DATA-SPEC.en.md)。

## 節點類型 Node types

每個節點 Every node: `id`, `type`, `name`, `attributes`。

所有類型都可使用的屬性 Attributes accepted by every type: `name_en` (string), `aliases` (string[]), `name_zh_missing` (boolean), `name_is_zh_usage` (boolean), `legacy_ids` (string[]), `valid_from` (date), `valid_to` (date), `observed_at` (date), `recorded_at` (date), `notes` (text), `curation` (object), `needs_review` (string[])

| type | 中文 | English | 必填屬性 Required | 其他屬性 Other attributes |
|---|---|---|---|---|
| `Company` | 公司 | Company | `country` (string) | `legal_name_zh`, `legal_name_en`, `ticker`, `exchange`, `website`, `founded`, `employees`, `verification_status`, `evidence_ids`, `verification_legacy` |
| `CorporateGroup` | 集團 | Corporate Group | — | — |
| `OrganizationUnit` | 事業單位 | Organization Unit | — | — |
| `Offering` *(abstract)* | 商品 | Offering | — | — |
| `Product` | 產品 | Product | `kind` (enum: system \| module \| component \| material \| software \| vehicle \| foundry \| testing \| packaging \| assembly_and_test \| design \| integration \| other) | `model_no`, `specs`, `price`, `currency`, `launch_date`, `is_business_line`, `verification_status`, `evidence_ids`, `split_from`, `verification_legacy` |
| `Service` | 服務 | Service | `kind` (enum: system \| module \| component \| material \| software \| vehicle \| foundry \| testing \| packaging \| assembly_and_test \| design \| integration \| other) | `scope`, `pricing_model`, `verification_status`, `evidence_ids`, `split_from`, `verification_legacy` |
| `ProductFamily` | 產品系列 | Product Family | — | — |
| `Industry` | 產業 | Industry | — | `verification_status`, `verification_legacy` |
| `MarketSegment` | 市場區隔 | Market Segment | — | `buyer_type`, `region`, `value_chain_stage`, `verification_status`, `verification_legacy` |
| `ProductCategory` | 產品類別 | Product Category | — | — |
| `Technology` | 技術 | Technology | — | `version` |
| `Application` | 應用 | Application | — | — |
| `SupplyRelationship` | 供應紀錄 | Supply Relationship | `stage` (enum: prospect \| qualified \| sampling \| design_win \| mass_production \| ended \| unspecified)<br>`verification_status` (enum: verified \| reported \| inferred \| suggested \| disputed) | `offering_kind`, `as_of`, `lifecycle_status`, `evidence_ids`, `last_verified_at`, `verification_legacy` |
| `CustomerOpportunity` | 客戶商機 | Customer Opportunity | `stage` (enum: identified \| contacted \| proposal \| evaluation \| won \| lost \| unspecified)<br>`verification_status` (enum: verified \| reported \| inferred \| suggested \| disputed) | `as_of`, `lifecycle_status`, `evidence_ids`, `last_verified_at`, `verification_legacy` |
| `Collaboration` | 合作紀錄 | Collaboration | `collaboration_type` (enum: joint_venture \| mou \| technical_integration \| joint_development \| strategic_partnership \| investment \| other \| unspecified)<br>`stage` (enum: rumoured \| announced \| mou_signed \| in_development \| launched \| ended \| unspecified)<br>`verification_status` (enum: verified \| reported \| inferred \| suggested \| disputed) | `announced_at`, `scope`, `lifecycle_status`, `evidence_ids`, `as_of`, `last_verified_at`, `verification_legacy` |
| `CompetitionAssessment` | 競爭評估 | Competition Assessment | `competition_type` (enum: DIRECT \| INDIRECT)<br>`overlap_scope` (enum: market \| product_category \| application \| unspecified)<br>`basis` (string[])<br>`verification_status` (enum: verified \| reported \| inferred \| suggested \| disputed) | `commercial_competition_verified`, `lifecycle_status`, `evidence_ids`, `as_of`, `last_verified_at`, `verification_legacy` |
| `Evidence` | 證據 | Evidence | `url` (url)<br>`publisher` (string)<br>`published_at` (date) | `title_zh`, `source_type`, `quote`, `link_status`, `date_method`, `period_end`, `link_checked_at`, `publisher_method`, `reverified_for_package`, `verification_status`, `verification_legacy` |
| `Claim` | 主張 | Claim | `verification_status` (enum: verified \| reported \| inferred \| suggested \| disputed) | — |
| `ETF` | ETF | ETF | `ticker` (string)<br>`as_of` (date) | `weight_source`, `url`, `website`, `verification_status`, `verification_legacy` |
| `ValueChainStage` | 產業鏈階段 | Value Chain Stage | `order` (number) | — |
| `Capability` | 製程能力 | Capability | — | — |
| `Facility` | 工廠 | Facility | `country` (string) | `city`, `capacity`, `capacity_unit`, `verification_status`, `evidence_ids` |
| `EndMarket` | 終端需求 | End Market | — | — |
| `Topic` | 趨勢主題 | Topic | `slug` (string) | `description`, `status` |
| `Event` | 事件 | Event | `event_type` (enum: launch \| partnership \| investment \| mass_production \| acquisition \| earnings \| other)<br>`occurred_at` (date) | `announced_at`, `description`, `lifecycle_status`, `region`, `verification_status`, `evidence_ids` |
| `TopicMention` | 主題提及 | Topic Mention | `mentioned_at` (date) | `sentiment`, `mention_kind`, `excerpt`, `evidence_ids` |
| `BusinessLine` | 業務線 | Business Line | — | `description`, `revenue_share`, `as_of`, `verification_status`, `evidence_ids`, `verification_legacy` |

### 命名與擷取規則 Naming and extraction rules（中文）

- **`Company` 公司** — 誰在做生意。所有供應、競爭、合作最後都要回到公司。
  - 命名：中文簡稱，例「晨光精密」「北辰半導體」。不加「股份有限公司」「Inc.」。沒有通用中文名時用最常見譯名，真的沒有才保留原文並標 name_zh_missing=true。
  - 擷取：來源：官網、公開資訊觀測站、年報。新增前先用 aliases 比對（中文名、英文名、ticker），比對到就合併，不新建。
- **`CorporateGroup` 集團** — 把同一集團下的多家法人公司收在一起。
  - 命名：中文集團名，例「晨光集團」。
  - 擷取：只在年報或官網明確寫出集團成員時建立。
- **`OrganizationUnit` 事業單位** — 公司內部的事業群或部門（不是獨立法人）。
  - 命名：「公司簡稱・單位名」，例「晨光精密・工業控制事業群」。
  - 擷取：年報組織圖、法說會簡報。
- **`Product` 產品** — 公司賣的實體或軟體產品，是競爭與供應比較的最小單位。
  - 命名：中文品名＋原廠型號，例「CG-200 邊緣運算電腦」。原文品名放 name_en。
  - 擷取：產品頁、規格書、新聞稿。來源沒寫型號時，建立「公司簡稱・某某業務」代替，並標 is_business_line=true。
- **`Service` 服務** — 公司提供的服務，例如晶圓代工、封測代工、系統整合。
  - 命名：「公司簡稱・服務內容」，例「北辰半導體・晶圓代工」。
  - 擷取：官網服務頁、法說會。
- **`ProductFamily` 產品系列** — 原廠自己定義的產品線，把多個型號收在一起。
  - 命名：中文系列名＋原文系列名，例「Jetson Orin 系列」。
  - 擷取：產品頁的系列分類。
- **`Industry` 產業** — 最大的分類，用來分區看整個市場。
  - 命名：中文，例「半導體」「工業電腦」。英文放 name_en。
  - 擷取：人工維護，不從文章抽。
- **`MarketSegment` 市場區隔** — 同一群買家、同一種需求；在同一個區隔才算真正的競爭者。
  - 命名：中文具體市場，例「AI 伺服器與 HPC 系統」。
  - 擷取：人工維護；新增區隔要經過審核。
- **`ProductCategory` 產品類別** — 跨廠商通用的產品分類，用來比較同類產品。
  - 命名：中文產品類別，例「工業邊緣 AI 電腦」。
  - 擷取：依產品規格歸類。
- **`Technology` 技術** — 共用的平台或製程，例如某個晶片平台；用來找出依賴同一技術的公司。
  - 命名：中文通稱，品牌字保留原文，例「北辰 N1 運算平台」。
  - 擷取：產品規格裡出現的平台、製程。
- **`Application` 應用** — 產品用在哪裡。
  - 命名：中文用途名詞，例「工業自動化」。
  - 擷取：產品頁的應用場景。
- **`SupplyRelationship` 供應紀錄** — 記錄「誰賣什麼給誰、到哪個階段」。一筆紀錄要接多方、階段和證據，所以是節點不是連結。
  - 命名：「A 供應 B・品項」，例「海石電路供應北辰半導體・IC 載板」。
  - 擷取：新聞、公告、年報主要客戶揭露；一定要有雙方＋品項＋日期。
- **`CustomerOpportunity` 客戶商機** — 還沒成交的潛在客戶，跟已確認的供應分開。
  - 命名：「A 對 B 商機・品項」。
  - 擷取：業務紀錄、法說會提到的潛在客戶。
- **`Collaboration` 合作紀錄** — 合資、MOU、技術整合、共同開發。
  - 命名：「A 與 B＋主題」，例「晨光精密與雲杉機器人合作」。
  - 擷取：新聞、公告：要有雙方＋內容＋日期。
- **`CompetitionAssessment` 競爭評估** — 說明兩個產品在哪個範圍、依什麼理由互相競爭。
  - 命名：「產品 A 對 產品 B」，例「CG-200 對 雲杉 AX 系列」。
  - 擷取：分析師報告、比較文章；或接受 AI 建議後由人補齊。
- **`Evidence` 證據** — 每個事實從哪裡看到的；沒有證據的事實不算數。
  - 命名：原文標題；中文翻譯放 title_zh。
  - 擷取：每個抽出的節點、連結、屬性值都附一筆。
- **`Claim` 主張** — 從證據抽出的一句話，連到它支持的紀錄。
  - 命名：原文句子的中文摘要。
  - 擷取：抽取時自動建立。
- **`ETF` ETF** — ETF 與成分股，用來看資金面。
  - 命名：中文基金簡稱，例「晨光精選50」。
  - 擷取：發行商官網的成分股清單，需有基準日。
- **`ValueChainStage` 產業鏈階段** — 讓整條產業鏈能從上游排到下游。
  - 命名：中文階段名，例「上游材料」「中游製造」「下游品牌・通路」。
  - 擷取：人工維護，每個市場區隔標一個階段。
- **`Capability` 製程能力** — 公司會做什麼（3nm、先進封裝、液冷），用來找可能的供應商。
  - 命名：中文能力名，例「先進封裝」。
  - 擷取：年報、技術頁、法說會。
- **`Facility` 工廠** — 工廠地點與產能，用來看地區風險與產能集中度。
  - 命名：「公司簡稱・地點・廠名」，例「北辰半導體・台南・一廠」。
  - 擷取：年報、官網、新聞。
- **`EndMarket` 終端需求** — 每條產業鏈最後接到哪個需求（AI 資料中心、電動車）。
  - 命名：中文需求名，例「AI 資料中心」。
  - 擷取：人工維護；可由現有「應用」擴充。
- **`Topic` 趨勢主題** — 跨產業的市場敘事/議題；不等同於一項具體技術。
  - 命名：中文優先；保持穩定 ID
  - 擷取：經人工或來源驗證寫入；內容需可追溯
- **`Event` 事件** — 有日期的真實世界變化：發表、結盟、投資、量產等。
  - 命名：中文優先；保持穩定 ID
  - 擷取：經人工或來源驗證寫入；內容需可追溯
- **`TopicMention` 主題提及** — 特定來源在特定時間提及一個主題，供熱度統計；提及不代表商業參與。
  - 命名：中文優先；保持穩定 ID
  - 擷取：經人工或來源驗證寫入；內容需可追溯
- **`BusinessLine` 業務線** — 未明確到產品型號時的營業活動，不偽裝成產品。
  - 命名：中文優先；保持穩定 ID
  - 擷取：經人工或來源驗證寫入；內容需可追溯

## 可匯入的關係 Relations you can import

共 71 種。**\*** = 必須附 `evidence_ids` evidence required。端點接受子類型 Subtypes are accepted (Product, Service → Offering)。

### corporate

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `MEMBER_OF_GROUP` | 屬於集團 | Company → CorporateGroup | 公司屬於某集團<br>Company is affiliated with or included in a named group |
| `HAS_ORG_UNIT` | 設有單位 | Company → OrganizationUnit | 公司底下的事業單位<br>Company contains branch, division, or business unit |
| `SUBUNIT_OF` | 隸屬單位 | OrganizationUnit → OrganizationUnit | 單位之間的上下層<br>Internal reporting hierarchy |
| `OWNS_STAKE_IN` | 持股 | Company → Company | 有公開揭露的持股；attributes 放 percent、as_of<br>Company has documented stake in legal entity; include percent, share_class, as_of |
| `CONTROLS` | 控制 | Company → Company | 法律上或實質控制，不能只憑少數持股推論<br>Company has legal or effective control; not inferred solely from a minority stake |
| `IS_SUBSIDIARY_OF` | 母公司是 | Company → Company | 母子公司關係<br>Derived/declared parent-subsidiary relation |

### products

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `OFFERS_FAMILY` | 推出系列 | Company → ProductFamily | 公司推出某產品系列<br>Company commercially offers a product series |
| `IN_FAMILY` | 屬於系列 | Product → ProductFamily | 型號屬於某系列<br>Specific model belongs to vendor-defined product series |
| `DESIGNS` | 設計 | Company → Product / Service | 公司設計此商品<br>Company designs product or core design |
| `MANUFACTURES` | 製造 | Company → Product / Service | 公司實際製造此商品<br>Company physically manufactures product |
| `BRANDS` | 品牌 | Company → Product / Service | 以自家品牌銷售<br>Company sells product under its brand |
| `SELLS` | 賣 | Company → Product / Service | 公司正在銷售此商品<br>Company actively offers product commercially |
| `OFFERS_SERVICE` | 提供服務 | Company → Service | 公司提供某項服務<br>Company commercially offers a service |
| `DISTRIBUTES` | 代理 | Company → Product / Service | 代理經銷，不一定是原廠<br>Company distributes product; not necessarily original manufacturer |
| `COMPONENT_OF` | 是…的零件 | Product → Product | BOM：一個產品是另一個產品的零件<br>Product is physically or logically incorporated into another product |
| `COMPATIBLE_WITH` | 相容 | Product → Product | 技術上相容，不代表有交易<br>Products are technically compatible; no sale implied |
| `USES_TECHNOLOGY` | 使用技術 | Product / Service → Technology | 商品採用某技術平台<br>Product implements stated technological platform or capability |
| `CAN_SUBSTITUTE_FOR` | 可替代 | Product / Service → Product / Service | 可滿足同一需求的替代方案<br>Documented or assessed alternative solution to similar user need; directional/contextual |

### grouping

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `IN_CATEGORY` | 屬於類別 | Product / Service → ProductCategory | 商品對應到標準產品類別<br>Product maps to standardized peer-comparison category |
| `SUBCATEGORY_OF` | 子類別 | ProductCategory → ProductCategory | 類別上下層<br>Hierarchical product taxonomy |
| `SUPPORTS_APPLICATION` | 適用於 | Product / Service → Application | 商品適用的應用場景<br>Product suited or documented for use case |
| `TARGETS_SEGMENT` | 目標區隔 | Product / Service → MarketSegment | 商品鎖定的市場區隔<br>Product marketed to buyer segment |
| `OPERATES_IN` | 經營產業 | Company → Industry | 公司的核心產業<br>Company industrial identity/core activity |
| `SERVES_INDUSTRY` | 服務產業 | Company → Industry | 公司賣進的終端產業<br>Company actively targets or sells into end market; flag whether inferred |
| `SUBINDUSTRY_OF` | 子產業 | Industry → Industry | 產業上下層<br>Industry taxonomy hierarchy |
| `APPLICATION_IN_INDUSTRY` | 應用屬於產業 | Application → Industry | 應用屬於哪個產業<br>Use case belongs to end-market industry |
| `SEGMENT_OF_INDUSTRY` | 區隔屬於產業 | MarketSegment → Industry | 區隔 → 產業<br>Competitive buyer segment within industry |
| `SEGMENT_FOR_APPLICATION` | 區隔對應應用 | MarketSegment → Application | 區隔對應的應用<br>Competitive segment addresses application |
| `CATEGORY_IN_SEGMENT` | 類別屬於區隔 | ProductCategory → MarketSegment | 類別 → 區隔<br>Product category belongs to a market segment (Industry > Segment > Category) |
| `ACTIVE_IN_SEGMENT` | 活躍於區隔 | Company → MarketSegment | 由公司的商品算出；手動只用於沒有商品資料時<br>Company works in a market segment. Computed from its offerings; asserted only for business activity without a recorded offering |
| `FEEDS_SEGMENT` | 供料給區隔 | MarketSegment → MarketSegment | 產業鏈：上游區隔的產出是下游的投入<br>Value chain: the upstream segment's output is an input of the downstream segment (e.g. IC substrates → AI chips) |

### technology

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `PROVIDES_TECHNOLOGY` | 提供技術 | Company → Technology | 公司擁有或提供他人採用的技術平台<br>Company owns or supplies a technology platform others build on (e.g. a chip designer → its compute platform) |

### supply

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `HAS_SUPPLIER` | 供應方 | SupplyRelationship → Company | 供應紀錄的賣方<br>Seller/provider in a verified or reported commercial link |
| `HAS_BUYER` | 買方 | SupplyRelationship → Company | 供應紀錄的直接買方<br>Immediate buyer or purchaser (not assumed ultimate end customer) |
| `FOR_SUPPLIED_PRODUCT` | 供應產品 | SupplyRelationship → Product | 供應紀錄的品項（產品）<br>Exactly what was supplied or contracted |
| `FOR_SUPPLIED_SERVICE` | 供應服務 | SupplyRelationship → Service | 供應紀錄的品項（服務）<br>Service that was supplied or contracted |

### opportunities

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `PROSPECTIVE_SELLER` | 潛在賣方 | CustomerOpportunity → Company | 商機中想賣的公司<br>Company seeking to sell |
| `TARGET_CUSTOMER` | 目標客戶 | CustomerOpportunity → Company | 商機中的潛在買方，不是已確認客戶<br>Named prospective buyer; not a confirmed customer |
| `PROPOSED_PRODUCT` | 提案商品 | CustomerOpportunity → Product / Service | 商機涉及的商品<br>Product relevant to buyer opportunity |
| `TARGET_APPLICATION` | 目標應用 | CustomerOpportunity → Application | 商機的目標應用<br>Target use case for proposal or identified fit |

### collaboration

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `HAS_PARTICIPANT` | 參與方 | Collaboration → Company | 合作紀錄的參與公司<br>Legal organization participating in collaboration |
| `FOCUSES_ON_PRODUCT` | 合作商品 | Collaboration → Product / Service | 合作開發或整合的商品<br>Product developed or integrated during collaboration |
| `FOCUSES_ON_TECHNOLOGY` | 合作技術 | Collaboration → Technology | 合作涉及的技術<br>Technology addressed by collaboration |
| `TARGETS_MARKET` | 合作目標市場 | Collaboration → MarketSegment | 合作鎖定的市場區隔<br>Market addressed by collaboration |

### competition

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `OFFERING_A` | 比較商品 A | CompetitionAssessment → Product / Service | 競爭評估的第一個商品<br>One assessed competing product |
| `OFFERING_B` | 比較商品 B | CompetitionAssessment → Product / Service | 競爭評估的第二個商品（不可與 A 相同）<br>Second assessed competing product |
| `COMPETES_IN_SEGMENT` | 競爭區隔 | CompetitionAssessment → MarketSegment | 競爭發生的市場區隔<br>Precisely scoped buyer market for comparison |
| `COMPETES_IN_CATEGORY` | 競爭類別 | CompetitionAssessment → ProductCategory | overlap_scope=產品類別時使用<br>Product category in which the two offerings overlap (overlap_scope = product_category) |
| `COMPETES_ON_APPLICATION` | 競爭應用 | CompetitionAssessment → Application | overlap_scope=應用時使用<br>Single application on which the offerings overlap (overlap_scope = application) |

### evidence

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `SUPPORTED_BY` | 依據 | Claim → Evidence | 主張的原始證據<br>Original evidence for assertion |
| `ASSERTS_SUPPLY` | 主張供應 | Claim → SupplyRelationship | 主張支持某筆供應紀錄<br>Claim supports a specific supplier/customer/product link |
| `ASSERTS_OPPORTUNITY` | 主張商機 | Claim → CustomerOpportunity | 主張支持某筆商機<br>Claim supports a prospective customer rationale |
| `ASSERTS_COLLABORATION` | 主張合作 | Claim → Collaboration | 主張支持某筆合作<br>Claim supports a collaboration assertion |
| `ASSERTS_COMPETITION` | 主張競爭 | Claim → CompetitionAssessment | 主張支持某筆競爭評估<br>Claim supports or qualifies a competitive assessment |

### holdings

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `HOLDS_CONSTITUENT` | 持有成分股 | ETF → Company | ETF 持有該公司；attributes 放 weight、as_of<br>ETF holds the company as a constituent; carry weight, as_of and weight_source |

### value_chain

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `IN_STAGE` | 位於階段 | MarketSegment → ValueChainStage | 每個市場區隔標一個產業鏈階段 |
| `HAS_CAPABILITY` | 具備能力 | Company → Capability | 公司具備某製程能力 |
| `REQUIRES_CAPABILITY` | 需要能力 | MarketSegment → Capability | 區隔需要某能力 → 找可能的供應商 |
| `OWNS_FACILITY` | 擁有工廠 | Company → Facility | 公司擁有工廠 |
| `PRODUCES` | 生產 | Facility → Product | 工廠生產某產品 |
| `SERVES_END_MARKET` | 服務終端需求 | MarketSegment / Application → EndMarket | 區隔或應用最後接到哪個需求 |

### event_topic

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `ABOUT_TOPIC` **\*** | 涉及主題 | Event / TopicMention → Topic | 事件或提及涉及哪個議題 |

### trends

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `HAS_MENTION` **\*** | 含提及 | Evidence → TopicMention | 來源包含可追溯的主題提及 |
| `MENTIONS_ENTITY` **\*** | 提及實體 | TopicMention → Company / Product / Technology | 來源提及實體；不證明商業參與 |
| `RELATED_TECHNOLOGY` **\*** | 主題相關技術 | Topic → Technology | 主題與技術概念關聯；不能推論商業營收 |

### events

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `EVENT_PARTICIPANT` **\*** | 事件參與者 | Event → Company | 事件中可證實的參與者及角色 |
| `EVENT_AFFECTS_OFFERING` **\*** | 事件涉及商品 | Event → Product / Service | 事件相關商品 |
| `EVENT_AFFECTS_TECHNOLOGY` **\*** | 事件涉及技術 | Event → Technology | 事件相關技術 |
| `EVENT_SUPPORTS_COLLABORATION` **\*** | 事件對應合作 | Event → Collaboration | 事件支援或更新某合作紀錄 |

### commercial

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `OPERATES_BUSINESS_LINE` **\*** | 經營業務線 | Company → BusinessLine | 公司經營的活動領域 |
| `BUSINESS_LINE_IN_SEGMENT` **\*** | 業務線面向市場 | BusinessLine → MarketSegment | 營業活動所面向的市場區隔 |

## 系統算出或建議的關係（不可匯入） Computed or suggested relations (cannot be imported)

共 10 種。

### supply

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `SUPPLIES_TO` | 供應給 | Company → Company | 由已確認的供應紀錄算出<br>Read-model projection derived from eligible SupplyRelationship, product scoped |
| `MAY_SUPPLY_TO` | 可能供應給 | Company → Company | 由尚未確認階段的供應紀錄算出<br>Read-model projection of a not-yet-confirmed supply link (prospect, qualified, sampling, or an open CustomerOpportunity) |
| `INDIRECT_SUPPLIER_OF` | 間接供應 | Company → Company | 多層供應路徑<br>Multi-hop validated supply-chain path, not direct revenue relationship |

### collaboration

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `COLLABORATES_WITH` | 合作夥伴 | Company → Company | 由有效的合作紀錄算出<br>Company-level summary of distinct active collaboration record |

### competition

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `DIRECTLY_COMPETES_WITH` | 直接競爭 | Product / Service → Product / Service | 同買家、同需求、可替代<br>Same buyer need, use case, and substantially substitutable product category |
| `INDIRECTLY_COMPETES_WITH` | 間接競爭 | Product / Service → Product / Service | 不同架構但搶同一預算<br>Alternative architecture/category addressing same outcome or buyer budget |
| `DIRECT_COMPETITOR_OF` | 直接競爭者 | Company → Company | 由商品直接競爭推到公司<br>Derived via direct product competition and selling/branding companies |
| `INDIRECT_COMPETITOR_OF` | 間接競爭者 | Company → Company | 由商品間接競爭推到公司<br>Derived via indirect product competition and selling/branding companies |

### suggested

| predicate | 中文 | from → to | 說明 Meaning |
|---|---|---|---|
| `POSSIBLE_COMPETITOR` | 可能的競爭者 | Company → Company | 由共同群組推測；接受後要建立競爭評估<br>Suggested by shared groups; becomes a CompetitionAssessment only when a curator accepts it |
| `POSSIBLE_SUPPLIER` | 可能的供應商 | Company → Company | 由技術或產業鏈位置推測；接受後要建立供應紀錄<br>Suggested by technology or value-chain position; becomes a SupplyRelationship (stage prospect) only when accepted |

## 規則 Rules（中文）

| id | kind | 說明 |
|---|---|---|
| `C-supply-supplier` | cardinality | 每筆供應紀錄恰好 1 個供應方。 |
| `C-supply-buyer` | cardinality | 每筆供應紀錄恰好 1 個直接買方。 |
| `C-opp-seller` | cardinality | 每筆商機恰好 1 個潛在賣方。 |
| `C-opp-customer` | cardinality | 每筆商機至少 1 個目標客戶。 |
| `C-collab-participants` | cardinality | 每筆合作紀錄至少 2 個參與方。 |
| `C-comp-a` | cardinality | 競爭評估恰好比較 1 個商品 A… |
| `C-comp-b` | cardinality | …與恰好 1 個商品 B。 |
| `C-comp-segment` | cardinality | 競爭評估限定在恰好 1 個市場區隔。 |
| `C-comp-distinct` | distinct_targets | 商品 A 與商品 B 不可相同。 |
| `C-evidence` | evidence_required | 關係紀錄與事件至少要引用 1 筆證據。 |
| `R-derive-competition` | derivation | 完整的競爭評估推出商品層（直接／間接競爭）與公司層（直接／間接競爭者）連結；公司是賣或品牌這兩個商品的公司。投影繼承可靠度、證據與重疊範圍。 |
| `R-derive-collaboration` | derivation | 合作紀錄的每一對公司參與方得到一條「合作夥伴」連結，帶著合作階段。 |
| `R-derive-supply` | derivation | 供應紀錄在 design_win、mass_production 或未指定階段推出「供應給」；在 prospect、qualified、sampling 推出「可能供應給」。未結案的客戶商機也推出「可能供應給」。已結束的不投影。 |
| `R-derive-groups` | derivation | 公司「活躍於」它的商品或業務線所面向的每個市場區隔（目標區隔、屬於類別 → 類別屬於區隔、業務線面向市場）。 |
| `G-company-offering` | coverage | 每家公司至少有一個商品或業務線。 |
| `G-company-segment` | coverage | 每家公司至少在一個市場區隔（直接或經由商品）。 |
| `G-offering-group` | coverage | 每個商品都放進一個區隔或類別。 |
| `G-business-line-segment` | coverage | 每條業務線都面向一個市場區隔。 |
| `G-category-segment` | coverage | 每個產品類別都屬於一個區隔。 |
| `G-segment-industry` | coverage | 每個市場區隔都屬於一個產業。 |
| `S-same-offering` | suggestion | 兩家無關的公司賣同一個商品 → 可能的競爭者。 |
| `S-same-category` | suggestion | 兩家公司的商品在同一個產品類別 → 可能的競爭者。 |
| `S-same-segment` | suggestion | 兩家公司的商品或業務線面向同一個市場區隔 → 可能的競爭者。 |
| `S-shared-technology` | suggestion | 兩家公司的商品使用同一技術 → 在該平台上可能競爭。 |
| `S-technology-provider` | suggestion | 公司的商品使用另一家公司提供的技術 → 可能的供應商。 |
| `S-value-chain` | suggestion | 公司所在區隔供料給另一家公司所在區隔 → 可能的供應商。 |
| `A-supply-certainty` | answer_mapping | 供應階段如何回答「潛在還是確定客戶？」。 |
| `A-opportunity-certainty` | answer_mapping | 商機永遠不是確定客戶。 |
| `A-competition-level` | answer_mapping | 競爭評估如何回答「同市場直接對手，還是部分重疊？」。 |
