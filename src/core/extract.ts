import type { AnalyzedListing, Listing, Specs, SpecSource } from "./types.ts";
import { classify } from "./classify.ts";
import { lookupModel } from "../knowledge/models.ts";
import { matchSoc, matchSocDetailed, perfTier } from "../knowledge/soc.ts";

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
  ultraWideMp: null,
  teleMp: null,
  aperture: null,
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

const QUALIFIERS: Array<[RegExp, string]> = [
  [/\block(?:ed)?\s+with\s+([a-z]+)/i, "carrier-locked"],
  [/\brefurbish(?:ed)?\b/i, "refurbished"],
  [/\brenewed\b/i, "renewed"],
  [/\bopen\s*box\b/i, "open-box"],
  [/\bpre[-\s]?owned\b|\bsecond\s*hand\b/i, "pre-owned"],
  [/\bwith\s+offer\b|\bcombo\b/i, "bundle"],
];

export function detectQualifiers(title: string): string[] {
  const found: string[] = [];
  for (const [re, label] of QUALIFIERS) {
    if (re.test(title) && !found.includes(label)) found.push(label);
  }
  return found;
}

export function deriveModelKey(title: string): string {
  const qualifiers = detectQualifiers(title);

  // Amazon titles carry "| feature | feature" tails; left in, they become
  // part of the model key and break grouping.
  let head = title.split("|")[0];
  let cutAt = Infinity;
  for (const [re] of QUALIFIERS) {
    const m = head.match(re);
    if (m && m.index !== undefined && m.index < cutAt) cutAt = m.index;
  }
  if (cutAt !== Infinity) head = head.slice(0, cutAt);

  let t = head.toLowerCase();
  // Model numbers hide inside parens too: "Nothing Phone (4a)" is not the
  // same phone as plain "Nothing Phone", yet the blanket strip below eats
  // "(4a)" like it ate colours. Rescue digit+letter tags first - they are
  // never configs (those carry GB) and never "5G" (the g is excluded).
  const modelTags = [...head.matchAll(/\((\d{1,2}[a-fh-z])\)/gi)].map((m) =>
    m[1].toLowerCase()
  );
  t = t.replace(/\([^)]*\)/g, " ");
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
    if (out.length >= 2 && (COLOUR_WORDS.has(tok) || stop.has(tok))) break;
    if (out.length < 2 && stop.has(tok)) continue;
    out.push(tok);
    if (out.length >= 6) break;
  }
  // The rescued model number rides ahead of the colour tail: "Nothing
  // Phone (4a) (Blue...)" must key as "nothing phone 4a", not "nothing
  // phone", or every variant of the phone becomes a phantom product.
  for (let i = out.length - 1; i >= 0; i--) {
    if (!COLOUR_WORDS.has(out[i]) && !stop.has(out[i])) {
      out.splice(i + 1, 0, ...modelTags);
      break;
    }
  }

  const base = out.join(" ").trim();
  return qualifiers.length ? `${base} #${qualifiers.join("+")}` : base;
}

function num(m: RegExpMatchArray | null, i = 1): number | null {
  if (!m) return null;
  const n = Number.parseFloat(m[i]);
  return Number.isFinite(n) ? n : null;
}

function matchNear(
  text: string,
  value: RegExp,
  context: RegExp,
  window = 60,
): RegExpMatchArray | null {
  const re = new RegExp(
    value.source,
    value.flags.includes("g") ? value.flags : `${value.flags}g`,
  );
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    const around = text.slice(
      Math.max(0, at - window),
      at + m[0].length + window,
    );
    if (context.test(around)) return m;
  }
  return null;
}

const DISPLAY_CONTEXT =
  /display|screen|panel|refresh|resolution|nits|inch|touch|hd\+|fhd/i;
const CHARGING_CONTEXT =
  /charg|charger|adapter|wired|fast\s*charge|watt|mah|battery/i;

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

  set("ramGb", num(text.match(/(\d+)\s*gb\s*ram/i)), "title");
  const plus = text.match(/\b(\d+)\s*\+\s*(\d+)\s*gb\b/i);
  if (plus) {
    set("ramGb", Number.parseInt(plus[1]), "title");
    set("storageGb", Number.parseInt(plus[2]), "title");
  }

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
  set(
    "chargingW",
    num(matchNear(text, /(\d{2,3})\s*w\b(?!\w)/i, CHARGING_CONTEXT, 40)),
    "title",
  );
  set("displayInches", num(text.match(/(\d\.\d{1,2})\s*(?:inch|")/i)), "title");
  set("refreshHz", num(text.match(/(\d{2,3})\s*hz/i)), "title");
  set("mainCameraMp", num(text.match(/(\d{2,3})\s*mp/i)), "title");

  // The camera ARRAY is where camera phones separate from the rest: a
  // 50MP+OIS main sensor is table stakes, a real telephoto is not. Rear
  // arrays read like "50 MP + 8 MP + 2 MP" or "108MP main + 8MP ultrawide".
  const mpValues = [...text.matchAll(/(\d{1,3})\s*mp\b/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 2 && n <= 250);
  if (mpValues.length > 1) {
    const extras = mpValues.slice(1);
    // Lens labels sit within a few words of their MP value; the gap must
    // not cross another "N MP" token, else "8MP ultrawide + 10MP telephoto"
    // reads 8 as the telephoto.
    const noSkip = String.raw`(?:(?!\d{1,2}\s*mp)[^\n]){0,24}`;
    const uwLabel = text.match(
      new RegExp(String.raw`(\d{1,2})\s*mp${noSkip}ultra\s*wide`, "i"),
    ) ?? text.match(
      new RegExp(String.raw`ultra\s*wide${noSkip}(\d{1,2})\s*mp`, "i"),
    );
    let uwValue: number | null = null;
    if (uwLabel) {
      uwValue = Number(uwLabel[1]);
      set("ultraWideMp", uwValue, "title");
    } else if (extras.length >= 2) {
      // Unlabelled premium array: the smallest lens is the ultrawide,
      // the macro/depth lenses are 2-5MP noise.
      const plausible = extras.filter((n) => n >= 8);
      if (plausible.length) {
        uwValue = Math.min(...plausible);
        set("ultraWideMp", uwValue, "title");
      }
    }
    if (/telephoto|periscope|\d\s*x\s*(optical|tele)/i.test(text)) {
      const teleLabel = text.match(
        new RegExp(
          String
            .raw`(\d{1,2})\s*mp${noSkip}(?:telephoto|periscope|optical zoom)`,
          "i",
        ),
      ) ?? text.match(
        new RegExp(
          String.raw`(?:telephoto|periscope)${noSkip}(\d{1,2})\s*mp`,
          "i",
        ),
      );
      // Only claim a telephoto MP we actually read; keyword alone stays null.
      const tele = teleLabel
        ? Number(teleLabel[1])
        : extras.findLast((n) => n >= 8 && n <= 64 && n !== uwValue);
      if (tele) set("teleMp", tele, "title");
    }
  }
  const fStop = text.match(/\bf\/\s*(\d\.\d)\b/i);
  if (fStop) {
    const a = Number(fStop[1]);
    if (a >= 1.0 && a <= 2.9) set("aperture", a, "title");
  }

  if (matchNear(text, /\bsuper\s*amoled\b|\bamoled\b/i, DISPLAY_CONTEXT)) {
    set("panel", "AMOLED", "title");
  } else if (matchNear(text, /\bp-?oled\b/i, DISPLAY_CONTEXT)) {
    set("panel", "pOLED", "title");
  } else if (matchNear(text, /\bpls\b/i, DISPLAY_CONTEXT)) {
    set("panel", "PLS LCD", "title");
  } else if (matchNear(text, /\bips\b/i, DISPLAY_CONTEXT)) {
    set("panel", "IPS LCD", "title");
  } else if (matchNear(text, /\blcd\b/i, DISPLAY_CONTEXT)) {
    set("panel", "TFT LCD", "title");
  }

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

  const antutuClaim = text.match(/antutu\s*:?\s*(\d{2,4})\s*k\b/i) ??
    text.match(/antutu\s*:?\s*(\d{5,7})\b/i);
  if (antutuClaim) {
    const raw = Number.parseInt(antutuClaim[1]);
    const value = raw < 10000 ? raw * 1000 : raw;
    if (value > 50_000 && value < 3_000_000) {
      set("antutu", value, "title");
      set("perfTier", perfTier(value), "title");
    }
  }

  plausible(specs);

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
  enrichText?: Map<string, string>;
  externalSpecs?: Map<string, Partial<Specs>>;
}

function plausible(specs: Partial<Specs>): void {
  const drop = <K extends keyof Specs>(k: K) => {
    delete specs[k];
  };

  if (
    specs.batteryMah != null &&
    (specs.batteryMah < 1500 || specs.batteryMah > 12000)
  ) {
    drop("batteryMah");
  }
  if (
    specs.chargingW != null && (specs.chargingW < 5 || specs.chargingW > 300)
  ) {
    drop("chargingW");
  }
  if (specs.ramGb != null && (specs.ramGb < 1 || specs.ramGb > 24)) {
    drop("ramGb");
  }
  if (specs.storageGb != null && specs.storageGb < 8) drop("storageGb");
  if (
    specs.mainCameraMp != null &&
    (specs.mainCameraMp < 2 || specs.mainCameraMp > 250)
  ) {
    drop("mainCameraMp");
  }
  if (
    specs.ultraWideMp != null &&
    (specs.ultraWideMp < 8 || specs.ultraWideMp > 64)
  ) {
    drop("ultraWideMp");
  }
  if (specs.teleMp != null && (specs.teleMp < 8 || specs.teleMp > 64)) {
    drop("teleMp");
  }
  if (
    specs.refreshHz != null &&
    ![60, 90, 120, 144, 165, 180].includes(specs.refreshHz)
  ) {
    drop("refreshHz");
  }

  if (specs.displayInches != null && specs.displayInches < 4.5) {
    drop("displayInches");
    drop("refreshHz");
    drop("resolution");
    drop("panel");
    drop("has5g");
    drop("ois");
  }
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

  const external = opts.externalSpecs?.get(listing.id);
  if (external) {
    const srcs: Partial<Record<keyof Specs, SpecSource>> = {};
    for (const k of Object.keys(external) as Array<keyof Specs>) {
      srcs[k] = "gsmarena";
    }
    apply(external, srcs, true);
  }

  const kbPreview = lookupModel(listing.title) ?? lookupModel(slugText);
  const kbIsTrusted = kbPreview?.confidence === "high";

  const kbSpecsFor = (kb: NonNullable<typeof kbPreview>): Partial<Specs> => ({
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
  });

  if (kbPreview && kbIsTrusted) {
    apply(kbSpecsFor(kbPreview), {}, false);
  }
  if (enrich) {
    const e = specsFromText(enrich);
    for (const k of Object.keys(e.sources) as Array<keyof Specs>) {
      e.sources[k] = "enrich";
    }
    if (e.specs.socName && kbPreview?.soc && kbPreview.confidence === "high") {
      const detail = matchSocDetailed(enrich);
      if (detail?.ambiguous && detail.soc.name !== kbPreview.soc) {
        delete e.specs.socName;
        delete e.specs.antutu;
        delete e.specs.perfTier;
      }
    }
    // Only overwrite when nothing more trustworthy has spoken: a verified
    // external source, or a high-confidence KB entry applied just above.
    apply(e.specs, e.sources, external || kbIsTrusted ? false : true);
  }

  const modelKey = deriveModelKey(listing.title);
  const kb = kbPreview;
  if (kb) {
    // A trusted entry was already applied above, before the page got a turn.
    if (!kbIsTrusted) apply(kbSpecsFor(kb), {}, false);
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

  const t = specsFromText(fullText);
  apply(t.specs, t.sources, false);

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

export function cleanModelName(title: string): string {
  let t = title.replace(/\s+/g, " ").trim();
  t = t.replace(/\s*\|\s*.*$/, "");
  t = t.replace(/\s*[-–]\s*(with|includes|free|offer|combo).*$/i, "");
  if (t.length > 70) t = `${t.slice(0, 67).trimEnd()}…`;
  return t;
}
