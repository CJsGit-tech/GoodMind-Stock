# Filling gaps in existing nodes

Count gaps by cause first with `npx tsx $SKILL/scripts/gaps.ts` (from the repository root). Pass node names or ids to
see their current relations and gaps. Then work in this order.

| Order | Gap (rule) | Method |
|---|---|---|
| 1 | Product or service with no segment or category (`G-offering-group`) | Classify from the record's own sources. Cheapest, and it also clears the company's segment gap. |
| 2 | Segment or business line not linked (`G-segment-industry`, `G-business-line-segment`) | Link to an existing industry or segment when a source supports it. |
| 3 | Company with no offering (`G-company-offering`) | Use the company's own filing or product pages. One chain: company → offering → segment → industry. |
| 4 | Evidence without a title or date (`Q-needs-review`) | Take it from the page itself. A date in page text may be unrelated to publication. |
| 5 | `Q-unspecified`, `Q-unreachable-link` | Check once. Leave it unknown if no source says; replace a dead link only with a page that supports the same fact. |
| — | `Q-name-zh` | Add a Chinese name only if a reliable source uses it. |

Some gaps are not defects: a page may have no publication date. Record what you checked in `report.md` instead of
filling it in. Work in batches of about 10 companies and report after the first batch, so the user can decide whether
to continue. Reuse segments across companies; a new segment for each product makes comparison useless.

Document links must open the document itself. A file list or a one-time download link does not count.
