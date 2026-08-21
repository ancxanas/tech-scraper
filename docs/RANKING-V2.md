# Ranking engine v2 — what changed and why

The old pipeline answered _"best phones under 15000"_ with four ₹1,599 OnePlus
earphones in the top four slots, a ₹15,499 phone that was over budget at #5, and
a wall of 0.00 scores below that. This document explains every root cause and
the fix, so the reasoning is auditable rather than just "it looks better now".

Run the before/after yourself — the failing run is checked in as a fixture:

```bash
deno task rank "best phones under 15000" --replay tests/fixtures/run-phones-15000
```

---

## The five root causes

### 1. Half of every scrape was thrown away

Of 120 Flipkart cards, 54 had no `product_name` and no `selling_price` — the
selectors missed — but **all 120 had an intact product URL**. The old parser
required a name field and dropped the rest. So the ranker was working from a
biased 55% sample, which is why the surviving junk (accessories that happened to
parse) floated to the top.

**Fix** — `src/core/normalize.ts` recovers titles from URL slugs:

```
/poco-c85x-sunset-gold-128-gb/p/itm5e970a19e6ad3  →  "POCO C85X Sunset Gold 128 GB"
```

Coverage went from 66/120 to **120/120**. Cards that still lack a price are kept
as spec/rating evidence for their model group instead of being deleted.

### 2. Relevance was token overlap against the raw query

`relevanceScore()` compared product titles against the tokens of
`"phones under 15000"`. No phone title contains the words "phones", "under" or
"15000", so _every_ product scored the same, and the accessory blocklist ran
only _after_ scoring as a soft penalty.

**Fix** — `src/core/classify.ts` is a weighted rule classifier with strong
signals, weak signals and vetoes, run **before** scoring. Category mismatch is a
hard gate with a recorded reason. `"OnePlus Bullets Z2 … in Ear Earphones"`
classifies as `earbuds` and is removed from a `phone` query, permanently.

### 3. Budget was never enforced

`intent.budget = 15000` was parsed, passed to the URL builder, and then ignored
by the ranker — hence the ₹15,499 phone at #5.

**Fix** — budget is a hard gate in `rankCandidates()`, with `--budget-tolerance`
if you deliberately want to see slightly-over options.

### 4. Every variant was its own row

Dedup was on the exact normalised title, so four colours of the same phone took
four slots. The scoreboard showed variety it did not have.

**Fix** — `src/core/group.ts` groups by **model + memory config**. One phone =
one row, with every offer (across colours, sellers and platforms) attached, and
`siblingConfigs` showing the other memory tiers. Review counts are taken as the
per-platform max rather than summed, so four colours don't inflate credibility
4×. Carrier-locked / refurbished SKUs are deliberately _not_ merged — they are
labelled `[carrier-locked]` and carry a warning, because that is the entire
reason their price looks good.

### 5. The score was price + discount, with no idea what a product is

`score = 0.45·price + 0.25·discount + 0.2·rating + …` cannot distinguish a
₹10,999 phone with a 2019 chipset from a ₹10,999 phone with a current one, and
it actively rewards inflated MRPs. Ratings were used raw, so 4.9★ from 3 reviews
beat 4.2★ from 150,000.

**Fix** — a four-part score, described below.

---

## How ranking works now

```
raw JSON → normalize → classify → extract specs → group variants → gate → score
```

**Spec score (absolute, 0–100).** Measured against fixed anchors, not the
competition, so a 6000mAh battery scores well regardless of what else was
scraped. Weighted per category and re-weighted by query priorities — asking for
a _gaming_ phone raises the performance weight, _camera_ raises camera.

| Component   | Sourced from                                                    |
| ----------- | --------------------------------------------------------------- |
| Performance | SoC → AnTuTu, log-scaled (`src/knowledge/soc.ts`, ~50 chipsets) |
| Display     | panel type, refresh rate, resolution                            |
| Battery     | capacity + charging wattage                                     |
| Camera      | main sensor MP with diminishing returns, OIS bonus              |
| Memory      | RAM + storage curves                                            |
| Extras      | 5G, NFC, IP rating, promised OS upgrades                        |

**Value score (relative, 0–100).** Percentile rank of _spec points per ₹1,000_
across the candidate set. This is what makes the engine willing to say "pay
₹2,000 more, get a materially better phone" instead of always picking cheapest.

**Trust score.** Bayesian-shrunk rating (prior = segment mean, strength = 500
virtual reviews), then pulled toward neutral by an evidence factor that only
approaches 1 at scale. A 14-review product cannot borrow the segment's
reputation.

**Deal score.** Discount credibility (anything over 55% off on a budget device
is treated as marketing, not savings, and flagged with `*`), cross-platform
price spread, and position against the segment median.

**Confidence.** Every candidate reports how much of its spec sheet was actually
known versus imputed from peers. Low-confidence candidates are pulled toward the
middle of the pack (`total × (0.7 + 0.3 × confidence)`) and are excluded from
superlative badges — an unknown-chipset phone can no longer win "BEST VALUE".

Unknown specs are imputed at **90% of the peer median**, on the reasoning that a
product is usually obscure rather than secretly excellent.

---

## Spec data: offline first, live only for finalists

- `src/knowledge/soc.ts` — ~50 chipsets with approximate AnTuTu/Geekbench
  figures, used for _relative_ ranking only and labelled `≈` in the UI.
- `src/knowledge/models.ts` — per-model spec sheets (panel, refresh, charging,
  OIS, IP rating…) that listing cards never expose. Each entry carries a
  `confidence` field; `low` entries are used but flagged in the UI. **A missing
  entry degrades gracefully; a wrong entry corrupts ranking silently — so only
  add what you actually know.**
- `--enrich N` (opt-in) fetches real spec sheets via Web Unlocker for the top N
  finalists only, then re-ranks. Enriching 8 of 120 cards costs ~6% of what
  enriching everything would, and products whose specs are already fully known
  are skipped automatically.

Field precedence: `enriched PDP > knowledge base > title/slug regex > inferred`.
Every field records its source, and the UI never presents an inferred value as a
measured one.

---

## Replay: iterate for free

Every live run writes its raw payloads to `runs/<timestamp>_<query>/` **before**
analysis, so a crash in the ranking code never costs a scrape credit.

```bash
deno task find "best phones under 15000" --pages 1     # spends credit, saves run
deno task rank "best phones under 15000" --replay runs/2026-08-21T...   # free
```

`rank --replay` accepts a run directory, a list of JSON files, or loose
BrightData exports — the platform is inferred from the records themselves. This
is how the ranking logic was iterated dozens of times against your existing
`$20`-budget run data without a single new request.

---

## Scraper fixes

| Platform  | Bug                                                                                                                            | Fix                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Reliance  | URL hard-coded to `/collection/smartphones` for any phone query — returned ₹499 earphones, ignoring the query entirely         | real search endpoint with the query, budget and pagination       |
| Tata CLiQ | `text=query:relevance:category:MSH1210` renders a page whose product grid never mounts → `wait_element_timeout` after 48 polls | plain text search + price facets                                 |
| Flipkart  | unsorted relevance results                                                                                                     | `sort=popularity` + price facets so page 1 holds real contenders |
| All       | no per-platform timeout; one stuck collector blocked the whole run for 8 minutes                                               | per-platform timeout, failures isolated and reported             |

---

## Test coverage

`tests/core_test.ts` — 29 tests, including three regressions pinned to the real
captured run:

- a phone query never returns earphones,
- no model may occupy more than two of the top ten,
- the winner is spec-justified rather than merely cheapest.

```bash
deno task check     # fmt + lint + type-check + 106 tests
```

---

## What is still worth doing

1. **Grow the model KB.** It currently covers ~30 models well. Everything else
   ranks with `conf < 50%` and says so. This is the single highest-leverage
   improvement and costs nothing but data entry.
2. **Amazon coverage.** The fixture had no Amazon payload, so that path is
   verified only by unit tests, not against real data.
3. **Price history.** Deno KV is wired but unused by v2 ranking — "cheapest in
   30 days" would make the deal score much stronger.
4. **Reliance/Tata CLiQ collectors.** The URL fixes are in; the collectors
   themselves still need one live run each to confirm their selectors.
