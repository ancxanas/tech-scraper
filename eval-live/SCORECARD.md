# Live scorecard — 5ea0118 (+ prescrapers fix) — 2026-08-19

## Env

- deno 2.9.5 (stable, x86_64-unknown-linux-gnu)
- HEAD: 5ea0118 + prescrapers.ts fix (snapshot endpoint)
- BRIGHTDATA_API_KEY: 8a5****71a3
- Collectors:
  - Flipkart: `c_msyq5fv71wizb98a5s` (scraper, page-based)
  - Reliance: `c_msxt4lsv12k5p1328b` (scraper, scroll-based)
  - Tata CLiQ: `c_msxt4nhe2fxyb7bjnw` (scraper, scroll-based)
  - Amazon: prebuilt `gd_lwdb4vjm1ehb499uxs` (tool=prebuilt, no custom
    collector)

## Commands run

| Command                                          | Platform  | Status                                             | Time   |
| ------------------------------------------------ | --------- | -------------------------------------------------- | ------ |
| `search "sony wh-1000xm5" -p flipkart --pages 2` | Flipkart  | 968 raw, 968 parsed, 5 ranked                      | ~15s   |
| `search "sony wh-1000xm5" -p reliance`           | Reliance  | 24 raw, 24 parsed, 4 ranked                        | ~250s  |
| `search "sony wh-1000xm5" -p amazon --pages 2`   | Amazon    | 38 raw, 32 parsed, 9 ranked                        | ~60s   |
| `search "sony wh-1000xm5" -p tatacliq`           | Tata CLiQ | TIMEOUT (>600s)                                    | 10min+ |
| `search "sony wh-1000xm5" -p flipkart --pages 1` | Flipkart  | TIMEOUT (queued)                                   | 120s+  |
| `search "iphone 15 case" -p amazon --pages 1`    | Amazon    | 18 raw, 18 parsed, 18 ranked                       | ~30s   |
| `search "iphone 15 case" -p reliance`            | Reliance  | 9 raw, 9 parsed, 0 ranked                          | ~200s  |
| `best-deal "sony wh-1000xm5" -p amazon`          | Amazon    | 0 ranked                                           | ~30s   |
| Multi-platform `"sony wh-1000xm5" --pages 3`     | All 4     | Flipkart/Tata timeout, Amazon 49 ok, Reliance 9 ok | 600s+  |

## Gate table

| Gate | Status   | Evidence                                                                                      |
| ---- | -------- | --------------------------------------------------------------------------------------------- |
| G1   | **PASS** | 61/61 tests pass (42 unit + 19 integration/mock)                                              |
| G2   | **FAIL** | Flipkart/Reliance/Tata CLiQ: 404 on `/dca/collectors/{id}`. Amazon prebuilt ok=true.          |
| G3   | **PASS** | Flipkart Q1: raw=968, parsed=968 (>=15), IDs unique                                           |
| G4   | **SKIP** | Flipkart collector queued on all subsequent runs after first                                  |
| G5   | **PASS** | Reliance status=ok, all productUrls contain `/product/` (4 ranked)                            |
| G6   | **SKIP** | Tata CLiQ collector polling >600s, never completed standalone                                 |
| G7   | **PASS** | Amazon status=ok, parsed=32, asin IDs present on 9/9 ranked                                   |
| G8   | **PASS** | name+price+productUrl >= 85% on all ok platforms. reviewsCount >= 40% on Flipkart and Amazon  |
| G9   | **PASS** | Flipkart has 5 Sony rows, Amazon has 5 Sony rows, different platforms, not collapsed by dedup |
| G10  | **SKIP** | best-deal returned 0 ranked (relevance filter)                                                |
| G11  | **PASS** | Q3 "iphone 15 case": 18/18 Amazon products contain "case" in name                             |
| G12  | **FAIL** | `enrichCount` defined in ScrapeOptions but never used. No PDP enrich pass implemented.        |
| G13  | **FAIL** | `savePrices()` called unconditionally at lines 176, 245, 336. `--no-save` flag is dead code.  |
| G14  | **SKIP** | No platform empty during live tests (timeouts prevented empty results)                        |
| G15  | **PASS** | No secrets found in eval-live JSON files                                                      |

## Per-platform results (from individual platform runs)

### Flipkart

- raw=968, parsed=968, ranked=5, fieldFill=72%
- 5 Sony products found, all with name, price, productUrl, imageUrl, brand
- reviewsCount present on 80%, rating on 80%
- Subsequent runs timeout (collector queue)

### Reliance Digital

- raw=24, parsed=24, ranked=4, fieldFill=60%
- productUrl all contain `/product/` (correct path)
- Missing: rating (0% from scraper), reviewsCount (0%)
- Q3: 9 raw but 0 ranked (relevance filter)

### Amazon India (prebuilt)

- raw=38, parsed=32, ranked=9, fieldFill=80%
- ASIN IDs present on all ranked products
- reviewsCount 100% on ranked products
- Fix applied: `/datasets/v3/snapshot/{id}` instead of `progress.data`
- Q3: 18 raw, 18 parsed, all contain "case"

### Tata CLiQ

- Never completed standalone (polling >600s)
- In multi-platform run: showed 40 products (stderr confirmed)
- Collector appears unreliable for standalone use

## What still fails (ordered by severity)

1. **G13: `--no-save` is dead code** — `savePrices()` always called (P0 bug)
2. **G12: `--enrich` is a no-op** — enrichCount never used, no PDP pass (P1
   missing feature)
3. **G2: Doctor 404 on collector endpoints** — `checkCollector` uses wrong API
   path
4. **Flipkart collector queue** — subsequent runs timeout, only first run works
5. **Tata CLiQ unreliable** — polling never completes standalone
6. **Relevance filter too strict** — `scoreAndRank` drops most products,
   best-deal returns 0

## Demo-ready?

**No.** G1, G3, G5, G7, G8, G9 all PASS. But Flipkart (primary platform) only
works on first run, and Tata CLiQ never completes standalone. The relevance
filter drops too many products.

## Bugs found during live testing

| Bug                                                                                        | Severity | Location                        | Fix                                       |
| ------------------------------------------------------------------------------------------ | -------- | ------------------------------- | ----------------------------------------- |
| `prescrapers.ts` reads `progress.data` (undefined) instead of `/datasets/v3/snapshot/{id}` | **P0**   | `src/lib/prescrapers.ts:99-101` | **Fixed in this session**                 |
| `--no-save` flag ignored                                                                   | **P0**   | `src/cli.ts:176,245,336`        | Guard `savePrices` with `!options.noSave` |
| `--enrich` does nothing                                                                    | **P1**   | `src/scraper.ts:17`             | Implement PDP enrich pass or remove flag  |
| `checkCollector` 404s on all custom collectors                                             | **P2**   | `src/lib/brightdata.ts:73`      | Verify DCA v2 API path                    |
