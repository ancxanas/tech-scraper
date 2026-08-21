/**
 * `history` — price history for products the tool has already seen.
 *
 * Populated automatically by `find`. Keys line up with ranked candidates, so
 * "POCO M7 5G (6GB/128GB)" is one tracked product rather than one per colour.
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";
import { getStats, isAvailable, listTracked, type PriceStats } from "../kv.ts";
import { rupees } from "../ui/render.ts";

function trendCell(s: PriceStats): string {
  if (s.trend === "falling") return colors.green("↓ falling");
  if (s.trend === "rising") return colors.red("↑ rising");
  return colors.dim("→ stable");
}

function positionCell(s: PriceStats): string {
  if (s.observations < 2) return colors.dim("—");
  if (s.position <= 0.05) return colors.green.bold("at its lowest");
  if (s.position <= 0.25) return colors.green("near its lowest");
  if (s.position >= 0.95) return colors.red("at its peak");
  if (s.position >= 0.75) return colors.yellow("above average");
  return colors.dim("mid-range");
}

export const historyCommand = new Command()
  .description("Price history for products seen in previous runs")
  .arguments("[key:string]")
  .option("-n, --limit <n:number>", "Max products to show", { default: 20 })
  .option("--json", "Output raw JSON", { default: false })
  .action(async (options, key) => {
    if (!await isAvailable()) {
      console.error(
        colors.yellow(
          "\n  Price history needs Deno KV. Run with --unstable-kv (deno task find does).\n",
        ),
      );
      Deno.exit(1);
    }

    if (key) {
      const stats = await getStats(key);
      if (!stats) {
        console.error(colors.dim(`\n  No history for "${key}".\n`));
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(`\n  ${colors.bold(stats.name)}`);
      console.log(
        colors.dim(
          `  ${stats.observations} observations over ${stats.daysTracked} day(s)\n`,
        ),
      );
      console.log(
        `  Current  ${colors.bold(colors.green(rupees(stats.current)))}`,
      );
      console.log(`  Lowest   ${rupees(stats.min)}`);
      console.log(`  Highest  ${rupees(stats.max)}`);
      console.log(`  Average  ${rupees(stats.avg)}`);
      console.log(`  Trend    ${trendCell(stats)} · ${positionCell(stats)}\n`);
      return;
    }

    const all = await listTracked(options.limit);
    if (all.length === 0) {
      console.log(
        colors.dim('\n  Nothing tracked yet. Run: deno task find "<query>"\n'),
      );
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(all, null, 2));
      return;
    }

    const table = new Table()
      .header([
        colors.bold("Product"),
        colors.bold("Current"),
        colors.bold("Low"),
        colors.bold("High"),
        colors.bold("Trend"),
        colors.bold("Position"),
        colors.dim("obs"),
      ])
      .body(all.map((s) => [
        s.name.length > 38 ? `${s.name.slice(0, 37)}…` : s.name,
        colors.green(rupees(s.current)),
        rupees(s.min),
        rupees(s.max),
        trendCell(s),
        positionCell(s),
        colors.dim(String(s.observations)),
      ]))
      .border(true)
      .padding(1);

    console.log(`\n  ${colors.bold(`Tracked products (${all.length})`)}\n`);
    console.log(table.toString());
    console.log();
  });
