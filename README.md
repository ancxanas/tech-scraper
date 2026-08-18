# tech-scraper

> A deal-finding CLI for Indian tech shoppers that self-heals when sites
> redesign.

Built for the
[ScrapeVerse Hackathon](https://www.wemakedevs.org/hackathons/scrape-verse)
using Bright Data Scraper Studio.

## What it does

- Searches Reliance Digital for products via custom Bright Data scrapers
- Discovers deals on Google Shopping via SERP API
- Fetches any page via Web Unlocker (fallback + screenshots)
- Uses pre-built Amazon/Google Shopping scrapers
- Scores and ranks results using price, discount, rating, and query relevance
- Tracks price history over time with Deno KV
- Self-heals broken scrapers when target sites change their layout

## Install

```bash
git clone https://github.com/ancxanas/tech-scraper.git
cd tech-scraper
```

Set your Bright Data API key:

```bash
export BRIGHTDATA_API_KEY=your_key
```

Or copy the example and edit:

```bash
cp .env.example .env
```

### Optional: custom zones

```bash
export SERP_ZONE=serp_api1
export UNLOCKER_ZONE=cli_unlocker
```

Create zones at
[brightdata.com/cp/web_access/new](https://brightdata.com/cp/web_access/new).

## Usage

```bash
# Search for products (Scraper Studio)
deno task dev search "wireless headphones"

# Discover deals on Google Shopping (SERP API)
deno task dev discover "laptop deals under 50000"

# Find the best deal
deno task dev best-deal "iphone 15"

# View price history
deno task dev history
deno task dev history "wireless headphones"

# Take a screenshot of a deal page (Web Unlocker)
deno task dev screenshot "https://www.reliancedigital.in/..."

# Fetch any page as Markdown (Web Unlocker)
deno task dev fetch "https://www.reliancedigital.in/..."

# List available pre-built scrapers
deno task dev scrapers

# Check scraper status
deno task dev status

# Self-heal a broken scraper
deno task dev heal <collector_id> "Fix the broken selectors"

# JSON output for piping
deno task dev search "laptop" --json
```

## Example output

```
$ deno task dev best-deal "wireless headphones"

Finding best deal for "wireless headphones"...

  Scraping Reliance Digital (3 pages)...
  Found 15 products

  BEST DEAL
  Product:  Sony WH-1000XM5 Wireless Noise Cancelling Headphones
  Price:    ₹19,990
  Was:      ₹29,990
  Savings:  ₹10,000 (33% off)
  Platform: Reliance Digital
  Score:    0.89
  Why:      lowest price + 33% off + 4.5★
  URL:      https://www.reliancedigital.in/sony-wh-1000xm5...

  Price history saved (15 products)
```

```
$ deno task dev discover "wireless headphones deals"

Discovering deals for "wireless headphones deals" via Google Shopping...

+---+-----------------------------------------+----------+--------------+--------+
| # | Product                                 | Price    | Shop         | Rating |
+---+-----------------------------------------+----------+--------------+--------+
| 1 | Sony WH-1000XM5 Wireless...             | ₹19,990  | Reliance     | 4.5    |
| 2 | JBL Tour One M2 Wireless...             | ₹27,999  | Amazon       | 4.3    |
| 3 | Apple AirPods Max                       | ₹59,900  | Croma        | 4.6    |
+---+-----------------------------------------+----------+--------------+--------+
```

## Architecture

```
main.ts                       Entry point, loads .env
src/
  cli.ts                      CLI commands
  config.ts                   Platform configs, scoring weights, collector IDs
  scraper.ts                  Scraping orchestrator with retry + Web Unlocker fallback
  score.ts                    Scoring, ranking, deduplication, relevance filtering
  types.ts                    Product and SearchResult interfaces
  kv.ts                       Price history with Deno KV
  lib/
    brightdata.ts             Direct REST API client (fetch-based)
    serp.ts                   SERP API client (Google Shopping discovery)
    prescrapers.ts            Pre-built scrapers (Amazon, Google Shopping)
    unlock.ts                 Web Unlocker client (fallback + screenshots)
  tools/
    scraper.ts                Scraper Studio batch runner (trigger + poll)
    healer.ts                 Self-healing API wrapper (trigger + poll + approve)
```

### Data flow

```
User query
  → scrapeProducts() builds page URLs
    → runCollector() triggers Bright Data batch
    → pollUntil() waits for results
    → parseCustomProducts() extracts Product objects
    → If Scraper Studio fails → Web Unlocker fallback
  → deduplicate() merges cross-platform matches
  → scoreAndRank() applies weighted scoring + relevance gate
  → savePrices() stores in Deno KV for history
  → Display results (formatted table or JSON)
```

## How Bright Data is used

### Scraper Studio (custom collectors)

Custom collectors are created via `bdata scraper create` targeting specific
product listing pages. Products are scraped in batch mode via `/dca/trigger`
endpoint.

### SERP API (deal discovery)

Searches Google Shopping for deals using `POST /request` with `udm=28`. Returns
structured shopping results with prices, ratings, and merchant info.

### Web Unlocker (fallback + screenshots)

When Scraper Studio fails or hangs, falls back to Web Unlocker for 98% success
rate page fetching. Also supports screenshots for demo purposes.

### Pre-built scrapers (instant multi-platform)

Uses Bright Data's pre-built Amazon and Google Shopping scrapers via
`/datasets/v3/scrape`. No custom collector needed.

### Self-healing

The `refactor_template` API analyzes broken selectors and proposes code fixes
using AI. Full flow: trigger → poll → preview → approve → verify.

## Scoring

Products are scored using a weighted formula with a relevance gate:

- **Price** (45%): Lower is better, normalized against the result set
- **Discount** (25%): Higher discount percentage scores higher
- **Rating** (20%): Products with 4+ stars get a boost
- **Availability** (10%): In-stock products get a bonus
- **Relevance gate**: Products must match search query tokens in their name

## Tech stack

- [Deno](https://deno.land) v2 — runtime
- [Cliffy](https://cliffy.io) — CLI framework (commands, tables, prompts,
  colors)
- [Deno KV](https://deno.land/kv) — embedded key-value store for price history
- [Bright Data](https://www.brightdata.com) — web scraping infrastructure
  - Scraper Studio (custom collectors)
  - SERP API (Google Shopping discovery)
  - Web Unlocker (fallback + screenshots)
  - Pre-built scrapers (Amazon, Google Shopping)

## AI tools disclosure

This project was built with assistance from AI coding tools. The self-healing
feature uses Bright Data's AI-powered `refactor_template` API to analyze and fix
broken scraper selectors.

## License

MIT
