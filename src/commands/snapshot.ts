/**
 * `snapshot` — download an EXISTING BrightData snapshot by id.
 *
 * This is a download of data that was already collected (and already paid
 * for), not a new crawl. When a run's ranking looked wrong, this pulls the
 * exact payload back so it can be replayed offline:
 *
 *   deno task snapshot sd_mt2gj3m12b2l7r2jy9 --platform amazon --out runs/phones
 *   deno task rank "best phones under 15000" --replay runs/phones
 *
 * Snapshot ids are printed by every live run and are also listed in the
 * BrightData dashboard under Datasets → Snapshots.
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { bdFetch } from "../lib/brightdata.ts";
import { inferPlatform } from "../core/replay.ts";

/** DCA collections and Dataset-API snapshots use different download paths. */
async function download(id: string): Promise<unknown[]> {
  const paths = id.startsWith("sd_")
    ? [
      `/datasets/v3/snapshot/${id}?format=json`,
      `/dca/dataset?id=${id}`,
    ]
    : [
      `/dca/dataset?id=${id}`,
      `/datasets/v3/snapshot/${id}?format=json`,
    ];

  const errors: string[] = [];
  for (const path of paths) {
    try {
      const data = await bdFetch<unknown>(path);
      if (Array.isArray(data)) return data;
      if (data && typeof data === "object") {
        const o = data as Record<string, unknown>;
        for (const key of ["data", "results", "products", "items"]) {
          if (Array.isArray(o[key])) return o[key] as unknown[];
        }
        // A status envelope means the job is still running.
        if (o.status && o.status !== "ready") {
          throw new Error(`snapshot status: ${String(o.status)}`);
        }
      }
      errors.push(`${path}: unexpected response shape`);
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(errors.join(" | "));
}

export const snapshotCommand = new Command()
  .description("Download an existing BrightData snapshot (no new scrape)")
  .arguments("<id:string>")
  .option("--platform <name:string>", "flipkart | amazon | reliance | tatacliq")
  .option("-o, --out <dir:string>", "Directory to write into", {
    default: "runs/snapshot",
  })
  .action(async (options, id) => {
    console.error(colors.dim(`  Downloading snapshot ${id}…`));

    let items: unknown[];
    try {
      items = await download(id);
    } catch (err) {
      console.error(
        colors.red(
          `\n  Could not download ${id}: ${
            err instanceof Error ? err.message : err
          }\n`,
        ),
      );
      Deno.exit(1);
    }

    const platform = options.platform ?? inferPlatform(items);
    await Deno.mkdir(options.out, { recursive: true });
    const file = `${options.out}/${platform}.json`;
    await Deno.writeTextFile(file, JSON.stringify(items, null, 2));

    const errors = items.filter((i) =>
      i && typeof i === "object" && (i as Record<string, unknown>).error
    ).length;

    console.error(
      colors.green(
        `  ✓ ${items.length} records → ${file}${
          errors ? colors.yellow(` (${errors} carry an upstream error)`) : ""
        }`,
      ),
    );
    console.error(
      colors.dim(
        `\n  Replay it:  deno task rank "<your query>" --replay ${options.out}\n`,
      ),
    );
  });
