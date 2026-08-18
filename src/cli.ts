import { Command } from "@cliffy/command";
import { Table } from "@cliffy/table";
import {
  ALL_PLATFORMS,
  PAGES_TO_SCRAPE,
  type Platform,
  PLATFORMS,
} from "./config.ts";
import { deduplicate, scoreAndRank } from "./score.ts";
import { scrapeProducts } from "./scraper.ts";
import { runHealFlow } from "./tools/healer.ts";
import { getPriceHistory, getTrackedProducts, savePrices } from "./kv.ts";

function parsePlatforms(input: string | undefined): Platform[] {
  if (!input) return [...ALL_PLATFORMS];
  const parts = input.split(",").map((p) => p.trim().toLowerCase());
  const valid: Platform[] = [];
  for (const part of parts) {
    if (part in PLATFORMS) {
      valid.push(part as Platform);
    } else {
      console.error(`Unknown platform: ${part}`);
      console.error(`Available: ${ALL_PLATFORMS.join(", ")}`);
      Deno.exit(1);
    }
  }
  return valid;
}

function formatPrice(val: number): string {
  return `₹${val.toLocaleString("en-IN")}`;
}

function printTable(products: ReturnType<typeof scoreAndRank>, limit = 20) {
  const rows = products.slice(0, limit);
  if (rows.length === 0) {
    console.log("\nNo products found.\n");
    return;
  }

  const table = new Table()
    .header(["#", "Product", "Price", "Was", "Off", "Score", "Platform"])
    .border(true);

  rows.forEach((p, i) => {
    table.push([
      String(i + 1),
      p.name.length > 50 ? p.name.slice(0, 47) + "..." : p.name,
      formatPrice(p.price),
      p.originalPrice > p.price ? formatPrice(p.originalPrice) : "-",
      p.discount > 0 ? `${p.discount}%` : "-",
      p.score.toFixed(2),
      p.platform,
    ]);
  });

  console.log("");
  table.render();
  console.log("");
}

export const cli = new Command()
  .name("tech-scraper")
  .version("0.1.0")
  .description("Find the best tech deals across Indian e-commerce platforms")
  .command(
    "search",
    new Command()
      .description("Search for a product across platforms")
      .arguments("<query:string>")
      .option(
        "-p, --platforms <platforms:string>",
        "Comma-separated platforms to search",
      )
      .option("-n, --limit <n:number>", "Max results to show", { default: 20 })
      .option("--pages <pages:number>", "Pages to scrape per platform", {
        default: PAGES_TO_SCRAPE,
      })
      .option("--no-dedup", "Skip deduplication")
      .action(async (options, query) => {
        const platforms = parsePlatforms(options.platforms);
        console.log(`\nSearching for "${query}"...\n`);

        const results = await scrapeProducts(query, platforms, options.pages);
        let allProducts = results.flatMap((r) => r.products);

        if (options.dedup !== false) {
          allProducts = deduplicate(allProducts);
        }

        const ranked = scoreAndRank(allProducts);
        printTable(ranked, options.limit);

        if (allProducts.length > 0) {
          await savePrices(allProducts, query);
          console.log(
            `  Price history saved (${allProducts.length} products)\n`,
          );
        }
      }),
  )
  .command(
    "best-deal",
    new Command()
      .description("Show the single best deal for a product")
      .arguments("<query:string>")
      .option(
        "-p, --platforms <platforms:string>",
        "Comma-separated platforms to check",
      )
      .option("--pages <pages:number>", "Pages to scrape per platform", {
        default: PAGES_TO_SCRAPE,
      })
      .action(async (options, query) => {
        const platforms = parsePlatforms(options.platforms);
        console.log(`\nFinding best deal for "${query}"...\n`);

        const results = await scrapeProducts(query, platforms, options.pages);
        let allProducts = results.flatMap((r) => r.products);
        allProducts = deduplicate(allProducts);
        const ranked = scoreAndRank(allProducts);

        if (ranked.length === 0) {
          console.log("No products found.\n");
          return;
        }

        const best = ranked[0];
        console.log("BEST DEAL:");
        console.log(`  Product:  ${best.name}`);
        console.log(`  Price:    ${formatPrice(best.price)}`);
        if (best.originalPrice > best.price) {
          console.log(`  Was:      ${formatPrice(best.originalPrice)}`);
          console.log(
            `  Savings:  ${
              formatPrice(best.originalPrice - best.price)
            } (${best.discount}% off)`,
          );
        }
        console.log(`  Platform: ${best.platform}`);
        console.log(`  Score:    ${best.score.toFixed(2)}`);
        if (best.productUrl) {
          console.log(`  URL:      ${best.productUrl}`);
        }
        console.log();

        if (allProducts.length > 0) {
          await savePrices(allProducts, query);
        }
      }),
  )
  .command(
    "compare",
    new Command()
      .description("Compare prices from specific platforms")
      .arguments("<query:string>")
      .option(
        "-p, --platforms <platforms:string>",
        "Comma-separated platforms to compare",
      )
      .option("--pages <pages:number>", "Pages to scrape per platform", {
        default: PAGES_TO_SCRAPE,
      })
      .action(async (options, query) => {
        const platforms = parsePlatforms(options.platforms);
        if (platforms.length < 2) {
          console.error("Compare needs at least 2 platforms.");
          Deno.exit(1);
        }

        console.log(
          `\nComparing "${query}" across ${platforms.length} platforms...\n`,
        );

        const results = await scrapeProducts(query, platforms, options.pages);

        for (const result of results) {
          console.log(`${result.platform}: ${result.products.length} products`);
          if (result.products.length > 0) {
            const prices = result.products.map((p) => p.price);
            console.log(
              `  Price range: ${formatPrice(Math.min(...prices))} - ${
                formatPrice(Math.max(...prices))
              }`,
            );
          }
        }

        let allProducts = results.flatMap((r) => r.products);
        allProducts = deduplicate(allProducts);
        const ranked = scoreAndRank(allProducts);
        printTable(ranked, 15);

        if (allProducts.length > 0) {
          await savePrices(allProducts, query);
        }
      }),
  )
  .command(
    "heal",
    new Command()
      .description("Self-heal a broken scraper using AI")
      .arguments("<collector_id:string> <prompt:string>")
      .option("--auto-approve", "Approve the fix automatically", {
        default: true,
      })
      .action(async (options, collectorId, prompt) => {
        console.log(`\nHealing scraper ${collectorId}...\n`);
        console.log(`  Prompt: "${prompt}"\n`);

        const result = await runHealFlow(
          collectorId,
          prompt,
          options.autoApprove,
        );

        if (result.success) {
          console.log("\n  Scraper healed successfully!\n");
        } else {
          console.error("\n  Heal failed.\n");
        }
      }),
  )
  .command(
    "history",
    new Command()
      .description("Show price history for tracked products")
      .arguments("[query:string]")
      .option("-n, --limit <n:number>", "Max products to show", {
        default: 10,
      })
      .action(async (options, query) => {
        if (query) {
          const history = await getPriceHistory(query);
          if (history.length === 0) {
            console.log(`\nNo price history for "${query}".\n`);
            return;
          }

          console.log(`\nPrice history for "${query}":\n`);
          const table = new Table()
            .header(["Date", "Price", "Platform"])
            .border(true);

          for (const record of history) {
            const date = new Date(record.timestamp);
            table.push([
              date.toLocaleDateString("en-IN"),
              formatPrice(record.price),
              record.platform,
            ]);
          }

          table.render();

          if (history.length >= 2) {
            const first = history[0].price;
            const last = history[history.length - 1].price;
            const change = last - first;
            const pct = ((change / first) * 100).toFixed(1);
            console.log(
              `\n  Trend: ${change >= 0 ? "+" : ""}${formatPrice(change)} (${
                change >= 0 ? "+" : ""
              }${pct}%)\n`,
            );
          }
        } else {
          const products = await getTrackedProducts();
          if (products.length === 0) {
            console.log("\nNo tracked products yet. Run a search first.\n");
            return;
          }

          console.log(`\nTracked products (${products.length}):\n`);
          for (const name of products.slice(0, options.limit)) {
            const history = await getPriceHistory(name);
            const prices = history.map((r) => r.price);
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const latest = prices[prices.length - 1];
            console.log(
              `  ${name.slice(0, 50)}${name.length > 50 ? "..." : ""}`,
            );
            console.log(
              `    Latest: ${formatPrice(latest)} | Range: ${
                formatPrice(
                  min,
                )
              } - ${formatPrice(max)} | Records: ${history.length}\n`,
            );
          }
        }
      }),
  )
  .command(
    "status",
    new Command()
      .description("Show configured scrapers and their status")
      .action(() => {
        console.log("\nConfigured Scrapers:\n");
        for (const [key, config] of Object.entries(PLATFORMS)) {
          const status = config.enabled ? "active" : "disabled";
          console.log(`  + ${config.name} (${key}) [${status}]`);
          console.log(`    Tool: Scraper Studio (${config.collectorId})`);
          console.log(`    URL: ${config.url}`);
          console.log(`    Products/page: ~${config.productsPerPage}`);
          console.log();
        }
        console.log(`  Pages per search: ${PAGES_TO_SCRAPE}`);
        console.log();
      }),
  );
