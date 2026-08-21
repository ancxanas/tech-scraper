/**
 * `heal` — repair a broken collector, driven by v2 diagnostics.
 *
 * v1 made you supply a collector id and hand-write the prompt, which meant you
 * had to already know what was broken. This version takes a platform name,
 * works out the failure mode from an actual run (live or replayed), writes the
 * prompt from that evidence, and verifies the fix by re-running the pipeline.
 *
 * The failure modes it distinguishes, all of which appeared in real runs:
 *   - crawler error        (Tata CLiQ: "wait_element_timeout")
 *   - empty payload        (collector returns nothing)
 *   - fields missing       (Flipkart: 54/120 cards had no title or price)
 *   - wrong products       (Reliance: a phone query returned earphones)
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { type Platform, PLATFORMS } from "../config.ts";
import { runHealFlow } from "../lib/heal-api.ts";
import { collectRaw } from "../core/collect.ts";
import { runPipeline } from "../core/pipeline.ts";
import { parseIntentRules } from "../core/intent.ts";
import { loadRun } from "../core/replay.ts";
import type { PipelineDiagnostics } from "../core/types.ts";

type Failure =
  | "crawler_error"
  | "empty"
  | "fields_missing"
  | "wrong_products"
  | "healthy";

export function classifyFailure(d: PipelineDiagnostics): Failure {
  if (d.status === "error" || d.error) return "crawler_error";
  if (d.rawCards === 0) return "empty";
  if (d.categoryMatched === 0) return "wrong_products";
  // Under half the cards yielding a usable price means the selectors slipped.
  if (d.priced / Math.max(d.rawCards, 1) < 0.5) return "fields_missing";
  if (d.fieldFill < 0.6) return "fields_missing";
  return "healthy";
}

export function buildPrompt(d: PipelineDiagnostics, failure: Failure): string {
  const common =
    "Return one record per product card with these fields: product_name, selling_price, original_price, discount_percentage, rating, review_count, image_url, product_url. Prices may be plain numbers or objects with a value field.";

  switch (failure) {
    case "crawler_error":
      return `The collector fails before extracting anything. Error: "${
        d.error ?? "unknown"
      }". The wait selector no longer matches the page. Find the current product-grid container and card selectors on the search results page and update the wait condition, then ${common}`;
    case "empty":
      return `The collector runs but returns zero records. The product card selector no longer matches. Inspect the search results page, find the repeating product card element, and ${common}`;
    case "wrong_products":
      return `The collector returns ${d.rawCards} records but none are the requested product category — it is scraping the wrong page or an unrelated section. Verify the input URL is the search results page for the query, then ${common}`;
    case "fields_missing":
      return `The collector returns ${d.rawCards} cards but only ${d.priced} have a price and field coverage is ${
        Math.round(d.fieldFill * 100)
      }%. Some cards use a different layout (sponsored, carousel or grid variants) whose selectors are missing. Handle every card layout on the page and ${common}`;
    default:
      return `Improve field coverage on the product cards. ${common}`;
  }
}

export const healCommand = new Command()
  .description("Diagnose and repair a broken collector using AI")
  .arguments("<platform:string>")
  .option("--query <q:string>", "Query to diagnose with", {
    default: "best phones under 15000",
  })
  .option(
    "--replay <path:string>",
    "Diagnose from a saved run instead of scraping",
  )
  .option("--auto-approve", "Apply the fix without confirmation", {
    default: false,
  })
  .option("--prompt <text:string>", "Override the generated heal prompt")
  .option("--dry-run", "Show the diagnosis and prompt, change nothing", {
    default: false,
  })
  .action(async (options, platformArg) => {
    const platform = platformArg.toLowerCase() as Platform;
    if (!(platform in PLATFORMS)) {
      console.error(
        colors.red(
          `\n  Unknown platform "${platformArg}". Options: ${
            Object.keys(PLATFORMS).join(", ")
          }\n`,
        ),
      );
      Deno.exit(1);
    }

    const config = PLATFORMS[platform];
    if (!config.collectorId) {
      console.error(
        colors.red(
          `\n  ${config.name} uses a ${config.tool}; there is no collector to heal.\n`,
        ),
      );
      Deno.exit(1);
    }

    const intent = parseIntentRules(options.query);

    console.error(colors.bold(`\n  Diagnosing ${config.name}…\n`));
    const batches = options.replay
      ? (await loadRun([options.replay])).filter((b) => b.platform === platform)
      : await collectRaw([platform], intent, { pages: 1 });

    if (batches.length === 0) {
      console.error(
        colors.red(`  No data for ${config.name} in that source.\n`),
      );
      Deno.exit(1);
    }

    const { diagnostics } = runPipeline(options.query, intent, batches);
    const d = diagnostics[0];
    const failure = classifyFailure(d);

    console.error(
      `  ${d.rawCards} raw cards · ${d.priced} priced · ${d.categoryMatched} in category · ${
        Math.round(d.fieldFill * 100)
      }% fields`,
    );
    if (d.error) console.error(colors.red(`  error: ${d.error}`));

    if (failure === "healthy") {
      console.error(
        colors.green(`\n  ${config.name} looks healthy — nothing to heal.\n`),
      );
      return;
    }

    console.error(colors.yellow(`  diagnosis: ${failure.replace("_", " ")}\n`));

    const prompt = options.prompt ?? buildPrompt(d, failure);
    console.error(colors.dim(`  Heal prompt:\n  ${prompt}\n`));

    if (options.dryRun) {
      console.error(colors.dim("  --dry-run: stopping here.\n"));
      return;
    }

    const result = await runHealFlow(
      config.collectorId,
      prompt,
      options.autoApprove,
    );
    if (!result.success) {
      console.error(colors.red("\n  Heal was rejected or failed.\n"));
      Deno.exit(1);
    }

    console.error(
      colors.green("\n  Fix applied. Verifying with a fresh run…\n"),
    );
    const after = await collectRaw([platform], intent, { pages: 1 });
    const verify = runPipeline(options.query, intent, after).diagnostics[0];
    const nowFailure = classifyFailure(verify);

    console.error(
      `  ${verify.rawCards} raw cards · ${verify.priced} priced · ${verify.categoryMatched} in category · ${
        Math.round(verify.fieldFill * 100)
      }% fields`,
    );

    if (nowFailure === "healthy") {
      console.error(colors.green(`\n  ${config.name} is healthy again.\n`));
    } else {
      console.error(
        colors.yellow(
          `\n  Still degraded (${
            nowFailure.replace("_", " ")
          }). Re-run heal or fix the collector by hand.\n`,
        ),
      );
      Deno.exit(1);
    }
  });
