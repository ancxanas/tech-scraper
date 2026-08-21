import type { PlatformId } from "./types.ts";
import type { RawBatch } from "./pipeline.ts";

const PLATFORM_NAMES: Record<PlatformId, string> = {
  flipkart: "Flipkart",
  amazon: "Amazon India",
  reliance: "Reliance Digital",
  tatacliq: "Tata CLiQ",
  unknown: "Unknown",
};

export interface RunManifest {
  query: string;
  searchQuery: string;
  timestamp: string;
  platforms: Array<{
    platform: PlatformId;
    platformName: string;
    file: string;
    count: number;
    status: "ok" | "error" | "empty";
    error?: string;
  }>;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function runDirFor(query: string, root = "runs"): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${root}/${ts}_${slugify(query)}`;
}

export async function saveRun(
  dir: string,
  query: string,
  searchQuery: string,
  batches: RawBatch[],
): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  const manifest: RunManifest = {
    query,
    searchQuery,
    timestamp: new Date().toISOString(),
    platforms: [],
  };

  for (const b of batches) {
    const file = `${b.platform}.json`;
    await Deno.writeTextFile(
      `${dir}/${file}`,
      JSON.stringify(b.items, null, 2),
    );
    manifest.platforms.push({
      platform: b.platform,
      platformName: b.platformName,
      file,
      count: b.items.length,
      status: b.status,
      error: b.error,
    });
  }

  await Deno.writeTextFile(
    `${dir}/manifest.json`,
    JSON.stringify(manifest, null, 2),
  );
  return dir;
}

export function inferPlatform(items: unknown[]): PlatformId {
  for (const item of items.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = String(o.platform ?? "").toLowerCase();
    if (label.includes("flipkart")) return "flipkart";
    if (label.includes("amazon")) return "amazon";
    if (label.includes("reliance")) return "reliance";
    if (label.includes("cliq")) return "tatacliq";

    const url = String(
      o.product_url ?? o.product_page_url ?? o.productUrl ?? o.url ??
        (o.input as Record<string, unknown> | undefined)?.url ?? "",
    );
    if (url.includes("flipkart.")) return "flipkart";
    if (url.includes("amazon.")) return "amazon";
    if (url.includes("reliancedigital.")) return "reliance";
    if (url.includes("tatacliq.")) return "tatacliq";
  }
  return "unknown";
}

async function readJsonArray(path: string): Promise<unknown[]> {
  const text = await Deno.readTextFile(path);
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    for (const key of ["products", "data", "results", "items"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return [];
}

export async function loadRun(paths: string[]): Promise<RawBatch[]> {
  const files: string[] = [];

  for (const p of paths) {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(p);
    } catch {
      throw new Error(`Replay path not found: ${p}`);
    }
    if (stat.isDirectory) {
      for await (const entry of Deno.readDir(p)) {
        if (
          entry.isFile && entry.name.endsWith(".json") &&
          entry.name !== "manifest.json"
        ) {
          files.push(`${p}/${entry.name}`);
        }
      }
    } else {
      files.push(p);
    }
  }

  const byPlatform = new Map<
    PlatformId,
    { items: unknown[]; errors: string[] }
  >();

  for (const f of files) {
    let items: unknown[];
    try {
      items = await readJsonArray(f);
    } catch (err) {
      throw new Error(
        `Could not parse ${f}: ${err instanceof Error ? err.message : err}`,
      );
    }
    const base = f.split("/").pop()!.replace(/\.json$/, "");
    const named =
      (["flipkart", "amazon", "reliance", "tatacliq"] as PlatformId[])
        .find((p) => base.startsWith(p));
    const platform = named ?? inferPlatform(items);

    const errors = items
      .filter((i) =>
        i && typeof i === "object" && (i as Record<string, unknown>).error
      )
      .map((i) => String((i as Record<string, unknown>).error));

    const bucket = byPlatform.get(platform);
    if (bucket) {
      bucket.items.push(...items);
      bucket.errors.push(...errors);
    } else {
      byPlatform.set(platform, { items: [...items], errors });
    }
  }

  return [...byPlatform.entries()].map(([platform, { items, errors }]) => {
    const usable = items.length - errors.length;
    return {
      platform,
      platformName: PLATFORM_NAMES[platform],
      items,
      status: usable > 0
        ? "ok" as const
        : errors.length
        ? "error" as const
        : "empty" as const,
      error: usable === 0 && errors.length ? errors[0] : undefined,
    };
  });
}

/** When was this run captured? Manifest timestamp, else file mtime. */
export async function capturedAtFor(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      const stat = await Deno.stat(p);
      if (stat.isDirectory) {
        try {
          const manifest = JSON.parse(
            await Deno.readTextFile(`${p}/manifest.json`),
          ) as { timestamp?: string; capturedAt?: string };
          // Older manifests said "capturedAt", saveRun says "timestamp".
          const ts = manifest.timestamp ?? manifest.capturedAt;
          if (ts) return ts;
        } catch {
          // No manifest. The directory mtime is a weaker but honest answer.
        }
      }
      return stat.mtime?.toISOString() ?? null;
    } catch {
      // Unreadable path; try the next one.
    }
  }
  return null;
}
