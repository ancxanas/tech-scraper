import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { loadRun } from "../core/replay.ts";
import { runPipeline } from "../core/pipeline.ts";
import { parseIntentRules, unsupportedReason } from "../core/intent.ts";
import { renderFull } from "../ui/render.ts";
import {
  type FetchMode,
  reportResolution,
  resolveSpecs,
} from "../core/resolve.ts";
import { buildCandidates } from "../core/pipeline.ts";

export const rankCommand = new Command()
  .description("Rank saved listings — no scraping, no collector credit")
  .arguments("<query:string>")
  .option(
    "-r, --replay <path:string>",
    "Run directory or JSON file(s), comma-separated",
    {
      required: true,
    },
  )
  .option("-n, --top <n:number>", "Rows to show in the ranking table", {
    default: 15,
  })
  .option("-d, --details <n:number>", "Detailed cards for the top N", {
    default: 3,
  })
  .option("--no-compare", "Skip the head-to-head matrix")
  .option("--no-diagnostics", "Skip the coverage/funnel tables")
  .option("--in-stock-only", "Drop items known to be out of stock")
  .option(
    "--budget-tolerance <pct:number>",
    "Allow N% over the stated budget",
    { default: 0 },
  )
  .option("--no-specs", "Skip spec resolution and rank on listing data alone")
  .option("--no-reviews", "Skip review mining (Flipkart only, display-only)")
  .option(
    "--specs-source <mode:string>",
    "Where spec pages come from: auto | direct | unlocker | cache",
    { default: "auto" },
  )
  .option(
    "--max-fetches <n:number>",
    "Cap NEW network fetches this run (cached pages are free and uncapped)",
  )
  .option(
    "--use-unlocker",
    "Fall back to BrightData Web Unlocker (BILLED per request) when a free fetch is blocked",
  )
  .option("-v, --verbose", "Show each page as it resolves")
  .option("--json", "Emit JSON instead of the terminal report", {
    default: false,
  })
  .action(async (options, query) => {
    const paths = options.replay.split(",").map((s) => s.trim()).filter(
      Boolean,
    );

    let batches;
    try {
      batches = await loadRun(paths);
    } catch (err) {
      console.error(
        colors.red(`\n  ${err instanceof Error ? err.message : err}\n`),
      );
      Deno.exit(1);
    }

    if (batches.length === 0) {
      console.error(colors.red("\n  No data found in the replay path.\n"));
      Deno.exit(1);
    }

    const intent = parseIntentRules(query);
    const unsupported = unsupportedReason(intent);
    if (unsupported) {
      console.error(colors.yellow(`\n  ${unsupported}`));
      console.error(
        colors.dim(
          '  Only phones are ranked. Try: "best phones under 15000".\n',
        ),
      );
      Deno.exit(2);
    }

    let enrichedCount = 0;
    let result = runPipeline(query, intent, batches, {
      inStockOnly: options.inStockOnly,
      budgetTolerance: (options.budgetTolerance ?? 0) / 100,
      keepRejected: false,
    });

    if (options.specs !== false) {
      const { candidates } = buildCandidates(intent, batches);
      const resolved = await resolveSpecs(candidates, {
        mode: options.specsSource as FetchMode,
        limit: options.maxFetches,
        allowPaid: options.useUnlocker,
        withReviews: options.reviews !== false,
        verbose: options.verbose,
      });
      reportResolution(resolved);
      enrichedCount = resolved.fromCache + resolved.fetchedDirect +
        resolved.fetchedPaid;
      if (
        resolved.text.size > 0 || resolved.checkout.size > 0 ||
        resolved.reviews.size > 0
      ) {
        result = runPipeline(query, intent, batches, {
          inStockOnly: options.inStockOnly,
          budgetTolerance: (options.budgetTolerance ?? 0) / 100,
          enrichText: resolved.text,
          checkoutInfo: resolved.checkout,
          externalSpecs: resolved.external,
          reviewData: resolved.reviews,
        });
      }
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          result,
          (k, v) => (k === "raw" || k === "listings" ? undefined : v),
          2,
        ),
      );
      return;
    }

    console.log(
      renderFull(result, {
        limit: options.top,
        details: options.details,
        compare: options.compare !== false,
        diagnostics: options.diagnostics !== false,
        enriched: enrichedCount,
      }),
    );
  });
