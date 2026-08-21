import { fetchDirect } from "../lib/fetch-page.ts";
import type { ExternalSpecs } from "./spec-source.ts";

const BASE = "https://gadgets.beebom.com/mobile";

const BRAND_SLUG: Record<string, string> = {
  motorola: "moto",
  xiaomi: "redmi",
  "mi": "redmi",
};

const NOISE =
  /\b(dual sim|india|smartphone|mobile phone|with|free|offer|new|latest)\b/g;

export function beebomSlugs(model: string, brand?: string): string[] {
  const clean = (s: string) =>
    s
      .toLowerCase()
      // "Pro+" and "Pro" are different phones; stripping the plus once
      // attached a Snapdragon 7s Gen 2 to a Dimensity 7200 handset.
      .replace(/\+/g, " plus ")
      .replace(NOISE, " ")
      .replace(/\((?:[^)]*)\)/g, " ")
      .replace(/\b\d+\s*gb\b/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");

  const base = clean(model);
  if (!base) return [];

  const head = base.split("-")[0];
  const brandWord = BRAND_SLUG[head] ?? BRAND_SLUG[(brand ?? "").toLowerCase()];

  const out = new Set<string>();
  out.add(brandWord ? base.replace(head, brandWord) : base);
  out.add(base);
  if (brand) {
    const b = BRAND_SLUG[brand.toLowerCase()] ?? clean(brand);
    if (b && !base.startsWith(b)) out.add(`${b}-${base}`);
  }
  const noRadio = base.replace(/-(5g|4g|lte)$/, "");
  if (noRadio !== base) {
    out.add(brandWord ? noRadio.replace(head, brandWord) : noRadio);
  }

  return [...out].filter(Boolean).slice(0, 4);
}

export function beebomFields(html: string): Map<string, string> {
  const text = html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'");
  const out = new Map<string, string>();
  const add = (k: string, v: string) => {
    const key = k.trim().toLowerCase();
    const val = v.trim();
    if (key && val && !out.has(key)) out.set(key, val);
  };

  for (
    const m of text.matchAll(
      /"name":\s*\[0,\s*"([^"]{2,40})"\]\s*(?:,\s*"displayName":\s*\[0,\s*"([^"]{0,40})"\]\s*)?,\s*"value":\s*\[0,\s*"([^"]{1,200})"\]/g,
    )
  ) {
    add(m[1], m[3]);
    if (m[2]) add(m[2], m[3]);
  }

  for (
    const m of text.matchAll(
      /"name":\s*"([^"]{2,40})"\s*,\s*"value":\s*"([^"]{1,200})"/g,
    )
  ) add(m[1], m[2]);

  return out;
}

const num = (m: RegExpMatchArray | null): number | null =>
  m ? Number(m[1].replace(/,/g, "")) : null;

function panelOf(displayType: string | undefined): string | null {
  if (!displayType) return null;
  const t = displayType.toLowerCase();
  if (t.includes("super amoled")) return "AMOLED";
  if (t.includes("amoled") || t.includes("oled")) return "AMOLED";
  if (t.includes("pls")) return "PLS LCD";
  if (t.includes("ips")) return "IPS LCD";
  if (t.includes("tft")) return "TFT LCD";
  if (t.includes("lcd")) return "LCD";
  return null;
}

function identity(s: string): string {
  return s
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/\bmotorola\b/g, "moto")
    .replace(/\b(5g|4g|lte|dual sim|india|smartphone)\b/g, " ")
    .replace(/\((?:[^)]*)\)/g, " ")
    .replace(/\b\d+\s*gb\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

export function nameMatches(
  model: string,
  html: string,
  slug: string,
): boolean {
  const want = identity(model);
  if (!want) return false;
  const title = html.match(/<title[^>]*>([^<]{3,120})</i)?.[1] ??
    html.match(/"name":\s*"([^"]{3,80})"/)?.[1] ?? slug;
  const got = identity(title);
  return got.includes(want) || want.includes(got) || identity(slug) === want;
}

export interface MarketPrice {
  low: number;
  high: number;
  url: string;
}

export function parseBeebomPrices(
  html: string,
  url: string,
): MarketPrice | null {
  const t = html.replace(/&quot;/g, '"');
  const m = t.match(/"lowPrice":\s*(\d{3,7})\s*,\s*"highPrice":\s*(\d{3,7})/);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  if (!low || !high || low > high) return null;
  return { low, high, url };
}

export function parseBeebomPage(
  html: string,
  url: string,
  matchedName: string,
): ExternalSpecs | null {
  const f = beebomFields(html);
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = f.get(k);
      if (v) return v;
    }
    return undefined;
  };

  const chipRaw = get("chipset", "processor");
  if (!chipRaw) return null;

  const socName = chipRaw
    .replace(/\(.*?\)/g, " ")
    .replace(/,?\s*[\d,]{4,9}\s*antutu\s*score/i, " ")
    .replace(/\s+/g, " ")
    .trim() || null;

  const battery = get("battery");
  const display = get("display", "display size");
  const camera = get("rear camera", "primary camera");
  const ip = get("ip rating");
  const nfcRaw = get("nfc");

  return {
    url,
    matchedName,
    socName,
    nm: num(chipRaw.match(/(\d+)\s*nm/i)),
    antutu: num(chipRaw.match(/([\d,]{5,9})\s*antutu/i)),
    geekbench: null,
    batteryMah: num(battery?.match(/([\d,]{4,5})\s*mah/i) ?? null),
    chargingW: num(
      (battery ?? "").match(/([\d.]{1,3})\s*(?:w\b|watt)/i) ??
        (get("charging", "charging speed") ?? "").match(
          /([\d.]{1,3})\s*(?:w\b|watt)/i,
        ),
    ),
    panel: panelOf(get("display type", "display-type", "screen type")),
    inches: num(display?.match(/([\d.]{3,4})\s*inch/i) ?? null),
    refreshHz: num(
      get("refresh rate", "refresh-rate")?.match(/(\d{2,3})\s*hz/i) ?? null,
    ),
    resolution: /qhd/i.test(get("resolution", "display-resolution") ?? "")
      ? "QHD+"
      : /fhd/i.test(get("resolution", "display-resolution") ?? "")
      ? "FHD+"
      : /hd/i.test(get("resolution", "display-resolution") ?? "")
      ? "HD+"
      : null,
    mainCameraMp: num(camera?.match(/([\d.]{1,3})\s*mp/i) ?? null),
    ois: /\bois\b|optical image stabili/i.test(
      `${camera ?? ""} ${get("image stabilization") ?? ""}`,
    ),
    nfc: nfcRaw ? !/^no\b/i.test(nfcRaw) : null,
    ipRating: ip?.match(/(IP[0-9X]{2})/i)?.[1]?.toUpperCase() ?? null,
    weightG: num(get("weight")?.match(/([\d.]{2,5})\s*g(?:ram)?/i) ?? null),
  };
}

export async function fetchBeebom(
  model: string,
  brand?: string,
  fetcher: (url: string) => Promise<string> = (u) => fetchDirect(u, 15000),
): Promise<{ specs: ExternalSpecs | null; market: MarketPrice | null }> {
  for (const slug of beebomSlugs(model, brand)) {
    const url = `${BASE}/${slug}`;
    let html: string;
    try {
      html = await fetcher(url);
    } catch {
      continue;
    }
    const parsed = parseBeebomPage(html, url, slug);
    if (!parsed?.socName) continue;
    if (!nameMatches(model, html, slug)) continue;
    return { specs: parsed, market: parseBeebomPrices(html, url) };
  }
  return { specs: null, market: null };
}

export async function fetchBeebomSpecs(
  model: string,
  brand?: string,
  fetcher: (url: string) => Promise<string> = (u) => fetchDirect(u, 15000),
): Promise<ExternalSpecs | null> {
  for (const slug of beebomSlugs(model, brand)) {
    const url = `${BASE}/${slug}`;
    let html: string;
    try {
      html = await fetcher(url);
    } catch {
      continue;
    }
    const parsed = parseBeebomPage(html, url, slug);
    if (!parsed?.socName) continue;
    if (!nameMatches(model, html, slug)) continue;
    return parsed;
  }
  return null;
}
