import { fetchDirect, htmlToText } from "../lib/fetch-page.ts";
import type { ExternalSpecs } from "./spec-source.ts";

const BASE = "https://www.gsmarena.com";
const INDEX_PATH = "data/gsmarena-index.json";
const DELAY_MS = 1200;

export interface IndexEntry {
  name: string;
  brand: string;
  slug: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function normaliseModel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bmotorola\b/g, "moto")
    .replace(/\b(5g|4g|lte|dual sim|india)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

export async function loadIndex(path = INDEX_PATH): Promise<IndexEntry[]> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as IndexEntry[];
  } catch {
    return [];
  }
}

async function saveIndex(
  entries: IndexEntry[],
  path = INDEX_PATH,
): Promise<void> {
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir) await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(entries));
}

export function parseMakers(
  html: string,
): Array<{ brand: string; page: string }> {
  const out: Array<{ brand: string; page: string }> = [];
  const re =
    /href="([a-z0-9_.-]+-phones-\d+\.php)"[^>]*>\s*(?:<[^>]*>)*\s*([A-Za-z0-9+ .&'-]{2,20})/g;
  for (const m of html.matchAll(re)) {
    out.push({ brand: m[2].trim(), page: m[1] });
  }
  return out;
}

export function parseBrandPage(html: string, brand: string): IndexEntry[] {
  const out: IndexEntry[] = [];
  const re =
    /href="(?:https:\/\/www\.gsmarena\.com\/)?([a-z0-9_]+-\d+\.php)"[^>]*>(?:<[^>]+>)*\s*([^<]{2,44})/g;
  for (const m of html.matchAll(re)) {
    const name = m[2].replace(/\s+/g, " ").trim();
    if (!name || /^(home|news|reviews|compare|deals)$/i.test(name)) continue;
    out.push({ name, brand, slug: m[1] });
  }
  return out;
}

export interface BuildOptions {
  brands?: string[];
  pagesPerBrand?: number;
  path?: string;
  verbose?: boolean;
}

export async function buildIndex(
  opts: BuildOptions = {},
): Promise<IndexEntry[]> {
  const pages = opts.pagesPerBrand ?? 2;
  const wanted = (opts.brands ?? []).map((b) => b.toLowerCase());

  const makersHtml = await fetchDirect(`${BASE}/makers.php3`, 15000);
  let makers = parseMakers(makersHtml);
  if (wanted.length) {
    makers = makers.filter((m) => wanted.includes(m.brand.toLowerCase()));
  }

  const entries: IndexEntry[] = [];
  for (const maker of makers) {
    for (let p = 1; p <= pages; p++) {
      const url = p === 1
        ? `${BASE}/${maker.page}`
        : `${BASE}/${
          maker.page.replace(/-phones-(\d+)\.php/, `-phones-f-$1-0-p${p}.php`)
        }`;
      try {
        const html = await fetchDirect(url, 15000);
        const found = parseBrandPage(html, maker.brand);
        entries.push(...found);
        if (opts.verbose) {
          console.error(`    ${maker.brand} p${p}: ${found.length} models`);
        }
        if (found.length === 0) break;
      } catch {
        break;
      }
      await sleep(DELAY_MS);
    }
  }

  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    if (seen.has(e.slug)) return false;
    seen.add(e.slug);
    return true;
  });
  await saveIndex(unique, opts.path);
  return unique;
}

const BRAND_PARENT: Record<string, string> = {
  poco: "xiaomi",
  redmi: "xiaomi",
  iqoo: "vivo",
  cmf: "nothing",
  moto: "motorola",
};

export function resolveModel(
  modelName: string,
  brand: string | null,
  index: IndexEntry[],
): IndexEntry | null {
  const target = normaliseModel(modelName);
  if (target.length < 4) return null;

  const wantBrand = brand?.toLowerCase();
  const parent = wantBrand ? BRAND_PARENT[wantBrand] ?? wantBrand : null;
  const pool = parent
    ? index.filter((e) => e.brand.toLowerCase() === parent)
    : index;
  const candidates = pool.length ? pool : index;

  let exact: IndexEntry | null = null;
  const prefixed: IndexEntry[] = [];
  for (const e of candidates) {
    const n = normaliseModel(e.name);
    const withBrand = normaliseModel(`${e.brand} ${e.name}`);
    if (n === target || withBrand === target) {
      if (exact && exact.slug !== e.slug) return null;
      exact = e;
    } else if (target.startsWith(n) || n.startsWith(target)) {
      prefixed.push(e);
    }
  }
  if (exact) return exact;

  // No prefix fallback: it once resolved "Redmi Note 14 5G" to
  // "Redmi Note 14s" — a different phone with a different chipset.
  void prefixed;
  return null;
}

function num(m: RegExpMatchArray | null, i = 1): number | null {
  if (!m) return null;
  const n = Number.parseFloat(m[i]);
  return Number.isFinite(n) ? n : null;
}

export function parseSpecPage(text: string, url: string): ExternalSpecs | null {
  const title = text.match(
    /^\s*([\w+.\- ]{3,60})\s*-\s*Full phone specifications/im,
  )?.[1];

  const chipset = text.match(
    /Chipset\s+(?:Qualcomm\s+\w+\s+|Mediatek\s+|Google\s+|Samsung\s+|Unisoc\s+|Apple\s+)?([A-Za-z][\w+ .]{2,34}?)\s*\((\d+)\s*nm\)/i,
  );

  const displayType = text.match(
    /Display\s+Type\s+([A-Za-z+ ]{3,24}?)(?:,|\s+\d)/i,
  )?.[1]?.trim() ?? null;

  const panel = displayType
    ? /amoled/i.test(displayType)
      ? "AMOLED"
      : /oled/i.test(displayType)
      ? "pOLED"
      : /ips/i.test(displayType)
      ? "IPS LCD"
      : /tft|lcd/i.test(displayType)
      ? "TFT LCD"
      : null
    : null;

  const res = text.match(/Resolution\s+(\d{3,4})\s*x\s*(\d{3,4})/i);
  const resolution = res
    ? Number(res[1]) >= 1400 ? "QHD+" : Number(res[1]) >= 1000 ? "FHD+" : "HD+"
    : null;

  return {
    url,
    matchedName: title?.trim() ?? "",
    socName: chipset ? chipset[1].replace(/\s+/g, " ").trim() : null,
    nm: chipset ? Number(chipset[2]) : null,
    antutu: num(text.match(/AnTuTu:\s*(\d{4,7})/i)),
    geekbench: num(text.match(/GeekBench:\s*(\d{3,5})/i)),
    batteryMah: num(text.match(/(\d{4,5})\s*mAh/i)),
    chargingW: num(text.match(/Charging\s+(\d{1,3})W/i)),
    panel,
    inches: num(text.match(/Size\s+(\d\.\d{1,2})\s*inches/i)),
    refreshHz: num(text.match(/(\d{2,3})Hz(?!\s*PWM)/i)),
    resolution,
    mainCameraMp: num(text.match(/Main Camera[\s\S]{0,40}?(\d{1,3})\s*MP/i)),
    ois: /\bOIS\b/i.test(text),
    nfc: /NFC\s+Yes/i.test(text) ? true : /NFC\s+No/i.test(text) ? false : null,
    ipRating: text.match(/\b(IP[X0-9]{2,3})\b/i)?.[1]?.toUpperCase() ?? null,
    weightG: num(text.match(/Weight\s+(\d{2,3})(?:\.\d)?\s*g/i)),
  };
}

export class RateLimited extends Error {
  constructor() {
    super("gsmarena rate limit (HTTP 429)");
    this.name = "RateLimited";
  }
}

export async function fetchSpecs(
  entry: IndexEntry,
  expectedName: string,
  fetcher: (url: string) => Promise<string> = (u) => fetchDirect(u, 15000),
): Promise<ExternalSpecs | null> {
  const url = `${BASE}/${entry.slug}`;
  let html: string;
  try {
    html = await fetcher(url);
  } catch (err) {
    if (err instanceof Error && /\b429\b/.test(err.message)) {
      throw new RateLimited();
    }
    throw err;
  }
  const text = htmlToText(html);
  const specs = parseSpecPage(text, url);
  if (!specs) return null;

  const expected = normaliseModel(expectedName);
  const got = normaliseModel(specs.matchedName || entry.name);
  if (!got || (!got.includes(expected) && !expected.includes(got))) return null;

  return specs;
}
