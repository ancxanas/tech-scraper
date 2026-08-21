import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";
import {
  ALL_ENABLED,
  ALL_PLATFORMS,
  MAX_ENRICH,
  MAX_PRODUCTS_HARD_CAP,
  PAGES_TO_SCRAPE,
  type Platform,
  PLATFORMS,
} from "./config.ts";
import { deduplicate, scoreAndRank, type ScoredProduct } from "./score.ts";
import { type ScrapeOptions, scrapeProducts } from "./scraper.ts";
import { runHealFlow, verifyHeal } from "./tools/healer.ts";
import {
  getHistoryByQuery,
  getPriceHistory,
  getTrackedProducts,
  savePrices,
} from "./kv.ts";
import { searchGoogleShopping } from "./lib/serp.ts";
import { getAvailablePreScrapers } from "./lib/prescrapers.ts";
import { fetchPageMarkdown, takeScreenshot } from "./lib/unlock.ts";
import { checkCollector } from "./lib/brightdata.ts";
import { compareProducts, type ComparisonResult } from "./lib/compare.ts";
import { generateDealReport } from "./lib/intelligence.ts";
import { describeIntent, parseIntent } from "./lib/llm-intent.ts";
import type { ParsedIntent, SearchResult } from "./types.ts";

function parsePlatforms(input: string | undefined): Platform[] {
  if (!input) return [...ALL_ENABLED];
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
  return `\u20b9${val.toLocaleString("en-IN")}`;
}

function validateUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    Deno.exit(1);
  }
}

function printTable(products: ScoredProduct[], limit = 20) {
  const rows = products.slice(0, limit);
  if (rows.length === 0) {
    console.log(colors.dim("\nNo products found.\n"));
    return;
  }

  const table = new Table()
    .header(["#", "Product", "Price", "Was", "Off", "Score", "Platform"])
    .border(true);

  rows.forEach((p, i) => {
    table.push([
      String(i + 1),
      p.name.length > 45 ? p.name.slice(0, 42) + "..." : p.name,
      colors.green(formatPrice(p.price)),
      p.originalPrice > p.price
        ? colors.dim(formatPrice(p.originalPrice))
        : colors.dim("-"),
      p.discount > 0 ? colors.yellow(`${p.discount}%`) : colors.dim("-"),
      p.score >= 0.7
        ? colors.green.bold(p.score.toFixed(2))
        : p.score >= 0.4
        ? colors.yellow(p.score.toFixed(2))
        : colors.red(p.score.toFixed(2)),
      colors.cyan(p.platform),
    ]);
  });

  console.log("");
  table.render();
  console.log("");
}

function printCoverage(results: SearchResult[]) {
  console.log(colors.bold("  Coverage:"));
  for (const r of results) {
    const statusIcon = r.status === "ok"
      ? colors.green.bold("\u2713")
      : r.status === "empty"
      ? colors.yellow("\u25cb")
      : colors.red.bold("\u2717");
    const healTag = r.healAttempted
      ? r.healSuccess ? colors.green(" (healed)") : colors.red(" (heal failed)")
      : "";
    console.log(
      `    ${statusIcon} ${
        r.platform.padEnd(20)
      } ${r.parsedCount}/${r.rawCount} cards  fields ${
        Math.round(r.coverage.fieldFillRate * 100)
      }%${healTag}`,
    );
  }
  console.log("");
}

function printComparison(comparison: ComparisonResult) {
  if (comparison.comparisons.length === 0) {
    console.log(colors.dim("\nNo products found.\n"));
    return;
  }

  if (comparison.recommendation) {
    const rec = comparison.recommendation;
    console.log(colors.green.bold("\n  RECOMMENDATION"));
    console.log(colors.bold(`  ${rec.product.name}`));
    console.log(
      colors.green.bold(`  Price: ${formatPrice(rec.product.price)}`),
    );
    if (rec.product.originalPrice > rec.product.price) {
      console.log(
        colors.dim(`  Was: ${formatPrice(rec.product.originalPrice)}`),
      );
    }
    console.log(colors.cyan(`  Platform: ${rec.product.platform}`));
    console.log(colors.cyan(`  Score: ${rec.score.toFixed(1)}/100`));
    console.log(colors.green(`  Why: ${rec.reason}`));
    if (rec.pricePerSpec !== "N/A") {
      console.log(colors.dim(`  Value: ${rec.pricePerSpec}`));
    }
    if (Object.keys(rec.specValues).length > 0) {
      console.log(colors.dim("  Specs:"));
      for (const [k, v] of Object.entries(rec.specValues)) {
        console.log(colors.dim(`    ${k}: ${v}`));
      }
    }
    console.log();
  }

  console.log(
    colors.bold(`  All ${comparison.comparisons.length} products:\n`),
  );
  const table = new Table()
    .header(["#", "Product", "Price", "Off", "Score", "Specs", "Platform"])
    .border(true);

  for (const [i, c] of comparison.comparisons.slice(0, 15).entries()) {
    const specSummary = Object.values(c.specValues).slice(0, 3).join(", ");
    table.push([
      String(i + 1),
      c.product.name.length > 40
        ? c.product.name.slice(0, 37) + "..."
        : c.product.name,
      colors.green(formatPrice(c.product.price)),
      c.product.discount > 0 ? colors.yellow(`${c.product.discount}%`) : "-",
      c.score >= 70
        ? colors.green.bold(c.score.toFixed(0))
        : c.score >= 40
        ? colors.yellow(c.score.toFixed(0))
        : colors.red(c.score.toFixed(0)),
      colors.dim(specSummary || "-"),
      colors.cyan(c.product.platform),
    ]);
  }
  console.log("");
  table.render();
  console.log("");
}

function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function isJson(options: { json?: boolean }): boolean {
  return options.json === true;
}

function buildScrapeOptions(options: {
  pages?: number;
  heal?: boolean;
  enrich?: number;
  max?: number;
}): ScrapeOptions {
  return {
    pages: options.pages ?? PAGES_TO_SCRAPE,
    noHeal: options.heal !== true,
    enrichCount: options.enrich ?? MAX_ENRICH,
  };
}

export const cli = new Command()
  .name("tech-scraper")
  .version("0.1.0")
  .description("Find the best tech deals across Indian e-commerce platforms")
  .globalOption("--json", "Output raw JSON instead of formatted tables", {
    default: false,
  })
  .command(
    "search",
    new Command()
      .description("Search for a product across platforms")
      .arguments("<query:string>")
      .option("--json", "Output raw JSON", { default: false })
      .option("-p, --platforms <platforms:string>", "Comma-separated platforms")
      .option("-n, --limit <n:number>", "Max results to show", { default: 20 })
      .option("--pages <pages:number>", "Pages per platform", {
        default: PAGES_TO_SCRAPE,
      })
      .option("--enrich <n:number>", "PDP enrich top N products (0 = off)", {
        default: 0,
      })
      .option("--max <n:number>", "Hard cap on total products", {
        default: MAX_PRODUCTS_HARD_CAP,
      })
      .option("--no-dedup", "Skip deduplication")
      .option("--heal", "Enable auto-heal on empty results (off by default)")
      .option("--dedup-cheapest", "Keep only cheapest cross-platform")
      .option("--in-stock-only", "Filter out-of-stock products")
      .option("--no-save", "Skip saving price history")
      .action(async (options, query) => {
        const json = isJson(options);
        const platforms = parsePlatforms(options.platforms);
        const scrapeOpts = buildScrapeOptions(options);

        let intent: ParsedIntent;
        try {
          intent = await parseIntent(query);
        } catch (err) {
          console.error(
            colors.red(
              `\n  Intent parsing failed: ${
                err instanceof Error ? err.message : err
              }\n`,
            ),
          );
          Deno.exit(1);
        }

        const searchQuery = intent.searchQueries[0] ?? query;

        if (!json) {
          console.log(colors.bold(`\nSearching for "${searchQuery}"...\n`));
          console.log(
            colors.dim(`  Intent: ${describeIntent(intent)}\n`),
          );
        }

        const results = await scrapeProducts(
          searchQuery,
          platforms,
          scrapeOpts,
          intent,
        );

        let allProducts = results.flatMap((r) => r.products);

        if (options.save !== false) {
          try {
            await savePrices(allProducts, query);
          } catch (err) {
            console.error(
              `  Price history save failed: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
        }

        if (options.dedup !== false) {
          allProducts = deduplicate(allProducts);
        }

        allProducts = allProducts.slice(
          0,
          options.max ?? MAX_PRODUCTS_HARD_CAP,
        );

        const ranked = scoreAndRank(allProducts, query, {
          dedupCheapest: options.dedupCheapest,
          inStockOnly: options.inStockOnly,
          category: intent.category,
        });

        if (json) {
          printJson({
            query,
            count: ranked.length,
            products: ranked,
            platforms: results.map((r) => ({
              name: r.platform,
              status: r.status,
              count: r.products.length,
              rawCount: r.rawCount,
              parsedCount: r.parsedCount,
              fieldFillRate: Math.round(r.coverage.fieldFillRate * 100),
              heal: { attempted: r.healAttempted, success: r.healSuccess },
              error: r.error,
            })),
          });
        } else {
          printTable(ranked, options.limit);
          printCoverage(results);
        }

        const failedPlatforms = results.filter((r) => r.status !== "ok");
        if (ranked.length === 0 && failedPlatforms.length === results.length) {
          Deno.exit(1);
        }
      }),
  )
  .command(
    "best-deal",
    new Command()
      .description("Show the single best deal for a product")
      .arguments("<query:string>")
      .option("--json", "Output raw JSON", { default: false })
      .option("-p, --platforms <platforms:string>", "Comma-separated platforms")
      .option("--pages <pages:number>", "Pages per platform", {
        default: PAGES_TO_SCRAPE,
      })
      .option("--heal", "Enable auto-heal on empty results (off by default)")
      .option("--dedup-cheapest", "Keep only cheapest cross-platform")
      .option("--in-stock-only", "Filter out-of-stock products")
      .option("--no-save", "Skip saving price history")
      .action(async (options, query) => {
        const json = isJson(options);
        const platforms = parsePlatforms(options.platforms);
        const scrapeOpts = buildScrapeOptions(options);

        let intent: ParsedIntent;
        try {
          intent = await parseIntent(query);
        } catch (err) {
          console.error(
            colors.red(
              `\n  Intent parsing failed: ${
                err instanceof Error ? err.message : err
              }\n`,
            ),
          );
          Deno.exit(1);
        }

        const searchQuery = intent.searchQueries[0] ?? query;

        if (!json) {
          console.log(
            colors.bold(`\nFinding best deal for "${searchQuery}"...\n`),
          );
          console.log(
            colors.dim(`  Intent: ${describeIntent(intent)}\n`),
          );
        }

        const results = await scrapeProducts(
          searchQuery,
          platforms,
          scrapeOpts,
          intent,
        );
        let allProducts = results.flatMap((r) => r.products);

        if (options.save !== false) {
          try {
            await savePrices(allProducts, query);
          } catch (err) {
            console.error(
              `  Price history save failed: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
        }

        allProducts = deduplicate(allProducts);
        const ranked = scoreAndRank(allProducts, query, {
          dedupCheapest: options.dedupCheapest,
          inStockOnly: options.inStockOnly,
          category: intent.category,
        });

        if (ranked.length === 0) {
          if (json) {
            printJson({ query, best: null });
          } else {
            console.log(colors.dim("No products found.\n"));
          }
          Deno.exit(1);
        }

        const best = ranked[0];

        if (json) {
          printJson({ query, best });
        } else {
          console.log(colors.green.bold("  BEST DEAL"));
          console.log(colors.bold(`  Product:  ${best.name}`));
          console.log(
            colors.green.bold(`  Price:    ${formatPrice(best.price)}`),
          );
          if (best.originalPrice > best.price) {
            console.log(
              colors.dim(`  Was:      ${formatPrice(best.originalPrice)}`),
            );
            console.log(
              colors.yellow(
                `  Savings:  ${
                  formatPrice(best.originalPrice - best.price)
                } (${best.discount}% off)`,
              ),
            );
          }
          console.log(colors.cyan(`  Platform: ${best.platform}`));
          console.log(colors.cyan(`  Score:    ${best.score.toFixed(2)}`));
          console.log(colors.green(`  Why:      ${best.reason}`));
          if (best.productUrl) {
            console.log(colors.dim(`  URL:      ${best.productUrl}`));
          }
          console.log();
          printCoverage(results);
        }
      }),
  )
  .command(
    "compare",
    new Command()
      .description("Smart comparison with specs, benchmarks, and ranking")
      .arguments("<query:string>")
      .option("--json", "Output raw JSON", { default: false })
      .option("-p, --platforms <platforms:string>", "Comma-separated platforms")
      .option("--pages <pages:number>", "Pages per platform", {
        default: PAGES_TO_SCRAPE,
      })
      .option("--heal", "Enable auto-heal on empty results (off by default)")
      .option("--no-save", "Skip saving price history")
      .action(async (options, query) => {
        const json = isJson(options);
        const platforms = parsePlatforms(options.platforms);

        let intent: ParsedIntent;
        try {
          intent = await parseIntent(query);
        } catch (err) {
          console.error(
            colors.red(
              `\n  Intent parsing failed: ${
                err instanceof Error ? err.message : err
              }\n`,
            ),
          );
          Deno.exit(1);
        }

        const searchQuery = intent.searchQueries[0] ?? query;

        if (!json) {
          console.log(
            colors.bold(`\nAnalyzing "${searchQuery}"...\n`),
          );
          console.log(
            colors.dim(`  Intent: ${describeIntent(intent)}\n`),
          );
        }

        const scrapeOpts = buildScrapeOptions(options);
        const results = await scrapeProducts(
          searchQuery,
          platforms,
          scrapeOpts,
          intent,
        );
        let allProducts = results.flatMap((r) => r.products);

        if (options.save !== false) {
          try {
            await savePrices(allProducts, query);
          } catch (err) {
            console.error(
              `  Price history save failed: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
        }

        allProducts = deduplicate(allProducts);

        const comparison = compareProducts(intent, allProducts);

        if (json) {
          printJson({
            query: searchQuery,
            intent: comparison.intent,
            category: comparison.category,
            totalProducts: comparison.totalProducts,
            specFields: comparison.specFields,
            recommendation: comparison.recommendation
              ? {
                name: comparison.recommendation.product.name,
                price: comparison.recommendation.product.price,
                platform: comparison.recommendation.product.platform,
                score: comparison.recommendation.score,
                reason: comparison.recommendation.reason,
                specs: comparison.recommendation.specValues,
                pricePerSpec: comparison.recommendation.pricePerSpec,
              }
              : null,
            comparisons: comparison.comparisons.map((c) => ({
              name: c.product.name,
              price: c.product.price,
              originalPrice: c.product.originalPrice,
              discount: c.product.discount,
              platform: c.product.platform,
              brand: c.product.brand,
              rating: c.product.rating,
              reviewsCount: c.product.reviewsCount,
              score: c.score,
              reason: c.reason,
              specs: c.specValues,
              pricePerSpec: c.pricePerSpec,
              productUrl: c.product.productUrl,
              imageUrl: c.product.imageUrl,
            })),
            platforms: results.map((r) => ({
              name: r.platform,
              status: r.status,
              count: r.parsedCount,
              error: r.error,
            })),
          });
        } else {
          printComparison(comparison);
          printCoverage(results);
        }
      }),
  )
  .command(
    "heal",
    new Command()
      .description("Self-heal a broken scraper using AI")
      .arguments("<collector_id:string> <prompt:string>")
      .option("--auto-approve", "Approve the fix automatically", {
        default: false,
      })
      .option("--verify-url <url:string>", "URL to re-run after heal to verify")
      .option("--json", "Output raw JSON", { default: false })
      .action(async (options, collectorId, prompt) => {
        const json = isJson(options);
        if (!json) {
          console.log(colors.bold(`\nHealing scraper ${collectorId}...\n`));
          console.log(colors.dim(`  Prompt: "${prompt}"\n`));
        }

        const result = await runHealFlow(
          collectorId,
          prompt,
          options.autoApprove,
        );

        if (json) {
          printJson({ collectorId, success: result.success });
        } else if (result.success) {
          console.log(colors.green.bold("\n  Scraper healed successfully!\n"));
          if (options.verifyUrl) {
            const verify = await verifyHeal(collectorId, options.verifyUrl);
            if (!verify.success) {
              console.error(
                colors.red.bold(
                  "\n  Heal completed but verification failed.\n",
                ),
              );
            }
          }
        } else {
          console.error(colors.red.bold("\n  Heal failed.\n"));
        }
      }),
  )
  .command(
    "history",
    new Command()
      .description("Show price history for tracked products")
      .arguments("[query:string]")
      .option("--json", "Output raw JSON", { default: false })
      .option("-n, --limit <n:number>", "Max products to show", { default: 10 })
      .action(async (options, query) => {
        const json = isJson(options);
        if (query) {
          const queryResults = await getHistoryByQuery(query);
          if (queryResults.length === 0) {
            if (json) {
              printJson({ query, records: [] });
            } else {
              console.log(colors.dim(`\nNo price history for "${query}".\n`));
            }
            return;
          }
          if (json) {
            printJson({ query, results: queryResults });
          } else {
            console.log(colors.bold(`\nSearch history for "${query}":\n`));
            for (const result of queryResults) {
              const products = result.products;
              if (products.length === 0) continue;
              const uniqueNames = [...new Set(products.map((p) => p.name))];
              console.log(
                colors.cyan(`  ${uniqueNames.length} products found`),
              );
              for (const name of uniqueNames.slice(0, options.limit)) {
                const records = products.filter((p) => p.name === name);
                const prices = records.map((r) => r.price);
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                const latest = prices[prices.length - 1];
                const previous = prices.length >= 2
                  ? prices[prices.length - 2]
                  : latest;
                const arrow = latest > previous
                  ? "\u2191"
                  : latest < previous
                  ? "\u2193"
                  : "\u2192";
                console.log(
                  colors.bold(
                    `    ${name.slice(0, 50)}${name.length > 50 ? "..." : ""}`,
                  ),
                );
                console.log(
                  `      ${arrow} Latest: ${
                    colors.green(formatPrice(latest))
                  } | Range: ${colors.dim(formatPrice(min))} - ${
                    colors.dim(formatPrice(max))
                  } | Records: ${records.length}\n`,
                );
              }
            }
          }
        } else {
          const products = await getTrackedProducts();
          if (products.length === 0) {
            if (json) {
              printJson({ products: [] });
            } else {
              console.log(
                colors.dim("\nNo tracked products yet. Run a search first.\n"),
              );
            }
            return;
          }
          if (json) {
            const data = [];
            for (const name of products.slice(0, options.limit)) {
              const history = await getPriceHistory(name);
              const prices = history.map((r) => r.price);
              data.push({
                name,
                latest: prices[prices.length - 1],
                min: Math.min(...prices),
                max: Math.max(...prices),
                records: history.length,
              });
            }
            printJson({ products: data });
          } else {
            console.log(
              colors.bold(`\nTracked products (${products.length}):\n`),
            );
            for (const name of products.slice(0, options.limit)) {
              const history = await getPriceHistory(name);
              const prices = history.map((r) => r.price);
              const min = Math.min(...prices);
              const max = Math.max(...prices);
              const latest = prices[prices.length - 1];
              const previous = prices.length >= 2
                ? prices[prices.length - 2]
                : latest;
              const arrow = latest > previous
                ? "\u2191"
                : latest < previous
                ? "\u2193"
                : "\u2192";
              console.log(
                colors.bold(
                  `  ${name.slice(0, 50)}${name.length > 50 ? "..." : ""}`,
                ),
              );
              console.log(
                `    ${arrow} Latest: ${
                  colors.green(formatPrice(latest))
                } | Range: ${colors.dim(formatPrice(min))} - ${
                  colors.dim(formatPrice(max))
                } | Records: ${history.length}\n`,
              );
            }
          }
        }
      }),
  )
  .command(
    "status",
    new Command()
      .description("Show configured scrapers and their status")
      .option("--json", "Output raw JSON", { default: false })
      .action((options) => {
        const json = isJson(options);
        if (json) {
          const data = Object.entries(PLATFORMS).map(([key, config]) => ({
            id: key,
            name: config.name,
            tool: config.tool,
            collectorId: config.collectorId,
            datasetId: config.datasetId,
            enabled: config.enabled,
            pagination: config.pagination,
            searchUrlTemplate: config.searchUrlTemplate,
          }));
          printJson({ platforms: data, pagesPerSearch: PAGES_TO_SCRAPE });
        } else {
          console.log(colors.bold("\nConfigured Scrapers:\n"));
          for (const [key, config] of Object.entries(PLATFORMS)) {
            const dot = config.enabled
              ? colors.green.bold("\u25cf")
              : colors.red.bold("\u25cf");
            const status = config.enabled
              ? colors.green("active")
              : colors.red("disabled");
            const toolLabel = config.tool === "prebuilt"
              ? colors.magenta("pre-built")
              : colors.cyan("scraper studio");
            console.log(
              `  ${dot} ${config.name} (${key}) [${status}] ${toolLabel} [${config.pagination}]`,
            );
            if (config.collectorId) {
              console.log(colors.dim(`    Collector: ${config.collectorId}`));
            }
            if (config.datasetId) {
              console.log(colors.dim(`    Dataset: ${config.datasetId}`));
            }
            console.log(colors.dim(`    URL: ${config.searchUrlTemplate}`));
            console.log();
          }
          console.log(colors.dim(`  Pages per search: ${PAGES_TO_SCRAPE}`));
          console.log();
        }
      }),
  )
  .command(
    "discover",
    new Command()
      .description("Discover deals via Google Shopping (SERP API)")
      .arguments("<query:string>")
      .option("--json", "Output raw JSON", { default: false })
      .option("-n, --limit <n:number>", "Max results to show", { default: 10 })
      .option("--country <country:string>", "Country code for geo-targeting", {
        default: "in",
      })
      .action(async (options, query) => {
        const json = isJson(options);
        if (!json) {
          console.log(
            colors.bold(
              `\nDiscovering deals for "${query}" via Google Shopping...\n`,
            ),
          );
        }

        const results = await searchGoogleShopping(query, options.country);

        if (json) {
          printJson({ query, count: results.length, results });
        } else {
          if (results.length === 0) {
            console.log(colors.dim("No shopping results found.\n"));
            return;
          }
          const table = new Table()
            .header(["#", "Product", "Price", "Shop", "Rating"])
            .border(true);
          for (const [i, item] of results.slice(0, options.limit).entries()) {
            table.push([
              String(i + 1),
              item.title.length > 45
                ? item.title.slice(0, 42) + "..."
                : item.title,
              colors.green(item.price || "N/A"),
              colors.cyan(item.shop),
              item.rating ? colors.yellow(`${item.rating}`) : colors.dim("-"),
            ]);
          }
          console.log("");
          table.render();
          console.log("");
        }
      }),
  )
  .command(
    "screenshot",
    new Command()
      .description("Take a screenshot of a deal page (Web Unlocker)")
      .arguments("<url:string>")
      .option("--json", "Output raw JSON", { default: false })
      .option("-o, --output <path:string>", "Output file path", {
        default: "screenshot.png",
      })
      .action(async (options, url) => {
        const json = isJson(options);
        validateUrl(url);
        if (!json) {
          console.log(colors.bold(`\nTaking screenshot of ${url}...\n`));
        }

        const base64 = await takeScreenshot(url);
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        await Deno.writeFile(options.output, bytes);

        if (json) {
          printJson({
            url,
            output: options.output,
            size: bytes.length,
            saved: true,
          });
        } else {
          console.log(colors.green(`  Screenshot saved to ${options.output}`));
          console.log(
            colors.dim(`  Size: ${(bytes.length / 1024).toFixed(1)}KB\n`),
          );
        }
      }),
  )
  .command(
    "scrapers",
    new Command()
      .description("List available pre-built Bright Data scrapers")
      .option("--json", "Output raw JSON", { default: false })
      .action((options) => {
        const json = isJson(options);
        const scrapers = getAvailablePreScrapers();
        if (json) {
          printJson({ scrapers });
        } else {
          console.log(colors.bold("\nAvailable Pre-built Scrapers:\n"));
          for (const s of scrapers) {
            console.log(`  ${colors.cyan(s.id)} — ${s.name}`);
            console.log(colors.dim(`    Dataset: ${s.datasetId}`));
          }
          console.log();
          console.log(
            colors.dim(
              '  Use with: tech-scraper search "query" --amazon-library',
            ),
          );
          console.log();
        }
      }),
  )
  .command(
    "doctor",
    new Command()
      .description("Check all configured collectors are reachable")
      .option("--json", "Output raw JSON", { default: false })
      .action(async (options) => {
        const json = isJson(options);
        if (!json) {
          console.log(colors.bold("\nChecking collectors...\n"));
        }

        const checks: Array<{
          platform: string;
          collectorId: string;
          ok: boolean;
          error?: string;
        }> = [];

        for (const [, config] of Object.entries(PLATFORMS)) {
          if (!config.collectorId) {
            checks.push({
              platform: config.name,
              collectorId: "n/a",
              ok: config.tool === "prebuilt",
              error: config.tool === "scraper"
                ? "No collector ID configured"
                : undefined,
            });
            continue;
          }
          const result = await checkCollector(config.collectorId);
          checks.push({
            platform: config.name,
            collectorId: config.collectorId,
            ok: result.ok,
            error: result.error,
          });
        }

        if (json) {
          printJson({ checks, allOk: checks.every((c) => c.ok) });
        } else {
          for (const c of checks) {
            const icon = c.ok
              ? colors.green.bold("\u2713")
              : colors.red.bold("\u2717");
            console.log(`  ${icon} ${c.platform} (${c.collectorId})`);
            if (c.error) console.log(colors.red(`    ${c.error}`));
          }
          console.log();
          const allOk = checks.every((c) => c.ok);
          if (allOk) {
            console.log(colors.green.bold("  All collectors healthy.\n"));
          } else {
            console.log(
              colors.red.bold(
                "  Some collectors need attention. Run: tech-scraper heal <id> <prompt>\n",
              ),
            );
          }
        }
      }),
  )
  .command(
    "fetch",
    new Command()
      .description("Fetch any page via Web Unlocker (returns Markdown)")
      .arguments("<url:string>")
      .option("--json", "Output raw JSON", { default: false })
      .action(async (options, url) => {
        const json = isJson(options);
        validateUrl(url);
        if (!json) {
          console.log(colors.bold(`\nFetching ${url} via Web Unlocker...\n`));
        }
        const markdown = await fetchPageMarkdown(url);
        if (json) {
          printJson({ url, markdown });
        } else {
          console.log(markdown);
        }
      }),
  )
  .command(
    "verdict",
    new Command()
      .description("AI-powered deal verdict with intelligence report")
      .arguments("<query:string>")
      .option("--json", "Output raw JSON", { default: false })
      .option("-p, --platforms <platforms:string>", "Comma-separated platforms")
      .option("--pages <pages:number>", "Pages per platform", {
        default: PAGES_TO_SCRAPE,
      })
      .option("--heal", "Enable auto-heal on empty results (off by default)")
      .option("--no-save", "Skip saving price history")
      .action(async (options, query) => {
        const json = isJson(options);
        const platforms = parsePlatforms(options.platforms);

        let intent: ParsedIntent;
        try {
          intent = await parseIntent(query);
        } catch (err) {
          console.error(
            colors.red(
              `\n  Intent parsing failed: ${
                err instanceof Error ? err.message : err
              }\n`,
            ),
          );
          Deno.exit(1);
        }

        const searchQuery = intent.searchQueries[0] ?? query;

        if (!json) {
          console.log(
            colors.bold(`\nGenerating verdict for "${searchQuery}"...\n`),
          );
          console.log(
            colors.dim(`  Intent: ${describeIntent(intent)}\n`),
          );
        }

        const scrapeOpts = buildScrapeOptions(options);
        const results = await scrapeProducts(
          searchQuery,
          platforms,
          scrapeOpts,
          intent,
        );
        let allProducts = results.flatMap((r) => r.products);

        if (options.save !== false) {
          try {
            await savePrices(allProducts, searchQuery);
          } catch (err) {
            console.error(
              `  Price history save failed: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
        }

        allProducts = deduplicate(allProducts);

        const scored = scoreAndRank(allProducts, intent.rawQuery, {
          dedupCheapest: false,
          inStockOnly: true,
          category: intent.category,
        });

        const top3 = scored.slice(0, 3);

        if (json) {
          printJson({
            query: searchQuery,
            intent,
            totalProducts: scored.length,
            top3,
          });
          return;
        }

        if (top3.length === 0) {
          console.log(colors.dim("\n  No products found.\n"));
          printCoverage(results);
          Deno.exit(1);
        }

        const best = top3[0];
        const category = intent.category !== "generic"
          ? intent.category
          : "generic";

        const report = generateDealReport(
          best,
          allProducts,
          intent,
          category,
        );

        if (json) {
          printJson({
            query: searchQuery,
            intent,
            totalProducts: scored.length,
            top3,
            report,
          });
          return;
        }

        console.log(colors.green.bold("\n  VERDICT\n"));
        console.log(
          colors.green.bold(`  ${report.verdict}`),
        );
        console.log(colors.bold(`  ${best.name}`));
        console.log(
          colors.green.bold(`  Price:     ${formatPrice(best.price)}`),
        );
        if (best.originalPrice > best.price) {
          console.log(
            colors.dim(`  Was:       ${formatPrice(best.originalPrice)}`),
          );
          console.log(
            colors.yellow(
              `  Savings:   ${
                formatPrice(best.originalPrice - best.price)
              } (${best.discount}% off)`,
            ),
          );
        }
        console.log(colors.cyan(`  Platform:  ${best.platform}`));
        console.log(colors.cyan(`  Score:     ${best.score.toFixed(2)}`));

        console.log(
          colors.dim(`\n  ${report.verdictSummary}`),
        );

        if (intent.budget) {
          const withinBudget = best.price <= intent.budget;
          console.log(
            withinBudget
              ? colors.green(
                `\n  Budget:    ${formatPrice(intent.budget)} — WITHIN BUDGET`,
              )
              : colors.red(
                `\n  Budget:    ${formatPrice(intent.budget)} — OVER by ${
                  formatPrice(best.price - intent.budget)
                }`,
              ),
          );
        }

        if (report.priceIntelligence) {
          const pi = report.priceIntelligence;
          console.log(colors.bold("\n  PRICE INTELLIGENCE\n"));
          console.log(`  Position:  ${pi.position}`);
          console.log(`  Trend:     ${pi.trend}`);
          const adviceColor = pi.buyAdvice.includes("GREAT") ||
              pi.buyAdvice.includes("GOOD")
            ? colors.green
            : pi.buyAdvice.includes("WAIT")
            ? colors.yellow
            : colors.dim;
          console.log(adviceColor(`  Advice:    ${pi.buyAdvice}`));
        }

        if (report.whyThisOne.length > 0) {
          console.log(colors.bold("\n  WHY THIS ONE\n"));
          for (const reason of report.whyThisOne) {
            console.log(`  ${colors.green("✓")} ${reason}`);
          }
        }

        if (report.effectivePrice.totalSavings > 0) {
          const ep = report.effectivePrice;
          console.log(colors.bold("\n  EFFECTIVE PRICE\n"));
          console.log(`  Listed:          ${formatPrice(ep.listed)}`);
          for (const bank of ep.bankOffers) {
            console.log(
              colors.green(
                `  Bank offer:      -${
                  formatPrice(bank.savings)
                } (${bank.text})`,
              ),
            );
          }
          if (ep.exchangeBonus > 0) {
            console.log(
              colors.green(
                `  Exchange bonus:  -${formatPrice(ep.exchangeBonus)}`,
              ),
            );
          }
          for (const coupon of ep.coupons) {
            console.log(
              colors.green(
                `  Coupon ${coupon.code}: -${formatPrice(coupon.savings)}`,
              ),
            );
          }
          console.log(
            colors.green.bold(
              `  Effective:       ${formatPrice(ep.effectivePrice)} (save ${
                formatPrice(ep.totalSavings)
              })`,
            ),
          );
        }

        if (report.specBreakdown.length > 0) {
          console.log(colors.bold("\n  SPEC BREAKDOWN\n"));
          for (const spec of report.specBreakdown) {
            console.log(
              `  ${spec.stars}  ${spec.name.padEnd(16)} ${spec.text}`,
            );
          }
        }

        if (report.alternatives.length > 0) {
          console.log(colors.bold("\n  ALTERNATIVES\n"));
          for (const alt of report.alternatives) {
            const tag = alt.type === "cheaper"
              ? colors.green("CHEAPER")
              : alt.type === "pricier"
              ? colors.yellow("UPGRADE")
              : colors.cyan("ALSO CONSIDER");
            console.log(
              `  ${tag}  ${
                formatPrice(alt.productPrice)
              } — ${alt.productName} ${colors.dim(`[${alt.platform}]`)}`,
            );
            console.log(
              colors.dim(`              ${alt.comparison}`),
            );
          }
        }

        if (report.watchOut.length > 0) {
          console.log(colors.bold("\n  WATCH OUT\n"));
          for (const item of report.watchOut) {
            console.log(`  ${colors.yellow("⚠")} ${item}`);
          }
        }

        if (report.temporalAdvice) {
          console.log(
            colors.dim(`\n  ${report.temporalAdvice}`),
          );
        }

        console.log("");
        printCoverage(results);
      }),
  );
