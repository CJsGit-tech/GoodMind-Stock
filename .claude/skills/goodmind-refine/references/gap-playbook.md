# Filling gaps in existing nodes

Count by cause before researching, with `npx tsx $SKILL/scripts/gaps.ts` (from `goodmind-lite/`; the app's report
lists at most 800 issues). Pass node names or ids to see their current relations and gaps. Then work in this order.

| Order | Gap (rule) | Method |
|---|---|---|
| 1 | Product/service with no segment or category (`G-offering-group`) | Classify from the record's own sources. Cheapest, and it also clears the company's segment gap. |
| 2 | Segment or business line unlinked (`G-segment-industry`, `G-business-line-segment`) | Link to an existing industry or segment when a source supports it. |
| 3 | Company with no offering (`G-company-offering`, usually also `G-company-segment`) | Research the company's own filing or product pages. One chain: company → offering → segment → industry. |
| 4 | Evidence title/date (`Q-needs-review`) | Retrieve from page metadata (see `scripts/fetch_evidence_dates.py`); check a sample by eye. A date in page text may be unrelated to publication. |
| 5 | `Q-unspecified`, `Q-unreachable-link` | Check once. Leave unknown if no source says; replace a dead link only with a page that supports the same fact. |
| — | `Q-name-zh` | Add a Chinese name only if a reliable source uses it. Otherwise it is correct as it stands. |

Some gaps are not defects. Catalogue pages often have no publication date, and a company may be in the graph only
because an ETF holds it. Record what you checked and when in `report.md` rather than filling it in. (The app does
not yet have a "checked, none published" field, so these warnings remain.)

Work in batches of about 10 companies. After the first batch, report ready/held counts, why records were held and
the tokens used where the app reports them (say so where it does not), so the user can decide whether to scale before the cost is spent. Reuse segments across
companies: a new segment for each product makes the graph useless for comparison.
