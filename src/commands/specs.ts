/**
 * `specs` — populate the spec cache for a catalogue, politely and resumably.
 *
 * Resolving specs inline during a ranking run works, but it is the wrong shape
 * for bulk work: the free transport rate-limits after roughly a hundred
 * requests, and a ranking run should not sit waiting on a spec database.
 *
 * This does the slow part once. Every resolved model is cached permanently, so
 * an interrupted run resumes rather than restarting, and subsequent rankings
 * are instant.
 *
 * Transport choice matters here:
 *   - direct  : free, but GSMArena returns HTTP 429 under sustained load
 *   - paid    : Web Unlocker, no rate limit, one request per model, one time
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { loadRun } from "../core/replay.ts";
import { buildCandidates } from "../core/pipeline.ts";
import { parseIntentRules } from "../core/intent.ts";
import { resolveSpecs } from "../core/resolve.ts";
import { SpecStore } from "../core/specstore.ts";
import { loadIndex } from "../knowledge/gsmarena.ts";

export const specsCommand = new Command()
  .description("Populate the spec cache for a saved run (resumable)")
  .arguments("<query:string>")
  .option("-r, --replay <path:string>", "Run directory or JSON file(s)", {
    required: true,
  })
  .option(
    "--allow-paid",
    "Use Web Unlocker where the free transport is blocked or throttled",
  )
  .option("--limit <n:number>", "Stop after N new fetches this run")
  .option("--pace <ms:number>", "Delay between spec-database requests", {
    default: 1500,
  })
  .action(async (options, query) => {
    const index = await loadIndex();
    if (index.length === 0) {
      console.error(
        colors.yellow(
          "\n  No model index found. Build it first:  deno task index\n",
        ),
      );
      Deno.exit(1);
    }

    const paths = options.replay.split(",").map((s) => s.trim()).filter(
      Boolean,
    );
    const batches = await loadRun(paths);
    const intent = parseIntentRules(query);
    const { candidates } = buildCandidates(intent, batches);

    console.error(
      colors.dim(
        `\n  ${candidates.length} products · index has ${index.length} models · transport: ${
          options.allowPaid ? "direct then Web Unlocker" : "direct only (free)"
        }\n`,
      ),
    );

    const store = new SpecStore();
    const result = await resolveSpecs(candidates, {
      store,
      allowPaid: options.allowPaid,
      limit: options.limit,
      verbose: true,
    });

    console.error("");
    console.error(
      `  spec database   ${result.gsmMatched} resolved, ${result.gsmUnmatched} not found`,
    );
    console.error(
      `  product pages   ${result.fetchedDirect} fetched, ${result.fromCache} cached, ${result.failed} failed`,
    );
    if (result.fetchedPaid) {
      console.error(`  via Web Unlocker ${result.fetchedPaid}`);
    }

    if (result.gsmRateLimited) {
      console.error(
        colors.yellow(
          "\n  The spec database throttled this IP. Everything resolved so far is\n" +
            "  cached — re-run in an hour to continue, or pass --allow-paid.",
        ),
      );
    }

    if (result.conflicts.length) {
      console.error(
        colors.yellow(
          `\n  ${result.conflicts.length} conflict(s) with src/knowledge/models.ts:`,
        ),
      );
      for (const c of result.conflicts) {
        console.error(
          `    ${c.product}: KB ${c.knowledgeBase} | ${
            c.source === "spec-db" ? "spec DB" : "merchant"
          } ${c.productPage}`,
        );
      }
    }

    const covered = result.gsmMatched + result.fromCache +
      result.fetchedDirect +
      result.fetchedPaid;
    console.error(
      colors.green(
        `\n  ${covered}/${candidates.length} products have resolved specs. Ranking is now instant:\n` +
          `    deno task rank "${query}" --replay ${paths[0]}\n`,
      ),
    );
  });
