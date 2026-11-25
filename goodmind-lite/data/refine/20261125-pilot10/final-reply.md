The upload file is ready with 61 records and 7 new evidence entries. Nothing is held. I did not import or publish anything, and `data/db.json` is unchanged.

Upload file: `goodmind-lite/data/refine/20261125-pilot10/out/ops.json`

**Counts:** 61 ready, 0 ready with gaps, 0 held, 0 duplicates merged. On the verifier's first pass, 59 passed and 2 failed. With the 2 records that depended on one failure, 57 were ready and 4 held.

- **新日興 sales link:** the quote named only the group. I added the sentence naming the company and its subsidiaries.
- **中華資安國際 SOC:** the target market includes government customers, which the web page quotes did not show. I added its 114年度 annual report. Both fixed records then passed. The "台灣" part of that market name rests on the word 國內, which the verifier accepted as a judgement call.

**By company** (I applied the file to a temporary copy of the graph; all 10 no longer show the company-level product or market segment gaps):

| Company | Now links to |
|---|---|
| 中砂 | CMP diamond disks and reclaim wafers, then 半導體 |
| 新日興 | hinges, then 電子零組件與材料 |
| 聖暉 | cleanroom and M&E engineering, then 工程服務 |
| 台塑化 | oil products, then 石油煉製; basic petrochemicals, then 化學材料 |
| 上詮 | both existing products, then 半導體 or 網通設備 |
| 中華資安國際 | SOC and MDR services, then 資訊安全 |
| 台燿 | both laminate materials and the lamination service, then 電子零組件與材料 |
| 南亞科 | DDR5, then 半導體 |
| KEMET | T528, then tantalum capacitors, then 電子零組件與材料 |
| ECLAT Vietnam | an apparel business line, then 紡織成衣 |

**What is still open**
- **Foreign names:** I found no source giving either legal entity a Chinese name, so both keep their original names. This was not an exhaustive search.
  - 國巨's annual report lists KEMET Electronics Corporation in English. Its 基美 wording does not name this entity, and 基美電子（蘇州） is a different company.
  - 儒鴻's annual report names 儒鴻製衣(越南) plants but never pairs that name with the English legal name.
- **南亞科 validation service:** it still has no market segment. The sources describe support for customers' product development, not a market it is sold into. So "products or services with no market segment" is not fully cleared.
- **ECLAT Vietnam:** the filing shows only that it designs, makes and sells apparel, so it has a business line, not a product or service. I did not put it in the existing sportswear ODM segment.
- **Report wording:** "0 ready with gaps" does not mean there are no gaps. The report does not list the two items above.

**Please check before importing**
- **New categories:** the file adds four industries (工程服務, 石油煉製, 資訊安全, 紡織成衣) and 13 market segments. It also reuses 矽光子元件 and the SOC segment, and gives the SOC segment an industry. The names and grouping are my classification choices.
- **Weaker support:** these passed, but their evidence is less direct.
  - Hinges under electronic components rests on the company's remark about its component production technology. The report has a more direct passage that the record does not cite.
  - DRAM under semiconductors rests mainly on DRAM being listed within the IC industry. The other quote is from a director's biography.
- **Dates:** the new sales and service links are dated 2025-12-31 because they come from 2025 annual reports (聖暉's also cites its current services page). The quoted sentences do not state that date.
- **Publication dates:** four of the new evidence entries have none and are marked for review.
- **Annual report links:** for 新日興, 聖暉, 台塑化, 南亞科 and 中華資安國際, the link opens the official MOPS (公開資訊觀測站) file list, not the PDF itself. A reader has to pick the annual report there.

**Sources I could not use directly**
- **台塑化 website:** it showed a bot check, which I did not get around. I used the MOPS annual report.
- **新日興 website:** one address had a certificate for a different name. The official site failed the command-line certificate check but opened in the built-in browser. I did not save or cite anything from it, and used the MOPS annual report.
- **中砂 web pages:** they had no usable product text without scripts, so I used the annual report from the same site.

No input files were provided, so none were unreadable. There are no ontology proposals.

**My spot check:** I compared seven links with their quotes or saved source text: sales for 中砂 reclaim wafers, 新日興 hinges and 台塑化 petrochemicals; 聖暉's service; ECLAT Vietnam's business line; DRAM's industry; and KEMET's segment. I found no contradictions, subject to the caveats above. For ECLAT, the 2026-09-30 date matches the table's 115.9.30 column, which the quote itself does not include. The verifier compared some web pages live, mostly through summaries and excerpts. It did not re-download the PDFs.

**Cost:** the two verifier runs reported 212,029 and 111,376 tokens. My own token use was not reported. Per-company results are in `pilot-metrics.json`.
