# Link Validation Report

**Project:** CashFlow
**Date:** 2026-08-04
**Scope:** All relative and external links across 260 scanned Markdown files, plus embedded screenshot assets.

---

## Totals

| Metric | Value |
|---|---|
| Total links discovered | **498** |
| Relative links checked | **483** |
| External links (spot-checked) | 15 |
| Broken relative links | **1** (fixed) |
| Undefined references | **1** (fixed) |
| Stale plain-text references | **1** (fixed) |
| Remaining broken links | **0** |

**Pass rate after fixes: 100%.**

---

## Issues Found & Fixed

| # | Location | Type | Detail | Status |
|---|---|---|---|---|
| 1 | `.github/PULL_REQUEST_TEMPLATE.md` | Broken relative link | Target file missing/moved | ✅ Fixed |
| 2 | `README.md` | Undefined reference | `[1.0.0]` reference link target undefined | ✅ Fixed |
| 3 | `docs/system/SCREENSHOT_INDEX.md` | Stale plain-text reference | Referenced an old harness name | ✅ Fixed |

No other broken links, orphan anchors, or unreachable external targets were found.

---

## Screenshot & Image Asset Validation

| Metric | Value |
|---|---|
| Screenshot files present | **21** |
| Capture date | All captured **2026-08-03** |
| Missing referenced images | **0** |
| Stale screenshots | **0** (all current) |
| Indexed in `SCREENSHOT_INDEX.md` | 12 of 21 |
| Embedded in docs | 0 of the 12 indexed (indexed but never embedded) |

**Observation:** 12 screenshots are catalogued in the index but never embedded in any document. This is a content-opportunity, not a defect. Recommend embedding the most relevant shots in `docs/ui/` and `README.md` in a future pass.

---

## DOCUMENTATION_MAP.md Health

| Check | Result |
|---|---|
| All listed files exist | ✅ Yes |
| Per-folder counts accurate | 🔧 Corrected this sync |
| `repository/` real-doc count | Corrected to **11** |
| `assets/` real-doc count | Corrected to **1** |
| Hub navigates all active folders | ✅ Yes |

The map is now the reliable single entry point for documentation navigation. See [DOCUMENTATION_STRUCTURE.md](./DOCUMENTATION_STRUCTURE.md).

---

## Method

1. Extracted every Markdown link and image reference repo-wide.
2. Resolved relative targets against the filesystem; flagged any missing file.
3. Flagged reference-style links with no matching definition (e.g., `[1.0.0]`).
4. Flagged plain-text cross-references to renamed/removed components.
5. Verified each image reference resolves to an existing file.
6. Re-ran validation after fixes to confirm zero remaining breakage.

---

## Recommendation

Add an automated link check to CI so future moves/renames cannot silently reintroduce broken links. The current corpus is at **0 broken links**.
