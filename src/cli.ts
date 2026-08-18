import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";
import {
  ALL_ENABLED,
  ALL_PLATFORMS,
  PAGES_TO_SCRAPE,
  type Platform,
  PLATFORMS,
} from "./config.ts";
import { deduplicate, scoreAndRank } from "./score.ts";
import { scrapeProducts } from "./scraper.ts";
import { runHealFlow, verifyHeal } from "./tools/healer.ts";
import { getPriceHistory, getTrackedProducts, savePrices } from "./kv.ts";
import { searchGoogleShopping } from "./lib/serp.ts";
import { getAvailablePreScrapers } from "./lib/prescrapers.ts";
import { fetchPageMarkdown, takeScreenshot } from "./lib/unlock.ts";

let jsonMode = false;

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

function getEnabledCount(platforms: Platform[]): number {
  return platforms.filter((p) => PLATFORMS[p].enabled).length;
}

function formatPrice(val: number): string {
  return `\u20b9${val.toLocaleString("en-IN")}`;
}

function printTable(products: ReturnType<typeof scoreAndRank>, limit = 20) {
  const rows = products.slice(0, limit);
  if (rows.length === 0) {
    console.log(colors.dim("\nNo products found.\n"));
    return;
  }

  const table = new Table()
    .header([
      "#",
      "Product",
      "Price",
      "Was",
      "Off",
      "Score",
      "Platform",
    ])
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

function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

export const cli = new Command()
  .name("tech-scraper")
  .version("0.1.0")
  .description("Find the best tech deals across Indian e-commerce platforms")
  .globalOption("--json", "Output raw JSON instead of formatted tables", {
    default: false,
  })
  .action((options) => {
    jsonMode = options.json;
  })
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

        if (!jsonMode) {
          console.log(
            colors.bold(`\nSearching for "${query}"...\n`),
          );
        }

        const results = await scrapeProducts(query, platforms, options.pages);
        let allProducts = results.flatMap((r) => r.products);

        if (options.dedup !== false) {
          allProducts = deduplicate(allProducts);
        }

        const ranked = scoreAndRank(allProducts, query);

        if (jsonMode) {
          printJson({ query, count: ranked.length, products: ranked });
        } else {
          printTable(ranked, options.limit);
          if (allProducts.length > 0) {
            await savePrices(allProducts, query);
            console.log(
              colors.dim(
                `  Price history saved (${allProducts.length} products)\n`,
              ),
            );
          }
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

        if (!jsonMode) {
          console.log(
            colors.bold(`\nFinding best deal for "${query}"...\n`),
          );
        }

        const results = await scrapeProducts(query, platforms, options.pages);
        let allProducts = results.flatMap((r) => r.products);
        allProducts = deduplicate(allProducts);
        const ranked = scoreAndRank(allProducts, query);

        if (ranked.length === 0) {
          if (jsonMode) {
            printJson({ query, best: null });
          } else {
            console.log(colors.dim("No products found.\n"));
          }
          return;
        }

        const best = ranked[0];

        if (jsonMode) {
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

          if (allProducts.length > 0) {
            await savePrices(allProducts, query);
          }
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
        const enabledCount = getEnabledCount(platforms);

        if (enabledCount < 2) {
          console.error(
            colors.red(
              `Compare needs 2+ enabled platforms. Only ${enabledCount} enabled.`,
            ),
          );
          console.error(
            colors.dim(
              "Enable platforms in src/config.ts or check scraper status.",
            ),
          );
          Deno.exit(1);
        }

        if (!jsonMode) {
          console.log(
            colors.bold(
              `\nComparing "${query}" across ${enabledCount} platforms...\n`,
            ),
          );
        }

        const results = await scrapeProducts(query, platforms, options.pages);

        if (jsonMode) {
          printJson({
            query,
            platforms: results.map((r) => ({
              name: r.platform,
              count: r.products.length,
              priceRange: r.products.length > 0
                ? {
                  min: Math.min(...r.products.map((p) => p.price)),
                  max: Math.max(...r.products.map((p) => p.price)),
                }
                : null,
            })),
            all: results.flatMap((r) => r.products),
          });
        } else {
          for (const result of results) {
            const count = colors.bold(String(result.products.length));
            console.log(`${result.platform}: ${count} products`);
            if (result.products.length > 0) {
              const prices = result.products.map((p) => p.price);
              console.log(
                `  Price range: ${
                  colors.green(
                    formatPrice(Math.min(...prices)),
                  )
                } - ${colors.green(formatPrice(Math.max(...prices)))}`,
              );
            }
          }

          let allProducts = results.flatMap((r) => r.products);
          allProducts = deduplicate(allProducts);
          const ranked = scoreAndRank(allProducts, query);
          printTable(ranked, 15);

          if (allProducts.length > 0) {
            await savePrices(allProducts, query);
          }
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
      .option("--verify-url <url:string>", "URL to re-run after heal to verify")
      .action(async (options, collectorId, prompt) => {
        console.log(
          colors.bold(`\nHealing scraper ${collectorId}...\n`),
        );
        console.log(colors.dim(`  Prompt: "${prompt}"\n`));

        const result = await runHealFlow(
          collectorId,
          prompt,
          options.autoApprove,
        );

        if (result.success) {
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
      .option("-n, --limit <n:number>", "Max products to show", {
        default: 10,
      })
      .action(async (options, query) => {
        if (query) {
          const history = await getPriceHistory(query);
          if (history.length === 0) {
            if (jsonMode) {
              printJson({ query, records: [] });
            } else {
              console.log(
                colors.dim(`\nNo price history for "${query}".\n`),
              );
            }
            return;
          }

          if (jsonMode) {
            printJson({ query, records: history });
          } else {
            console.log(
              colors.bold(`\nPrice history for "${query}":\n`),
            );
            const table = new Table()
              .header(["Date", "Price", "Platform"])
              .border(true);

            for (const record of history) {
              const date = new Date(record.timestamp);
              table.push([
                date.toLocaleDateString("en-IN"),
                colors.green(formatPrice(record.price)),
                colors.cyan(record.platform),
              ]);
            }

            table.render();

            if (history.length >= 2) {
              const first = history[0].price;
              const last = history[history.length - 1].price;
              const change = last - first;
              const pct = ((change / first) * 100).toFixed(1);
              const arrow = change > 0
                ? "\u2191"
                : change < 0
                ? "\u2193"
                : "\u2192";
              const trendColor = change > 0
                ? colors.red
                : change < 0
                ? colors.green
                : colors.yellow;

              console.log(
                trendColor(
                  `\n  Trend: ${arrow} ${change >= 0 ? "+" : ""}${
                    formatPrice(
                      change,
                    )
                  } (${change >= 0 ? "+" : ""}${pct}%)\n`,
                ),
              );
            }
          }
        } else {
          const products = await getTrackedProducts();
          if (products.length === 0) {
            if (jsonMode) {
              printJson({ products: [] });
            } else {
              console.log(
                colors.dim(
                  "\nNo tracked products yet. Run a search first.\n",
                ),
              );
            }
            return;
          }

          if (jsonMode) {
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
              colors.bold(
                `\nTracked products (${products.length}):\n`,
              ),
            );
            for (const name of products.slice(0, options.limit)) {
              const history = await getPriceHistory(name);
              const prices = history.map((r) => r.price);
              const min = Math.min(...prices);
              const max = Math.max(...prices);
              const latest = prices[prices.length - 1];
              const arrow = latest > min
                ? "\u2191"
                : latest < max
                ? "\u2193"
                : "\u2192";
              console.log(
                colors.bold(
                  `  ${name.slice(0, 50)}${name.length > 50 ? "..." : ""}`,
                ),
              );
              console.log(
                `    ${arrow} Latest: ${
                  colors.green(
                    formatPrice(latest),
                  )
                } | Range: ${
                  colors.dim(
                    formatPrice(min),
                  )
                } - ${
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
      .action(() => {
        if (jsonMode) {
          const data = Object.entries(PLATFORMS).map(([key, config]) => ({
            id: key,
            name: config.name,
            collectorId: config.collectorId,
            enabled: config.enabled,
            url: config.url,
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
            console.log(`  ${dot} ${config.name} (${key}) [${status}]`);
            console.log(
              colors.dim(`    Collector: ${config.collectorId}`),
            );
            console.log(colors.dim(`    URL: ${config.url}`));
            console.log(
              colors.dim(`    Products/page: ~${config.productsPerPage}`),
            );
            console.log();
          }
          console.log(
            colors.dim(`  Pages per search: ${PAGES_TO_SCRAPE}`),
          );
          console.log();
        }
      }),
  )
  .command(
    "discover",
    new Command()
      .description("Discover deals via Google Shopping (SERP API)")
      .arguments("<query:string>")
      .option("-n, --limit <n:number>", "Max results to show", { default: 10 })
      .option(
        "--country <country:string>",
        "Country code for geo-targeting",
        { default: "in" },
      )
      .action(async (options, query) => {
        if (!jsonMode) {
          console.log(
            colors.bold(
              `\nDiscovering deals for "${query}" via Google Shopping...\n`,
            ),
          );
        }

        const results = await searchGoogleShopping(query, options.country);

        if (jsonMode) {
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
      .option(
        "-o, --output <path:string>",
        "Output file path",
        { default: "screenshot.png" },
      )
      .action(async (options, url) => {
        if (!jsonMode) {
          console.log(
            colors.bold(`\nTaking screenshot of ${url}...\n`),
          );
        }

        const base64 = await takeScreenshot(url);

        if (jsonMode) {
          printJson({ url, output: options.output, size: base64.length });
        } else {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          await Deno.writeFile(options.output, bytes);
          console.log(
            colors.green(`  Screenshot saved to ${options.output}`),
          );
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
      .action(() => {
        const scrapers = getAvailablePreScrapers();

        if (jsonMode) {
          printJson({ scrapers });
        } else {
          console.log(colors.bold("\nAvailable Pre-built Scrapers:\n"));
          for (const s of scrapers) {
            console.log(`  ${colors.cyan(s.id)} — ${s.name}`);
            console.log(colors.dim(`    Dataset: ${s.datasetId}`));
          }
          console.log();
          console.log(
            colors.dim('  Use with: tech-scraper search "query" -p amazon'),
          );
          console.log();
        }
      }),
  )
  .command(
    "fetch",
    new Command()
      .description("Fetch any page via Web Unlocker (returns Markdown)")
      .arguments("<url:string>")
      .action(async (_options, url) => {
        if (!jsonMode) {
          console.log(
            colors.bold(`\nFetching ${url} via Web Unlocker...\n`),
          );
        }

        const markdown = await fetchPageMarkdown(url);

        if (jsonMode) {
          printJson({ url, markdown });
        } else {
          console.log(markdown);
        }
      }),
  );
