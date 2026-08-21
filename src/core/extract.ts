/**
 * Spec extraction: title/slug parsing merged with the offline knowledge base.
 *
 * Precedence: enriched PDP data > knowledge base > title/slug regex > inferred.
 * Every field records where it came from so the UI can be honest about what is
 * measured vs. assumed.
 */

import type { AnalyzedListing, Listing, Specs, SpecSource } from "./types.ts";
import { classify } from "./classify.ts";
import { lookupModel } from "../knowledge/models.ts";
import { matchSoc, perfTier } from "../knowledge/soc.ts";

const EMPTY_SPECS: Specs = {
  ramGb: null,
  storageGb: null,
  batteryMah: null,
  chargingW: null,
  displayInches: null,
  refreshHz: null,
  panel: null,
  resolution: null,
  mainCameraMp: null,
  ois: null,
  has5g: null,
  ipRating: null,
  nfc: null,
  socName: null,
  antutu: null,
  perfTier: null,
  osUpgrades: null,
  releaseYear: null,
  colour: null,
};

export const BRANDS: Array<[RegExp, string]> = [
  [/\bsamsung\b/i, "Samsung"],
  [/\bapple\b|\biphone\b/i, "Apple"],
  [/\bpoco\b/i, "POCO"],
  [/\bredmi\b/i, "Xiaomi"],
  [/\bxiaomi\b|\bmi\b(?!\w)/i, "Xiaomi"],
  [/\boneplus\b/i, "OnePlus"],
  [/\brealme\b|\bnarzo\b/i, "realme"],
  [/\biqoo\b/i, "iQOO"],
  [/\bvivo\b/i, "vivo"],
  [/\boppo\b/i, "OPPO"],
  [/\bmotorola\b|\bmoto\s+[ge]\d/i, "Motorola"],
  [/\bnothing\b/i, "Nothing"],
  [/\bgoogle\b|\bpixel\b/i, "Google"],
  [/\binfinix\b/i, "Infinix"],
  [/\btecno\b/i, "Tecno"],
  [/\blava\b/i, "LAVA"],
  [/\bitel\b/i, "itel"],
  [/\bnokia\b/i, "Nokia"],
  [/\bhonor\b/i, "Honor"],
  [/\bsony\b/i, "Sony"],
  [/\bjbl\b/i, "JBL"],
  [/\bboat\b/i, "boAt"],
  [/\bnoise\b/i, "Noise"],
  [/\bbose\b/i, "Bose"],
  [/\bai\+|\bai\s*\+/i, "Ai+"],
];

export function detectBrand(text: string): string | null {
  for (const [re, name] of BRANDS) {
    if (re.test(text)) return name;
  }
  return null;
}

/** Colour words and their modifiers. In Indian listings the model name always
 * ends where the colour begins, so these act as a truncation point. */
const COLOUR_WORDS = new Set([
  "black",
  "white",
  "blue",
  "green",
  "gold",
  "silver",
  "grey",
  "gray",
  "purple",
  "pink",
  "red",
  "orange",
  "titanium",
  "graphite",
  "midnight",
  "starlight",
  "aqua",
  "ocean",
  "sunset",
  "lavender",
  "mint",
  "cyan",
  "beige",
  "bronze",
  "charcoal",
  "emerald",
  "sage",
  "thunder",
  "glacier",
  "obsidian",
  "ivory",
  "marble",
  "frost",
  "storm",
  "sand",
  "olive",
  "teal",
  "amber",
  "coral",
  "siachen",
  "satin",
  "matte",
  "glossy",
  "twilight",
  "shadow",
  "phantom",
  "cosmic",
  "galaxy",
  "nebula",
  "azure",
  "crystal",
  "pearl",
  "sapphire",
  "ruby",
  "jade",
  "onyx",
  "steel",
  "carbon",
  "desert",
  "forest",
  "sky",
  "iris",
  "violet",
  "lime",
  "peach",
  "cream",
  "khaki",
  "navy",
  "denim",
  "chrome",
  "prism",
  "aurora",
  "dusk",
  "dawn",
  "moon",
  "star",
  "rose",
  "bliss",
  "breeze",
  "wave",
  "mist",
  "glow",
  "shine",
  "spark",
  "flame",
  "enchanted",
  "electric",
  "royal",
  "deep",
  "light",
  "dark",
  "pure",
  "soft",
]);

/** Words that mark a materially different SKU, not a colour. */
const QUALIFIERS: Array<[RegExp, string]> = [
  [/\block(?:ed)?\s+with\s+([a-z]+)/i, "carrier-locked"],
  [/\brefurbish(?:ed)?\b/i, "refurbished"],
  [/\brenewed\b/i, "renewed"],
  [/\bopen\s*box\b/i, "open-box"],
  [/\bpre[-\s]?owned\b|\bsecond\s*hand\b/i, "pre-owned"],
  [/\bwith\s+offer\b|\bcombo\b/i, "bundle"],
];

/** SKU qualifiers that must be surfaced to the buyer, not silently merged. */
export function detectQualifiers(title: string): string[] {
  const found: string[] = [];
  for (const [re, label] of QUALIFIERS) {
    if (re.test(title) && !found.includes(label)) found.push(label);
  }
  return found;
}

/**
 * Strip colour/config noise to get a stable model identity.
 *
 *   "POCO M7 5G (Ocean Blue, 128 GB) (8 GB RAM)"        -> "poco m7 5g"
 *   "POCO M7 5G Satin Black 128 GB"        (from slug)  -> "poco m7 5g"
 *   "POCO M7 5G - Locked with Airtel Prepaid (Mint...)" -> "poco m7 5g #carrier-locked"
 *
 * The last case matters: a carrier-locked SKU is cheaper for a reason and must
 * never be merged into the unlocked phone's offer list.
 */
export function deriveModelKey(title: string): string {
  const qualifiers = detectQualifiers(title);

  // Everything after a qualifier ("- Locked with Airtel Prepaid ...") is SKU
  // boilerplate that varies card to card; cutting there keeps the key stable.
  let head = title;
  let cutAt = Infinity;
  for (const [re] of QUALIFIERS) {
    const m = title.match(re);
    if (m && m.index !== undefined && m.index < cutAt) cutAt = m.index;
  }
  if (cutAt !== Infinity) head = title.slice(0, cutAt);

  let t = head.toLowerCase();
  t = t.replace(/\([^)]*\)/g, " "); // drop parenthesised colour/config groups
  t = t.replace(/\b\d+\s*(gb|tb)\b\s*(ram|rom|storage)?/g, " ");
  t = t.replace(/[^a-z0-9+\s]/g, " ").replace(/\s+/g, " ").trim();

  const stop = new Set([
    "with",
    "and",
    "includes",
    "include",
    "free",
    "offer",
    "combo",
    "exchange",
    "upto",
    "up",
    "to",
    "for",
    "new",
    "latest",
    "smartphone",
    "mobile",
    "phone",
  ]);

  const out: string[] = [];
  for (const tok of t.split(" ")) {
    if (!tok) continue;
    // Truncate at the first colour word or filler, but only once we have a
    // plausible model name (brand + at least one model token).
    if (out.length >= 2 && (COLOUR_WORDS.has(tok) || stop.has(tok))) break;
    if (out.length < 2 && stop.has(tok)) continue;
    out.push(tok);
    if (out.length >= 6) break;
  }

  const base = out.join(" ").trim();
  return qualifiers.length ? `${base} #${qualifiers.join("+")}` : base;
}

function num(m: RegExpMatchArray | null, i = 1): number | null {
  if (!m) return null;
  const n = Number.parseFloat(m[i]);
  return Number.isFinite(n) ? n : null;
}

/** Parse whatever specs the listing text exposes. */
export function specsFromText(text: string): {
  specs: Partial<Specs>;
  sources: Partial<Record<keyof Specs, SpecSource>>;
} {
  const specs: Partial<Specs> = {};
  const sources: Partial<Record<keyof Specs, SpecSource>> = {};
  const set = <K extends keyof Specs>(
    k: K,
    v: Specs[K] | null,
    src: SpecSource,
  ) => {
    if (v !== null && v !== undefined && specs[k] === undefined) {
      specs[k] = v;
      sources[k] = src;
    }
  };

  // RAM: "(8 GB RAM)" or "8GB RAM" or "8+128"
  set("ramGb", num(text.match(/(\d+)\s*gb\s*ram/i)), "title");
  const plus = text.match(/\b(\d+)\s*\+\s*(\d+)\s*gb\b/i);
  if (plus) {
    set("ramGb", Number.parseInt(plus[1]), "title");
    set("storageGb", Number.parseInt(plus[2]), "title");
  }

  // Storage: "(Colour, 128 GB)" — the second capture of the config group.
  const cfg = text.match(/\(\s*[^,()]+,\s*(\d+)\s*(gb|tb)\s*\)/i);
  if (cfg) {
    const v = Number.parseInt(cfg[1]) *
      (cfg[2].toLowerCase() === "tb" ? 1024 : 1);
    set("storageGb", v, "title");
  }
  const storeExplicit = text.match(
    /(\d+)\s*(gb|tb)\s*(?:rom|storage|internal)/i,
  );
  if (storeExplicit) {
    set(
      "storageGb",
      Number.parseInt(storeExplicit[1]) *
        (storeExplicit[2].toLowerCase() === "tb" ? 1024 : 1),
      "title",
    );
  }

  set("batteryMah", num(text.match(/(\d{4,5})\s*mah/i)), "title");
  set("chargingW", num(text.match(/(\d{2,3})\s*w\b(?!\w)/i)), "title");
  set("displayInches", num(text.match(/(\d\.\d{1,2})\s*(?:inch|")/i)), "title");
  set("refreshHz", num(text.match(/(\d{2,3})\s*hz/i)), "title");
  set("mainCameraMp", num(text.match(/(\d{2,3})\s*mp/i)), "title");

  if (/\bamoled\b|\bsuper\s*amoled\b/i.test(text)) {
    set("panel", "AMOLED", "title");
  } else if (/\bp-?oled\b/i.test(text)) set("panel", "pOLED", "title");
  else if (/\bips\b/i.test(text)) set("panel", "IPS LCD", "title");
  else if (/\blcd\b/i.test(text)) set("panel", "TFT LCD", "title");

  if (/\bfhd\+?\b|\bfull\s*hd\b|1080/i.test(text)) {
    set("resolution", "FHD+", "title");
  } else if (/\bhd\+?\b|\b720\b/i.test(text)) set("resolution", "HD+", "title");

  if (/\b5g\b/i.test(text)) set("has5g", true, "title");
  const ip = text.match(/\bip(?:x)?(\d{2})\b/i);
  if (ip) set("ipRating", `IP${ip[1]}`, "title");
  if (/\bois\b|optical\s*image\s*stabili/i.test(text)) {
    set("ois", true, "title");
  }
  if (/\bnfc\b/i.test(text)) set("nfc", true, "title");

  const colour = text.match(
    /\(\s*([A-Za-z][A-Za-z\s]{2,20}?)\s*,\s*\d+\s*[GT]B/,
  );
  if (colour) set("colour", colour[1].trim(), "title");

  const soc = matchSoc(text);
  if (soc) {
    set("socName", soc.name, "title");
    set("antutu", soc.antutu, "title");
    set("perfTier", perfTier(soc.antutu), "title");
    if (soc.has5g) set("has5g", true, "inferred");
  }

  return { specs, sources };
}

export interface AnalyzeOptions {
  /** Extra text per listing id from PDP enrichment. */
  enrichText?: Map<string, string>;
}

const SPEC_FIELDS_FOR_COMPLETENESS: Array<keyof Specs> = [
  "ramGb",
  "storageGb",
  "batteryMah",
  "chargingW",
  "displayInches",
  "refreshHz",
  "panel",
  "resolution",
  "mainCameraMp",
  "has5g",
  "socName",
];

export function analyze(
  listing: Listing,
  opts: AnalyzeOptions = {},
): AnalyzedListing {
  const enrich = opts.enrichText?.get(listing.id) ?? "";
  const slugText = listing.url.replace(/[-/_]/g, " ");
  const baseText = `${listing.title} ${slugText}`;
  const fullText = enrich ? `${listing.title} ${enrich} ${slugText}` : baseText;

  const cls = classify(listing.title, listing.url);
  const specs: Specs = { ...EMPTY_SPECS };
  const sources: Partial<Record<keyof Specs, SpecSource>> = {};

  const apply = (
    partial: Partial<Specs>,
    partialSources: Partial<Record<keyof Specs, SpecSource>>,
    override: boolean,
  ) => {
    for (
      const [k, v] of Object.entries(partial) as Array<[keyof Specs, unknown]>
    ) {
      if (v === null || v === undefined) continue;
      if (!override && specs[k] !== null) continue;
      // deno-lint-ignore no-explicit-any
      (specs as any)[k] = v;
      sources[k] = partialSources[k] ?? "kb";
    }
  };

  // 1. Enriched PDP text wins.
  if (enrich) {
    const e = specsFromText(enrich);
    for (const k of Object.keys(e.sources) as Array<keyof Specs>) {
      e.sources[k] = "enrich";
    }
    apply(e.specs, e.sources, true);
  }

  // 2. Knowledge base for the resolved model.
  const modelKey = deriveModelKey(listing.title);
  const kb = lookupModel(listing.title) ?? lookupModel(slugText);
  if (kb) {
    const kbSpecs: Partial<Specs> = {
      panel: kb.panel ?? null,
      displayInches: kb.inches ?? null,
      refreshHz: kb.refreshHz ?? null,
      resolution: kb.resolution ?? null,
      batteryMah: kb.batteryMah ?? null,
      chargingW: kb.chargingW ?? null,
      mainCameraMp: kb.mainCameraMp ?? null,
      ois: kb.ois ?? null,
      ipRating: kb.ipRating ?? null,
      nfc: kb.nfc ?? null,
      osUpgrades: kb.osUpgrades ?? null,
      releaseYear: kb.releaseYear ?? null,
      socName: kb.soc ?? null,
    };
    apply(kbSpecs, {}, false);
    if (kb.soc) {
      const soc = matchSoc(kb.soc);
      if (soc) {
        if (specs.antutu === null) {
          specs.antutu = soc.antutu;
          sources.antutu = "kb";
          specs.perfTier = perfTier(soc.antutu);
          sources.perfTier = "kb";
        }
        if (specs.has5g === null && soc.has5g) {
          specs.has5g = true;
          sources.has5g = "kb";
        }
      }
    }
  }

  // 3. Title / slug regex fills the rest.
  const t = specsFromText(fullText);
  apply(t.specs, t.sources, false);

  // 4. Cheap inferences.
  if (specs.has5g === null && /\b4g\b/i.test(listing.title)) {
    specs.has5g = false;
    sources.has5g = "title";
  }

  const known = SPEC_FIELDS_FOR_COMPLETENESS.filter((f) => specs[f] !== null);
  const specCompleteness = known.length / SPEC_FIELDS_FOR_COMPLETENESS.length;

  const brand = detectBrand(baseText);
  const configKey = `${specs.ramGb ?? "?"}r-${specs.storageGb ?? "?"}s`;

  return {
    ...listing,
    category: cls.category,
    categoryConfidence: cls.confidence,
    brand,
    modelKey: modelKey || null,
    modelName: kb?.display ?? cleanModelName(listing.title),
    configKey,
    specs,
    specSources: sources,
    specCompleteness: Math.round(specCompleteness * 100) / 100,
    kbConfidence: kb?.confidence ?? "none",
    rejected: [],
  };
}

/** Human-facing product name: drop the colour/marketing tail, keep config. */
export function cleanModelName(title: string): string {
  let t = title.replace(/\s+/g, " ").trim();
  t = t.replace(/\s*\|\s*.*$/, "");
  t = t.replace(/\s*[-–]\s*(with|includes|free|offer|combo).*$/i, "");
  if (t.length > 70) t = `${t.slice(0, 67).trimEnd()}…`;
  return t;
}
