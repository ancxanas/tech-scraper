# tech-scraper

> A deal-finding CLI for Indian tech shoppers that self-heals when sites
> redesign.

Built for the
[ScrapeVerse Hackathon](https://www.wemakedevs.org/hackathons/scrape-verse)
using Bright Data Scraper Studio.

## What it does

- Searches across 4 Indian e-commerce platforms: Amazon, Flipkart, Reliance
  Digital, Tata CLiQ
- Discovers deals on Google Shopping via SERP API
- Fetches any page via Web Unlocker (fallback + screenshots)
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
# Search across all platforms
deno task dev search "wireless headphones"

# Search specific platforms
deno task dev search "laptop" -p amazon,flipkart

# Discover deals on Google Shopping (SERP API)
deno task dev discover "laptop deals under 50000"

# Find the best deal
deno task dev best-deal "iphone 15"

# Compare prices across platforms
deno task dev compare "headphones" -p amazon,flipkart,reliance,tatacliq

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

## Platforms

| Platform         | Method                                  | Status |
| ---------------- | --------------------------------------- | ------ |
| Amazon India     | Pre-built scraper (Bright Data dataset) | Active |
| Flipkart         | SERP API (Google Shopping filtered)     | Active |
| Reliance Digital | Scraper Studio (custom collector)       | Active |
| Tata CLiQ        | Scraper Studio (custom collector)       | Active |
| Google Shopping  | SERP API (deal discovery)               | Active |

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
    brightdata.ts             Direct REST API client (fetch-based, handles NDJSON)
    serp.ts                   SERP API client (Google Shopping discovery)
    prescrapers.ts            Pre-built scrapers (Amazon, Flipkart via SERP)
    unlock.ts                 Web Unlocker client (fallback + screenshots)
  tools/
    scraper.ts                Scraper Studio batch runner (trigger + poll)
    healer.ts                 Self-healing API wrapper (trigger + poll + approve)
```

### Data flow

```
User query
  → scrapeProducts() checks tool type per platform
    → Scraper Studio: runCollector() → pollUntil() → parseCustomProducts()
    → Pre-built: searchAmazonPreBuilt() or searchFlipkartViaSerp()
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
endpoint. Used for Reliance Digital and Tata CLiQ.

### Pre-built scrapers (Amazon)

Uses Bright Data's pre-built Amazon India scraper (`gd_lwdb4vjm1ehb499uxs`) via
`/datasets/v3/trigger`. Returns full product data: name, price, MRP, discount,
rating, reviews, sales rank, brand, images.

### SERP API (Flipkart + deal discovery)

Searches Google Shopping for deals using `POST /request` with `udm=28`. Returns
structured shopping results with prices, ratings, and merchant info. Flipkart
results are filtered by shop name.

### Web Unlocker (fallback + screenshots)

When Scraper Studio fails or hangs, falls back to Web Unlocker for 98% success
rate page fetching. Also supports screenshots for demo purposes.

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
  - Scraper Studio (custom collectors for Reliance, Tata CLiQ)
  - Pre-built scrapers (Amazon India dataset)
  - SERP API (Google Shopping + Flipkart discovery)
  - Web Unlocker (fallback + screenshots)

## AI tools disclosure

This project was built with assistance from AI coding tools. The self-healing
feature uses Bright Data's AI-powered `refactor_template` API to analyze and fix
broken scraper selectors.

## License

MIT
