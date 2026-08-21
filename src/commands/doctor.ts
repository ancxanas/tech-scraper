/**
 * `doctor` — configuration and collector health in one place.
 *
 * Merges what used to be three commands (`doctor`, `status`, `scrapers`).
 * Answers the only question you actually ask when results look wrong: which
 * platform is broken, and why.
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";
import { ALL_ENABLED, PLATFORMS } from "../config.ts";
import { checkCollector } from "../lib/brightdata.ts";
import { buildUrls, searchTerm } from "../core/collect.ts";
import { parseIntentRules } from "../core/intent.ts";
import { isAvailable } from "../kv.ts";

function envRow(name: string, required: boolean): [string, string, string] {
  const set = Boolean(Deno.env.get(name));
  const status = set
    ? colors.green("set")
    : required
    ? colors.red("missing")
    : colors.dim("not set");
  const note = set ? "" : required ? "required for scraping" : "optional";
  return [name, status, colors.dim(note)];
}

export const doctorCommand = new Command()
  .description("Check configuration, credentials and collector health")
  .option("--json", "Output raw JSON", { default: false })
  .option("--skip-network", "Do not call BrightData", { default: false })
  .option("--query <q:string>", "Show the URLs a query would produce")
  .action(async (options) => {
    const json = options.json;

    // ---- environment
    const env = [
      envRow("BRIGHTDATA_API_KEY", true),
      envRow("UNLOCKER_ZONE", false),
      envRow("GEMINI_API_KEY", false),
    ];

    // ---- collectors
    const checks: Array<
      {
        platform: string;
        id: string;
        tool: string;
        ok: boolean;
        error?: string;
      }
    > = [];

    for (const key of ALL_ENABLED) {
      const config = PLATFORMS[key];
      if (config.tool === "prebuilt") {
        checks.push({
          platform: config.name,
          id: config.datasetId ?? "n/a",
          tool: "prebuilt dataset",
          ok: true,
        });
        continue;
      }
      if (!config.collectorId) {
        checks.push({
          platform: config.name,
          id: "n/a",
          tool: "collector",
          ok: false,
          error: "No collector ID configured",
        });
        continue;
      }
      if (options.skipNetwork) {
        checks.push({
          platform: config.name,
          id: config.collectorId,
          tool: "collector",
          ok: true,
          error: "not checked",
        });
        continue;
      }
      try {
        const r = await checkCollector(config.collectorId);
        checks.push({
          platform: config.name,
          id: config.collectorId,
          tool: "collector",
          ok: r.ok,
          error: r.error,
        });
      } catch (err) {
        checks.push({
          platform: config.name,
          id: config.collectorId,
          tool: "collector",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const kvOk = await isAvailable();

    if (json) {
      console.log(JSON.stringify(
        {
          env: Object.fromEntries(
            ["BRIGHTDATA_API_KEY", "UNLOCKER_ZONE", "GEMINI_API_KEY"]
              .map((k) => [k, Boolean(Deno.env.get(k))]),
          ),
          collectors: checks,
          priceHistory: kvOk,
          allOk: checks.every((c) => c.ok),
        },
        null,
        2,
      ));
      return;
    }

    console.log(`\n  ${colors.bold("Environment")}\n`);
    console.log(
      new Table().body(env.map(([a, b, c]) => [`  ${a}`, b, c])).padding(2)
        .toString(),
    );

    console.log(`\n  ${colors.bold("Platforms")}\n`);
    console.log(
      new Table()
        .header([
          colors.dim("  Platform"),
          colors.dim("Type"),
          colors.dim("ID"),
          colors.dim("Status"),
        ])
        .body(checks.map((c) => [
          `  ${c.ok ? colors.green("✓") : colors.red("✗")} ${c.platform}`,
          colors.dim(c.tool),
          colors.dim(c.id),
          c.ok
            ? (c.error ? colors.dim(c.error) : colors.green("ok"))
            : colors.red(c.error ?? "unreachable"),
        ]))
        .padding(2)
        .toString(),
    );

    console.log(
      `\n  ${colors.bold("Price history")}  ${
        kvOk
          ? colors.green("available")
          : colors.dim("unavailable (needs --unstable-kv)")
      }`,
    );

    if (options.query) {
      const intent = parseIntentRules(options.query);
      console.log(`\n  ${colors.bold("Request plan")} for "${options.query}"`);
      console.log(
        colors.dim(`  Marketplace keyword: "${searchTerm(intent)}"\n`),
      );
      for (const key of ALL_ENABLED) {
        if (PLATFORMS[key].tool === "prebuilt") {
          console.log(
            `  ${PLATFORMS[key].name}: ${colors.dim("keyword search")}`,
          );
          continue;
        }
        for (const url of buildUrls(key, intent, 1)) {
          console.log(`  ${PLATFORMS[key].name}: ${colors.dim(url)}`);
        }
      }
    }

    const bad = checks.filter((c) => !c.ok);
    if (bad.length) {
      console.log(
        colors.yellow(
          `\n  ${bad.length} platform(s) need attention. Try: deno task dev heal ${
            bad[0].platform.toLowerCase().split(" ")[0]
          }\n`,
        ),
      );
    } else {
      console.log(colors.green("\n  All platforms healthy.\n"));
    }
  });
