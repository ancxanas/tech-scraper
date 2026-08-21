/**
 * `rank` command — run the analysis pipeline over saved scrape data.
 *
 * Free, offline, deterministic. This is the loop you iterate in:
 *
 *   deno task rank "best phones under 15000" --replay runs/latest
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { loadRun } from "../core/replay.ts";
import { runPipeline } from "../core/pipeline.ts";
import { parseIntentRules, unsupportedReason } from "../core/intent.ts";
import { renderFull } from "../ui/render.ts";

export const rankCommand = new Command()
  .description("Rank products from saved scrape data (no credits spent)")
  .arguments("<query:string>")
  .option(
    "-r, --replay <path:string>",
    "Run directory or JSON file(s), comma-separated",
    {
      required: true,
    },
  )
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
    "--budget-tolerance <pct:number>",
    "Allow N% over the stated budget",
    { default: 0 },
  )
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

    const result = runPipeline(query, intent, batches, {
      inStockOnly: options.inStockOnly,
      budgetTolerance: (options.budgetTolerance ?? 0) / 100,
      keepRejected: false,
    });

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
        limit: options.limit,
        details: options.details,
        compare: options.compare !== false,
        diagnostics: options.diagnostics !== false,
      }),
    );
  });
