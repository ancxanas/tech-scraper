#!/bin/bash
# Tech-Scraper Hackathon Demo Script
# ScrapeVerse Kick Off — ScrapeVerse Hackathon (WeMakeDevs + Bright Data)
# Run: chmod +x demo.sh && ./demo.sh

set -e
cd "$(dirname "$0")"

echo ""
echo "========================================="
echo "  Tech-Scraper: Smart Deal Finder"
echo "  ScrapeVerse Hackathon Demo"
echo "========================================="
echo ""

# Demo 1: Specific product search
echo "Demo 1: Find best price for Sony WH-1000XM5"
echo "---"
deno run -A main.ts search "sony wh-1000xm5" --pages 1 --no-save --no-heal
echo ""

echo "Press Enter for next demo..."
read -r

# Demo 2: Category comparison with specs
echo "Demo 2: Best mobile phones under 15000"
echo "---"
deno run -A main.ts compare "best mobile phones under 15000" --pages 1 --no-save --no-heal
echo ""

echo "Press Enter for next demo..."
read -r

# Demo 3: Headphone comparison
echo "Demo 3: Best sony headphones under 5000"
echo "---"
deno run -A main.ts compare "best sony headphones under 5000" --pages 1 --no-save --no-heal
echo ""

echo "Press Enter for self-healing demo..."
read -r

# Demo 4: Self-healing (requires manual approval)
echo "Demo 4: Self-healing scraper"
echo "---"
echo "Running heal on Flipkart collector..."
deno run -A main.ts heal c_mt1bpy5nvn2i7o1r7 \
  "The scraper returns empty results. Fix selectors to capture product name, price, original price, discount, rating, reviews, brand, image URL, and product URL from the Flipkart search results page." \
  --verify-url "https://www.flipkart.com/search?q=sony+wh-1000xm5"
echo ""

echo "========================================="
echo "  Demo complete!"
echo "========================================="
