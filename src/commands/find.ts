/**
 * `find` — live search: scrape, save the raw payloads, then rank offline.
 *
 * The raw payloads are written to disk BEFORE analysis, so a crash in the
 * ranking code never costs a scrape credit, and any run can be replayed with
 * `rank --replay` afterwards.
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { ALL_ENABLED, type Platform, PLATFORMS } from "../config.ts";
import { collectRaw, searchTerm } from "../core/collect.ts";
import { runPipeline } from "../core/pipeline.ts";
import {
  describeIntent,
  parseIntentRules,
  unsupportedReason,
} from "../core/intent.ts";
import { runDirFor, saveRun } from "../core/replay.ts";
import { renderFull } from "../ui/render.ts";
import { enrichTop, reportEnrichment } from "../core/enrich.ts";
import { getStatsFor, savePrices } from "../kv.ts";
import type { RankIntent } from "../core/types.ts";

function parsePlatforms(raw?: string): Platform[] {
  if (!raw) return ALL_ENABLED;
  const wanted = raw.split(",").map((s) => s.trim().toLowerCase());
  const valid = Object.keys(PLATFORMS) as Platform[];
  const picked = valid.filter((p) => wanted.includes(p));
  return picked.length ? picked : ALL_ENABLED;
}

/** Optional LLM pass; failures are non-fatal, rules already gave us an intent. */
async function maybeEnhanceIntent(intent: RankIntent): Promise<RankIntent> {
  if (!Deno.env.get("GEMINI_API_KEY")) return intent;
  try {
    const { parseIntent } = await import("../lib/llm-intent.ts");
    const llm = await parseIntent(intent.raw);
    return {
      ...intent,
      // Only fill gaps — the deterministic parse is the source of truth for
      // anything it was confident about.
      category: intent.category === "unknown"
        ? (llm.category as RankIntent["category"]) ?? "unknown"
        : intent.category,
      budgetMax: intent.budgetMax ?? llm.budget ?? null,
      brands: intent.brands.length
        ? intent.brands
        : llm.brand
        ? [llm.brand]
        : [],
      priorities: intent.priorities.length
        ? intent.priorities
        : llm.useCase ?? [],
    };
  } catch {
    return intent;
  }
}

export const findCommand = new Command()
  .description("Scrape live prices and rank them (spends BrightData credit)")
  .arguments("<query:string>")
  .option(
    "-p, --platforms <list:string>",
    "Comma-separated: flipkart,amazon,reliance,tatacliq",
  )
  .option("--pages <n:number>", "Pages per platform", { default: 1 })
  .option("-n, --limit <n:number>", "Rows in the ranking table", {
    default: 15,
  })
  .option("-d, --details <n:number>", "Detailed cards for the top N", {
    default: 3,
  })
  .option("--no-compare", "Skip the head-to-head matrix")
  .option("--no-diagnostics", "Skip the coverage/funnel tables")
  .option("--in-stock-only", "Drop items known to be out of stock")
  .option(
    "--enrich-via <mode:string>",
    "auto | direct | unlocker (auto tries the free direct fetch first)",
    { default: "auto" },
  )
  .option(
    "--enrich <n:number>",
    "Fetch real spec sheets for the top N finalists (costs Unlocker credit)",
    { default: 0 },
  )
  .option(
    "--budget-tolerance <pct:number>",
    "Allow N% over the stated budget",
    { default: 0 },
  )
  .option("--save-dir <path:string>", "Where to write the raw run", {
    default: "runs",
  })
  .option("--no-save", "Do not persist raw payloads (not recommended)")
  .option("--no-history", "Skip reading/writing price history")
  .option("--json", "Emit JSON instead of the terminal report", {
    default: false,
  })
  .action(async (options, query) => {
    const platforms = parsePlatforms(options.platforms);
    let intent = parseIntentRules(query);
    intent = await maybeEnhanceIntent(intent);

    // Refuse before spending a single request, not after.
    const unsupported = unsupportedReason(intent);
    if (unsupported) {
      console.error(colors.yellow(`\n  ${unsupported}`));
      console.error(
        colors.dim(
          '  Phone specs, benchmarks and value scoring are the only thing it does well,\n  so it declines rather than guess. Try: "best phones under 15000".\n',
        ),
      );
      Deno.exit(2);
    }

    if (!options.json) {
      console.log("");
      console.log(colors.bold(`  Searching: ${colors.white(`"${query}"`)}`));
      console.log(colors.dim(`  Understood as: ${describeIntent(intent)}`));
      console.log(colors.dim(`  Marketplace query: "${searchTerm(intent)}"`));
      console.log(
        colors.dim(
          `  Platforms: ${
            platforms.map((p) => PLATFORMS[p].name).join(", ")
          } · ${options.pages} page(s)`,
        ),
      );
      console.log("");
    }

    const batches = await collectRaw(platforms, intent, {
      pages: options.pages,
    });

    let savedTo: string | null = null;
    if (options.save !== false) {
      try {
        savedTo = await saveRun(
          runDirFor(query, options.saveDir),
          query,
          searchTerm(intent),
          batches,
        );
      } catch (err) {
        console.error(
          colors.yellow(
            `  Could not save run: ${err instanceof Error ? err.message : err}`,
          ),
        );
      }
    }

    let enrichedCount = 0;
    let result = runPipeline(query, intent, batches, {
      inStockOnly: options.inStockOnly,
      budgetTolerance: (options.budgetTolerance ?? 0) / 100,
    });

    // Re-rank with recorded history so the deal score reflects whether this
    // price is actually good *for this product*, not just good-looking today.
    if (options.history !== false && result.ranked.length > 0) {
      const stats = await getStatsFor(result.ranked.map((r) => r.key));
      if (stats.size > 0) {
        result = runPipeline(query, intent, batches, {
          inStockOnly: options.inStockOnly,
          budgetTolerance: (options.budgetTolerance ?? 0) / 100,
          priceHistory: stats,
        });
      }
    }

    // Second pass: buy real spec sheets for the finalists only, then re-rank.
    if (options.enrich > 0 && result.ranked.length > 0) {
      if (!options.json) {
        console.error(
          colors.dim(
            `  → enriching top ${options.enrich} with live spec sheets…`,
          ),
        );
      }
      const enriched = await enrichTop(result.ranked, options.enrich, {
        verbose: !options.json,
        mode: options.enrichVia as "auto" | "direct" | "unlocker",
      });
      if (enriched.text.size > 0) {
        result = runPipeline(query, intent, batches, {
          inStockOnly: options.inStockOnly,
          budgetTolerance: (options.budgetTolerance ?? 0) / 100,
          enrichText: enriched.text,
        });
      }
      if (!options.json) {
        enrichedCount = enriched.fetched;
        reportEnrichment(enriched);
      }
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          { ...result, savedTo },
          (k, v) => (k === "raw" || k === "listings" ? undefined : v),
          2,
        ),
      );
    } else {
      console.log(
        renderFull(result, {
          limit: options.limit,
          details: options.details,
          compare: options.compare !== false,
          diagnostics: options.diagnostics !== false,
          enriched: enrichedCount,
        }),
      );
      if (savedTo) {
        console.log(
          colors.dim(
            `  Raw payloads saved to ${
              colors.white(savedTo)
            }\n  Re-rank for free:  deno task rank "${query}" --replay ${savedTo}\n`,
          ),
        );
      }
    }

    if (options.history !== false && result.ranked.length > 0) {
      try {
        const n = await savePrices(result.ranked, query);
        if (!options.json && n > 0) {
          console.error(
            colors.dim(
              `  ${n} price observations recorded (deno task dev history)`,
            ),
          );
        }
      } catch { /* price history is a bonus, never fatal */ }
    }

    const allFailed = result.diagnostics.every((d) => d.status !== "ok");
    if (result.ranked.length === 0 && allFailed) Deno.exit(1);
  });
