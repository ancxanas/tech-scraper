# tech-scraper

CLI tool that finds the best tech deals across Indian e-commerce platforms.
Built for the ScrapeVerse Hackathon.

## What it does

- Searches Reliance Digital for products
- Scores and ranks results (40% price, 30% discount, 20% rating, 10% reviews)
- Tracks price history over time with Deno KV
- Self-heals broken scrapers using Bright Data AI

## Install

```bash
git clone <repo-url> tech-scraper
cd tech-scraper
```

Set your Bright Data API key:

```bash
export BRIGHTDATA_API_KEY=your_key
```

Or use the `.env` file:

```bash
cp .env.example .env
# Edit .env with your key
```

## Usage

```bash
# Search for products
deno task dev search "wireless headphones"

# Find the best deal
deno task dev best-deal "iphone 15"

# Compare across platforms
deno task dev compare "sony headphones" -p reliance

# View price history
deno task dev history
deno task dev history "wireless headphones"

# Check scraper status
deno task dev status

# Self-heal a broken scraper
deno task dev heal <collector_id> "Fix the price selector"
```

## Architecture

```
main.ts                    Entry point, loads .env
src/
  cli.ts                   CLI commands (search, best-deal, compare, heal, history, status)
  config.ts                Platform configs, scoring weights
  scraper.ts               Scraping orchestrator
  score.ts                 Scoring, ranking, deduplication
  types.ts                 Product and SearchResult interfaces
  kv.ts                    Price history with Deno KV
  lib/
    brightdata.ts          Direct REST API client (fetch-based)
  tools/
    scraper.ts             Scraper Studio batch runner
    healer.ts              Self-healing API wrapper
```

## Self-healing demo

Bright Data Scraper Studio uses AI to fix broken scrapers:

1. A scraper works fine on a site
2. Site redesigns its layout
3. Scraper returns empty or broken data
4. Run `tech-scraper heal <collector_id> "Fix the broken selectors"`
5. AI analyzes the scraper template and proposes a fix
6. Fix is approved and the scraper resumes working

The heal flow uses three Bright Data API endpoints:

- `POST /dca/collectors/{id}/refactor_template` — trigger heal
- `GET /dca/collectors/{id}/refactor_template/progress` — poll progress
- `POST /dca/collectors/{id}/resume_automation_job` — approve or reject

## Tech stack

- Deno v2
- Cliffy (CLI framework)
- Valibot (validation)
- Deno KV (price history)
- Bright Data Scraper Studio (scraping)
- Direct REST API (no CLI dependency)

## License

MIT
