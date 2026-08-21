/**
 * Beebom Gadgets as an external spec source.
 *
 * Why a second source at all: GSMArena has the better data but rate-limits
 * hard. In the 2026-08-21 live run it answered 4 models and then returned 429
 * for the rest of the run, which left 44 of 64 ranked phones showing "SoC ?".
 * Probing this host with ten back-to-back requests and no delay returned ten
 * 200s, and it covers the Indian budget shelf that GSMArena indexes late —
 * itel Zeno 200, Lava Bold N2, Redmi A7 Pro all resolved.
 *
 * Its pages carry a per-phone AnTuTu figure inside the chipset string
 * ("MediaTek Dimensity 6300 (6 nm), 560000 Antutu Score"), so this is a real
 * benchmark for that handset rather than our own per-chip approximation.
 *
 * Still a courtesy guest: the caller paces requests, and results are cached
 * permanently because a phone's spec sheet does not change.
 */

import { fetchDirect } from "../lib/fetch-page.ts";
import type { ExternalSpecs } from "./spec-source.ts";

const BASE = "https://gadgets.beebom.com/mobile";

/**
 * Brand words as this host slugs them. Marketplaces write "MOTOROLA g45 5G";
 * the host wants "moto-g45-5g", and "motorola-g45-5g" is a 404 — measured,
 * not assumed.
 */
const BRAND_SLUG: Record<string, string> = {
  motorola: "moto",
  xiaomi: "redmi",
  "mi": "redmi",
};

/** Words that are marketing, not part of the model name. */
const NOISE =
  /\b(dual sim|india|smartphone|mobile phone|with|free|offer|new|latest)\b/g;

/**
 * Candidate slugs in the order worth trying. The first that returns a page
 * with a chipset wins; a 404 is cheap and there are at most three of them.
 */
export function beebomSlugs(model: string, brand?: string): string[] {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(NOISE, " ")
      // Drop the trailing config the marketplace appended: "(8GB/128GB)".
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
  // As written, with the brand word swapped for the one this host uses.
  out.add(brandWord ? base.replace(head, brandWord) : base);
  out.add(base);
  // Prefixed with the brand when the model name omits it ("narzo 90x").
  if (brand) {
    const b = BRAND_SLUG[brand.toLowerCase()] ?? clean(brand);
    if (b && !base.startsWith(b)) out.add(`${b}-${base}`);
  }
  // Without the trailing radio suffix — some entries are keyed without it.
  const noRadio = base.replace(/-(5g|4g|lte)$/, "");
  if (noRadio !== base) {
    out.add(brandWord ? noRadio.replace(head, brandWord) : noRadio);
  }

  return [...out].filter(Boolean).slice(0, 4);
}

/**
 * Every `name`/`value` pair on the page, from both encodings it uses: the
 * island props (`"name":[0,"Chipset"],"value":[0,"..."]`) and the JSON-LD
 * product block (`{"name":"Processor","value":"..."}`). Reading both means a
 * change to either one degrades rather than breaks.
 */
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

  // Top-level rows are `"name":[0,"Chipset"],"value":[0,"..."]`; nested rows
  // slip a `displayName` in between and key themselves in kebab-case
  // (`"name":[0,"display-type"],"displayName":[0,"Display Type"]`). Register
  // both spellings so callers can ask for either.
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

/** Fold the host's panel wording into the vocabulary the ranker scores on. */
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

  // "MediaTek Dimensity 6300 (6 nm), 560000 Antutu Score"
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
    // A per-phone measurement published by the source, not our per-chip table.
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

/**
 * Try the candidate slugs until one yields a chipset. Returns null rather
 * than throwing on a miss: a phone this host has never heard of is a normal
 * outcome, not an error, and the caller falls back to the knowledge base.
 */
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
      continue; // 404s are expected while probing slugs
    }
    const parsed = parseBeebomPage(html, url, slug);
    if (parsed?.socName) return parsed;
  }
  return null;
}
