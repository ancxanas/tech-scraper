# tech-scraper

> A deal-finding CLI for Indian tech shoppers that self-heals when sites
> redesign.

Built for the
[ScrapeVerse Hackathon](https://www.wemakedevs.org/hackathons/scrape-verse)
using Bright Data Scraper Studio.

## What it does

**v2 ranking engine** (see [docs/RANKING-V2.md](docs/RANKING-V2.md)) — the query
is understood, products are classified and spec-matched, variants are grouped,
and results are ranked on value rather than on price alone:

```bash
deno task find "best phones under 15000"                  # live scrape + rank
deno task rank "best phones under 15000" --replay runs/…  # re-rank offline, free
deno task snapshot sd_xxx --platform amazon --out runs/x  # re-download a paid snapshot
```

- **Hard relevance gating** — a phone query returns phones. Category is decided
  before scoring, not patched afterwards, and the budget is enforced.
- **Spec-aware scoring** — chipset (AnTuTu), display, battery, camera, memory
  and extras, weighted by what the query actually asked for.
- **Value, not just price** — percentile of spec-points-per-rupee, so the engine
  can recommend paying ₹2,000 more for a materially better phone.
- **Honest confidence** — every product reports how much of its spec sheet was
  known versus inferred; low-confidence items cannot win badges.
- **Variant grouping** — one phone is one row, with every colour/seller/platform
  offer attached; carrier-locked and refurbished SKUs stay separate and
  labelled.
- **Trustworthy ratings** — Bayesian shrinkage, so 4.9★ from 3 reviews loses to
  4.2★ from 150,000, and inflated MRPs are flagged instead of rewarded.
- **Replayable runs** — raw payloads are saved before analysis, so ranking can
  be iterated endlessly without spending scraping credit.
- **Rich terminal UI** — ranked table, per-product verdict cards with score bars
  and pros/cons, head-to-head spec matrix, and a coverage funnel showing where
  every scraped card went.

### Also included

- Searches across 4 Indian e-commerce platforms: Flipkart, Reliance Digital,
  Tata CLiQ, Amazon India
- Discovers deals on Google Shopping via SERP API
- Fetches any page via Web Unlocker (screenshots + markdown)
- **Smart comparison engine** with spec extraction, benchmark scores, and
  category-specific ranking (phones: RAM/storage/battery/camera, headphones:
  ANC/battery/sound, earbuds: battery/ANC/driver)
- **Query understanding** — detects intent (specific product vs category+price
  range) and builds optimal search queries
- Scores and ranks results using price, discount, rating, and query relevance
- Tracks price history over time with Deno KV
- Self-heals broken scrapers when target sites change their layout
- Per-platform coverage stats and field fill rates in JSON output

## Install

Requires [Deno](https://deno.land) v2.9+ (tested on v2.9.5):

```bash
# macOS / Linux
curl -fsSL https://deno.land/install.sh | sh

# Or via Homebrew
brew install deno
```

Clone and enter the project:

```bash
git clone https://github.com/ancxanas/tech-scraper.git
cd tech-scraper
```

Set your Bright Data API key (required):

```bash
export BRIGHTDATA_API_KEY=your_key
```

Or copy the example and edit:

```bash
cp .env.example .env
```

### Required zones

```bash
# Required for SERP API (Google Shopping discovery)
export SERP_ZONE=serp_api1

# Required for Web Unlocker (screenshots + markdown)
export UNLOCKER_ZONE=cli_unlocker
```

Create zones at
[brightdata.com/cp/web_access/new](https://brightdata.com/cp/web_access/new).

### Collector IDs

The project includes default collector IDs. To use your own:

```bash
export FLIPKART_COLLECTOR_ID=c_your_collector_id
export RELIANCE_COLLECTOR_ID=c_your_collector_id
export TATACLIQ_COLLECTOR_ID=c_your_collector_id
export AMAZON_COLLECTOR_ID=c_your_collector_id
```

To recreate the custom collectors, see [Collector Setup](#collector-setup).

## Usage

```bash
# Search across all platforms
deno task dev search "wireless headphones"

# Search specific platforms
deno task dev search "laptop" -p amazon,flipkart

# Search with options
deno task dev search "iphone 15" --pages 5 --enrich 10 --no-save

# JSON output for piping
deno task dev search "laptop" --json

# Find the best deal
deno task dev best-deal "iphone 15"

# Compare prices across platforms
deno task dev compare "headphones" -p amazon,flipkart,reliance,tatacliq

# Smart comparison with specs and benchmarks
deno task dev compare "best mobile phones under 15000"
deno task dev compare "best sony headphones under 5000"

# View price history
deno task dev history "wireless headphones"

# Discover deals on Google Shopping (SERP API)
deno task dev discover "laptop deals under 50000"

# Check all collectors are healthy
deno task dev doctor

# Self-heal a broken scraper
deno task dev heal <collector_id> "Fix the broken selectors"

# Take a screenshot (Web Unlocker)
deno task dev screenshot "https://example.com/deal"

# Fetch any page as Markdown (Web Unlocker)
deno task dev fetch "https://example.com/product"
```

### CLI flags

| Flag               | Description                               |
| ------------------ | ----------------------------------------- |
| `--pages <n>`      | Pages per platform (default: 3)           |
| `--enrich <n>`     | PDP enrich top N products (default: 20)   |
| `--max <n>`        | Hard cap on total products (default: 500) |
| `--no-heal`        | Skip auto-heal on empty results           |
| `--dedup-cheapest` | Keep only cheapest across platforms       |
| `--in-stock-only`  | Filter out-of-stock products              |
| `--no-save`        | Skip saving price history                 |
| `--json`           | Raw JSON output                           |

## Platforms

| Platform         | Method              | Pagination   | Scraper Type         |
| ---------------- | ------------------- | ------------ | -------------------- |
| Flipkart         | Scraper Studio      | page-based   | Custom collector     |
| Reliance Digital | Scraper Studio      | scroll-based | Custom collector     |
| Tata CLiQ        | Scraper Studio      | scroll-based | Custom collector     |
| Amazon India     | Pre-built or Custom | page-based   | Dataset or collector |
| Google Shopping  | SERP API            | N/A          | Deal discovery       |

### URL templates

| Platform         | Template                                                       |
| ---------------- | -------------------------------------------------------------- |
| Flipkart         | `https://www.flipkart.com/search?q={q}&page={page}`            |
| Reliance Digital | `https://www.reliancedigital.in/products?q={q}`                |
| Tata CLiQ        | `https://www.tatacliq.com/search/?searchCategory=all&text={q}` |
| Amazon India     | `https://www.amazon.in/s?k={q}&page={page}`                    |

## Architecture

```
main.ts                       Entry point, loads .env
src/
  cli.ts                      CLI commands (10 subcommands)
  config.ts                   Platform configs, URL templates, scoring weights
  scraper.ts                  Scraping orchestrator (parallel, auto-heal, coverage)
  score.ts                    Scoring, ranking, deduplication, relevance filtering
  types.ts                    Product, SearchResult, ProductVariant interfaces
  kv.ts                       Price history with Deno KV
  lib/
    brightdata.ts             Direct REST API client (fetch-based, handles NDJSON)
    serp.ts                   SERP API client (Google Shopping discovery)
    prescrapers.ts            Pre-built scrapers (Amazon India dataset)
    unlock.ts                 Web Unlocker client (screenshots + markdown)
    query-parser.ts           Query intent detection (specific/category/generic)
    specs.ts                  Spec extraction, benchmarks, comparison scoring
    compare.ts                Comparison engine (category-specific ranking)
  tools/
    scraper.ts                Scraper Studio batch runner (trigger + poll + parse)
    healer.ts                 Self-healing API wrapper (trigger + poll + approve)
tests/
  cli_test.ts                 URL template and validation tests
  score_test.ts               Scoring, dedup, and relevance tests
  scraper_test.ts             Parser and field extraction tests
  query_parser_test.ts        Query intent detection tests
  specs_test.ts               Spec extraction and benchmark tests
```

### Data flow

```
User query
  → parseQuery() detects intent (specific/category/generic)
  → buildSearchQueries() generates search URLs
  → scrapeProducts() runs platforms in parallel
    → Scraper Studio: runCollector() → pollUntil() → parseCustomProducts()
    → Pre-built: searchAmazonPreBuilt() (Amazon only)
    → On empty results: auto-heal → re-run same collector
  → savePrices() stores in Deno KV BEFORE dedup
  → deduplicate() by product ID (keeps cross-platform rows + variations)
  → compareProducts() applies category-specific scoring:
      - Phone: RAM, storage, battery, camera, processor, 5G
      - Headphone: ANC, battery life, driver, weight, type
      - Earbuds: ANC, battery, driver, weight
      - Benchmark database for known models
  → Recommendation + ranked comparison table
```

## How Bright Data is used

### Scraper Studio (custom collectors)

Custom collectors are created via the DCA REST API targeting specific product
listing pages. Products are scraped in batch mode via `/dca/trigger` endpoint.
Used for Flipkart, Reliance Digital, and Tata CLiQ.

### Pre-built scrapers (Amazon)

Uses Bright Data's pre-built Amazon India scraper (`gd_lwdb4vjm1ehb499uxs`) via
`/datasets/v3/trigger`. Returns product data: name, price, MRP, discount,
rating, reviews, brand, images.

### SERP API (deal discovery)

Searches Google Shopping for deals using `POST /request` with `udm=28`. Returns
structured shopping results with prices, ratings, and merchant info.

### Web Unlocker (screenshots + markdown)

Used for taking screenshots of deal pages and fetching pages as markdown.
Optional fifth source behind `--discover` flag.

### Self-healing

The `refactor_template` API analyzes broken selectors and proposes code fixes
using AI. Full flow: trigger → poll → preview → approve → verify. Auto-heal runs
when a platform returns empty results or field fill rate < 50%.

## Scoring & Comparison

### Basic scoring (`search` / `best-deal`)

Products are scored using a weighted formula with a relevance gate:

- **Price** (45%): Lower is better, normalized against the result set
- **Discount** (25%): Higher discount percentage scores higher
- **Rating** (20%): Products with 4+ stars get a boost
- **Availability** (10%): In-stock products get a bonus
- **Relevance gate**: Products must match search query tokens in their name

### Smart comparison (`compare`)

The comparison engine uses query intent detection + category-specific scoring:

- **Query parsing**: Detects intent (specific product, category+price range, or
  generic search). Extracts brand, model, max price, and product category.
- **Spec extraction**: Parses RAM, storage, battery, camera from product names
  using regex patterns.
- **Benchmark database**: Local database of benchmark scores for ~30 popular
  Indian market products (phones: AnTuTu/Geekbench, headphones: ANC/battery).
- **Category-specific scoring**:
  - Phones: processor, RAM, storage, battery, camera, display, 5G
  - Headphones: ANC type, battery life, driver size, weight, form factor
  - Earbuds: ANC, battery, driver, weight
- **Brand matching**: +30 points for matching query brand, -20 for mismatch. -30
  for third-party accessories ("for Sony" products).

Deduplication by product ID preserves cross-platform rows by default. Use
`--dedup-cheapest` to keep only the cheapest across platforms.

## Tech stack

- [Deno](https://deno.land) v2 — runtime
- [Cliffy](https://cliffy.io) — CLI framework (commands, tables, prompts)
- [Deno KV](https://deno.land/kv) — embedded key-value store for price history
- [Bright Data](https://www.brightdata.com) — web scraping infrastructure

## Collector Setup

The project uses custom Scraper Studio collectors:

| Platform         | Collector ID                       | Target URL pattern                  |
| ---------------- | ---------------------------------- | ----------------------------------- |
| Flipkart         | `c_mt1bpy5nvn2i7o1r7`              | `flipkart.com/search?q=...`         |
| Reliance Digital | `c_msxt4lsv12k5p1328b`             | `reliancedigital.in/products?q=...` |
| Tata CLiQ        | `c_mt0oxjk82pao8tyc4u`             | `tatacliq.com/search/?text=...`     |
| Amazon India     | Prebuilt (`gd_lwdb4vjm1ehb499uxs`) | `amazon.in/s?k=...`                 |

### Recreating collectors

Since we use Deno (not Node/npx), collectors must be created via the REST API or
the Bright Data dashboard. The `npx -p @brightdata/cli bdata` commands below
require Node.js — run them manually if you need to recreate collectors.

**Flipkart (Search type):**

```bash
# Create collector
curl -X POST "https://api.brightdata.com/dca/collector" \
  -H "Authorization: Bearer $BRIGHTDATA_API_KEY" \
  -d '{"name": "Flipkart Scraper", "url": "https://www.flipkart.com/search?q=iphone"}'

# The AI template is generated via refactor_template after creation.
# Use: deno task dev heal <collector_id> "Fix selectors for product cards"
```

**Reliance Digital (scroll-based):**

```bash
# Seed URL uses /products?q= (NOT /search?q= which returns 404)
curl -X POST "https://api.brightdata.com/dca/collector" \
  -H "Authorization: Bearer $BRIGHTDATA_API_KEY" \
  -d '{"name": "Reliance Scraper", "url": "https://www.reliancedigital.in/products?q=iphone"}'
```

**Tata CLiQ (scroll-based):**

```bash
# Uses searchCategory=all&text= param format
curl -X POST "https://api.brightdata.com/dca/collector" \
  -H "Authorization: Bearer $BRIGHTDATA_API_KEY" \
  -d '{"name": "Tata CLiQ Scraper", "url": "https://www.tatacliq.com/search/?searchCategory=all&text=iphone"}'
```

After creation, set the collector IDs in `.env`:

```bash
FLIPKART_COLLECTOR_ID=c_your_new_id
RELIANCE_COLLECTOR_ID=c_your_new_id
TATACLIQ_COLLECTOR_ID=c_your_new_id
```

Verify with: `deno task dev doctor`

## How to reproduce

```bash
# Clone
git clone https://github.com/ancxanas/tech-scraper.git
cd tech-scraper

# Set API key
export BRIGHTDATA_API_KEY=your_key
export SERP_ZONE=serp_api1
export UNLOCKER_ZONE=cli_unlocker

# Search
deno task dev search "sony wh-1000xm5" --pages 3 --json

# Expected JSON shape:
# {
#   "query": "sony wh-1000xm5",
#   "count": 40,
#   "products": [...],
#   "platforms": [
#     {
#       "name": "Flipkart",
#       "status": "ok",
#       "count": 40,
#       "rawCount": 40,
#       "parsedCount": 40,
#       "fieldFillRate": 91,
#       "heal": { "attempted": false, "success": false }
#     },
#     ...
#   ]
# }
```

## AI tools disclosure

This project was built with assistance from AI coding tools. The self-healing
feature uses Bright Data's AI-powered `refactor_template` API to analyze and fix
broken scraper selectors.

## License

MIT
