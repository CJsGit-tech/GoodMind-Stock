# PocketStocks 本機 Staging

從 AppDeploy staging `pocketstocks-staging-3nv7e2` 的來源版本 `1792055310478` 匯出，保留原本的 React/Vite 畫面、研究書籍、讀者與作者流程及 ETF 功能。

## 啟動

需要 Node.js 22.13 以上（使用 Node 內建 SQLite；22.x 可能顯示實驗性 API 提示）。

```sh
cd /Users/chuang/Desktop/projects/AppDeploy/PocketStocks/pocket-stock-staging
npm ci
npm run dev
```

開啟 http://localhost:5173。首次啟動會自動建立權限為 600 的 `.env`，內含隨機產生的本機作者密碼。作者登入時使用該檔案中的 `ADMIN_MASTER_SECRET`，不要使用正式環境密碼。修改 `.env` 後重新啟動。可在 `.env` 設定 `PORT` 改用其他連接埠。

瀏覽器畫面會顯示「本機 Staging」。前端編輯自動更新；後端修改由開發模式重新啟動。`npm start` 啟動不監看檔案的本機服務。這兩個指令均只監聽本機 loopback。

## 資料與登入

- `.local/pocketstocks.sqlite`：可持久保存的本機資料庫。
- `.local/storage/`：本機上傳圖片及內建範例頁面；透過有時效簽章的 URL 讀取。
- `.env`：本機作者密碼；不會印在服務輸出、不會提交到 Git。
- 讀者登入可選擇「本機測試讀者 A」或「本機測試讀者 B」，不會連到 Google、Email 或 AppDeploy。兩個測試帳號的收藏、私人評論及回饋各自隔離，並以 HttpOnly cookie 識別。先登出再選另一個身份。

首次讀取會建立原程式內建的三本範例研究；每日 ETF 正規化資料初始為空。可使用下方內容還原指令加入已保存的漫畫與 ETF 資料。還原來源、雜湊及本機發布識別保存在 `.local/imports/content-recovery-v1.json`，實際匯入結果與限制記錄在 PS-301。雲端讀者帳號、留言、收藏及工作階段不會搬到本機。

## 從已保存檔案還原內容

```sh
npm run import:content              # 只核對來源、圖片雜湊、日期與筆數
# 先停止本機服務，再執行：
npm run import:content -- --apply   # 先備份，再匯入
npm run dev
```

預設來源為 `/Users/chuang/Desktop/manga-layout-templates` 與 `/Users/chuang/Downloads/ETFPostclose/backfill-20261015`。可用 `--manga-dir`、`--etf-dir`、`--data-dir` 指定其他路徑。指令只在本機讀寫，不呼叫雲端、不修改來源檔案，也不使用正式環境密碼。

漫畫只採用有發布紀錄的套件，保留書籍 ID、頁序與原始 JPG 位元組。來源未記錄的分類顯示「來源未記錄」，標籤留空。未確認發布的新版不會蓋掉已發布版。ETF 僅還原已發布收據對應日期，沿用原本分塊、驗證、審閱及發布函式；其餘日期保留缺漏。部分既有主檔需從檔案中的識別資訊重建，無法確認的欄位保持未知。來源包、原雲端收據與本機新收據各自留存，不宣稱重建後識別碼或 review hash 與雲端資料庫逐位元相同。

原始碼內附的完整 ETF 報告可還原為一個本機版本；雲端既有 v2/v3 報告快照不在這個來源包中，不能用它聲稱舊版本歷程已完整搬移。

每次套用前會將 SQLite 與檔案儲存備份到 `.local/backups/<時間>/`。重跑會核對已匯入來源與收據；遇到來源 ID 衝突或本機已修訂資料會停止，不覆寫既有內容。若需回復，先停止服務，再使用對應備份中的 SQLite 與 storage 取代目前資料；保留原 `.env`。

本機開發及檢查不會呼叫 AppDeploy API。頁面原有的外部來源連結或字型仍可能需要網路。Google/email OAuth、AppDeploy 配額、遠端儲存和分散式資料一致性須在對應平台另外驗證。此服務是個人本機開發用途，請勿公開監聽或部署此測試登入替代服務。

## Author 上傳

作者工作區以「選擇上傳內容」提供研究書籍（JPG／PNG／WebP 頁面圖片）與 ETF 分析報告兩個入口。ETF 的「研究文章」以單一 `data.json` 為主要來源，並相容歷史 `report.md`，一次解析全文、三組配置資料、日期、樣本與來源；選檔不會保存或發布。先驗證、保存私有草稿、預覽同版文章，再明確記錄審閱及確認發布。「歷史 JSON 報告」保留既有資料包；「每日資料」仍是獨立維護流程。不解析 PDF 或執行 HTML；`report.html` 為讀取 JSON 的獨立閱讀模板，不需上傳。

JSON 接受 `tw-active-etf` 5.0.0，分析採 1.0.0 typed token AST，明確的段落、粗體及 data_highlight 直接呈現，不猜測文字格式。MD 接受 `tw-active-etf` 的外部資料契約 `4.0.0`（已知中／英文章節標題皆可）。來源最多 512 KiB、展開資料最多 4 MiB；超限會拒絕並保留原文。原始 MD、SHA-256、解析器版本及所有欄列保留，使用應用儲存版本 3 的不可變來源頁。同一 `report_id` 保存為草稿修訂，修改會使審閱失效；公開版本只在明確發布時一起更新，舊版本仍可讀。

外部 AI 工具可沿用 Author 登入與同源權限呼叫 `/api/admin/etf-research/{validate,save,get,list,review,publish,visibility,status}`，不能繞過伺服器驗證。`validate` 接收 `rawSource`（JSON 或 MD 原文）；舊 `/etf-markdown/` 與 `rawMarkdown` 仍相容；`save` 另需 `baseRevision`、`requestId`；`review` 需 `id`、`baseRevision`、`sourceHash`、`requestId`；`publish` 需目前 `baseRevision`、`expectedPublishedVersion`、`reviewHash`、`reviewed: true` 與唯一 `requestId`。保存／審閱／發布回傳 `entry`；結果未知時，先以原 `requestId` 呼叫 `status`，不要產生新識別碼重送。不要將作者工作階段或密鑰寫入 MD、網址、檔案分享或日誌。這些操作不需要另外發布每日資料。

讀者從同一 ETF 列表開啟已發布 JSON／MD，在「重點分析」、「配置圖表」與「參考來源依據」閱讀。配置圖表提供產業方向、個股異動、完整週度趨勢與本週截至研究日；參考來源依據以精簡編號引文列出來源，文章引註及圖表來源入口可切入此分頁；完整方法、限制及每週份額仍保留於原始資料與圖表證據。張數與金額僅在展示時換算；未知、已確認零及未持有各自保留。股數差估值不代表實際交易或申贖現金流。網址保存文章公開版與閱讀篩選，Author 私有預覽沿用相同三個分頁且不改動讀者網址。

重點分析使用上方三項數據、分節主文與跟進欄；已有同期間份額時，第三項呈現增持估值最多基金的份額變化。新 JSON 使用已驗證 token，只有明確 semantic 數據標記套用重點樣式。`etf-markdown-prose.ts` 僅適用歷史 MD，整理解析後的閱讀結構：舊版段首粗體小標轉為標題，財務數字以淡底標示，段末來源另行呈現。日期、ETF 代碼、連結目標與原始 Markdown 不改寫；沒有跟進小節時不生成假內容。配置圖表沿用右側關鍵數據，Author 預覽共用相同呈現。

目前相容 skill 5.3.0 的三檔輸出（`data.json`、`report.html`、`cover.jpg`），JSON 容器仍為 5.0.0、文字格式 1.0.0、圖表格式 4.0.0。HTML 的自動載入規則不改動應用程式的資料 schema。Author 可展開「來源格式與解析識別」核對版本；重新匯入相同原文會提示內容一致，不需再次保存或發布。JSON 關鍵數據依明確標籤與數據標記呈現為標籤／數值／說明，缺少這組結構時保留原 token 呈現，不猜造數據。

### ETF 封面

研究文章可在 Author 選擇伴隨的 `cover.jpg`：480 × 360、RGB JPEG、最多 1 MiB。封面是研究摘要圖片，不取代 JSON，也不解析 HTML。選圖及驗證不會公開；保存私有草稿後，預覽封面及文章、記錄審閱，再明確同版發布。列表完整顯示 4:3 封面，舊報告無封面仍顯示原本替代圖。

`validate`／`save` 可附 `cover: { contentBase64, filename }`；省略表示保留既存封面，`null` 表示移除。封面 SHA-256 獨立於研究原文 SHA-256，與草稿修訂、審閱及發布快照綁定。研究或封面改動需重新審閱；相同研究及相同封面不增加修訂。公開舊版保留原封面。API 回傳的 `cover` 包含雜湊、尺寸、大小、類型及短效 URL；不要持久保存 URL。公開封面刷新入口為 `/api/etf/reports/:id/cover?version=N&sha256=H`，只提供已發布且未取消公開的對應版本。

封面沿用既有圖片儲存的 15 分鐘簽章連結，私有預覽須先驗證作者；圖像 URL 本身是短效 bearer 能力，不是逐張圖片的 cookie 驗權。服務端檢查 JPEG 結構、尺寸、通道及雜湊，Author 再確認瀏覽器可解碼；不以結構驗證宣稱已查證封面數據。

## 檢查

### ETF 假資料

```sh
npm run seed:demo
```

這個指令重用既有測試產生器與完整驗證／發布管線，建立 5 檔虛構基金、3 個產業及 21 個日期的測試資料。已存在的 QA 日期會保留，重跑不會覆寫。資料位於獨立 `qa-etf-history` 範圍，與還原的市場資料分開。公開歷史追蹤頁與捷徑已移除，舊 history 網址會返回 ETF 分析列表。此種子只供內部資料管線、發布及回復測試，不代表市場觀測。

### 回歸與瀏覽器流程

```sh
npm run build       # 前端建置
npm run typecheck   # 前端型別檢查
npm test            # 本機資料庫測試與原本的後端回歸檢查
npm run test:ui     # 需要已安裝 Google Chrome
npm run test:markdown # MD 格式、安全性、快照與並行保存
npm run test:ui:markdown # MD 完整 Author／Reader 瀏覽器流程
```

`test:ui` 使用真正的 Chrome、HTTP 服務與 SQLite，另開隨機 localhost 連接埠及可拋棄資料庫，測試讀者與作者流程、權限隔離、載入失敗恢復、ETF 書庫搜尋／分頁、歷史入口移除、書籍與 ETF JSON 兩種上傳、報告 Tab、每日資料發布及回復。它使用臨時產生的作者密鑰，不讀取或輸出實際作者密碼；所有新增、修改、刪除只作用在測試資料庫，結束後會清除。設定 `POCKETSTOCKS_UI_EVIDENCE_DIR` 可保存 JPG，預設不保留測試截圖。

`test:ui:markdown` 在可拋棄資料庫執行無效匯入保留、審閱／發布、公開版不受草稿影響、提交後回應遺失、狀態恢復、版本衝突、分頁篩選、鍵盤及讀取失敗重試。`test:local` 另外涵蓋 MD 的實際 HTTP 權限、版本及重啟保存與讀者計算／安全呈現。`test:markdown` 使用自足的合成資料；要逐欄比對實際 skill 輸出與 Python codec，可設定 `ACTIVEETF_REPORT` 為本機 `report.md` 絕對路徑後執行，未設定時該案例明確標示 skip。測試不發布真實研究至使用中的資料庫。

`local/` 提供本機 HTTP server、SQLite、檔案儲存與測試登入介面。Vite/TypeScript 將原本的 AppDeploy SDK imports 導向這些本機介面，原有 UI 與後端路由仍可重用。HTTPS 圖片驗證僅對設定的 localhost 簽章資產端點加入 HTTP 例外；雲端來源檔並未被部署修改。

`npm run build` 只驗證前端 bundle；開啟完整功能請使用 `npm run dev` 或 `npm start`，不要將 `dist/` 當成完整後端應用程式。

工作規則與交付證據記錄在 [PS-301](https://linear.app/cjsloth/issue/PS-301/build-local-pocketstocks-staging-environment)。既有雲端 AppDeploy apps 仍保留，雲端部署需另行授權。

舊版 JSON 報告可從 Author「發布紀錄」取消公開或恢復公開；取消後公開列表及指定版本連結均不再提供報告，私有草稿與已發布快照保留。此動作沿用 Author 權限、版本衝突檢查及原請求結果查詢，不會清除每日資料。

### 研究文章下架與恢復

JSON／MD 研究文章可從 Author「發布紀錄」選擇「下架公開文章…」或「恢復公開文章…」，確認後才套用。下架會隱藏公開列表、指定版本閱讀及封面刷新入口；草稿、來源頁、封面與不可變歷史保留。恢復原公開版不增加修訂或版本，也不發布尚未公開的草稿。保存新草稿仍保持下架；另行審閱並發布新版本才會重新公開。已取得的短效圖片網址或快取不保證立即失效。

visibility 接受 id、baseRevision、expectedPublishedVersion、expectedUpdatedAt、archived 布林值及 requestId。沿用作者／同源權限、版本與更新時間衝突檢查、原子交易及操作回執；結果未知時以同一 requestId 查 status，勿重複提交。此三檔功能同步自 Production snapshot 1792247369483；本機仍使用獨立身份、SQLite 與儲存，不代表雲端平台等同。驗收與 JPG 見 PS-308，Production 紀錄見 PS-310。


### Git 變更追蹤

Git 儲存庫位於上層 `PocketStocks/`，包含本機應用程式的前端、後端、測試、必要資產與啟動設定。`local-app-baseline-2026-10-18` 標籤代表開始追蹤時的完整程式碼；建立基準前的修改不會自動拆成歷史提交。

在 `PocketStocks/` 執行：

```sh
git switch -c codex/your-change
git status --short
git diff                         # 未暫存修改
git diff --cached                # 已暫存修改
git log --oneline --decorate     # 提交歷史
git show <commit>                # 特定提交
git diff local-app-baseline-2026-10-18 -- pocket-stock-staging/src
```

完成一項修改並驗證後，僅加入該項檔案，再以含 Linear 工單編號的訊息提交。共用元件與功能修正應分開提交，方便審查與回溯。PM 決策與驗收證據仍以 Linear 為準。

`.env`、`.local/`、SQLite、上傳檔、套件、建置與測試輸出不納入版本控制。Git 只保存程式碼，不能代替本機資料備份。儲存庫目前僅供本機使用；設定遠端或推送需另外授權。


### 載入效果同步

2026-10-20 依 PS-320 同步 Production snapshot `1792496622494` 的共用 shimmer 元件與載入狀態，涵蓋書庫、閱讀圖片、ETF／法人文章、Author 及表單。`src/loading.tsx`／`src/loading.css` 為共用來源；減少動態偏好改用靜態骨架。執行 `npm run test:loading` 檢查元件契約。保留本機測試讀者、API 介面、資料、憑證與估值功能；此同步未重新部署 Production。
