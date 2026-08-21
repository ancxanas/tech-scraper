/**
 * Offline SoC knowledge base.
 *
 * Values are AnTuTu **v11** / Geekbench 6 figures used for RELATIVE ranking
 * only.
 *
 * The version matters more than it looks. v10 and v11 differ by 20-45%, and
 * the gap is not a constant -- weaker chips drift furthest. A table holding
 * both versions therefore misranks every comparison that crosses the
 * boundary, which is a hardware-looking difference that no buyer could see
 * and no reviewer could reproduce. So the table is calibrated as a whole,
 * from one source, by `deno task calibrate`.
 *
 * Provenance: 51 entries read from that source's per-chip pages. Apple and
 * the Ultra/Pro MediaTek variants it does not list were converted using the
 * ratio observed on the calibrated chips nearest them. Unisoc's budget parts
 * are absent from it entirely and are measured off phones that use them
 * (T760 from the Moto G35, T8300 from the Redmi A7 Pro 5G) or bridged via
 * the Tiger T615, which two sources both publish. They are never presented as exact measurements — the UI shows
 * them as a performance tier plus an approximate index.
 *
 * `aliases` are matched case-insensitively against product titles, URL slugs
 * and enriched spec blobs. Longest alias wins, so put specific strings first.
 */

export interface SocEntry {
  /** Canonical display name. */
  name: string;
  vendor: "qualcomm" | "mediatek" | "samsung" | "apple" | "google" | "unisoc";
  /** Approximate AnTuTu v10 total score. */
  antutu: number;
  /** Approximate Geekbench 6 single / multi core. */
  gb6Single?: number;
  gb6Multi?: number;
  /** Fabrication node in nm — proxy for efficiency. */
  nm?: number;
  /** Launch year of the chip. */
  year: number;
  has5g: boolean;
  aliases: string[];
}

export const SOCS: SocEntry[] = [
  // ---------------------------------------------------------------- Qualcomm
  {
    name: "Snapdragon 8 Gen 3",
    vendor: "qualcomm",
    antutu: 2342433,
    gb6Single: 2200,
    gb6Multi: 6900,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["snapdragon 8 gen 3", "sd 8 gen 3", "8 gen 3"],
  },
  {
    name: "Snapdragon 8s Gen 3",
    vendor: "qualcomm",
    antutu: 1801694,
    gb6Single: 1800,
    gb6Multi: 4800,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["snapdragon 8s gen 3", "8s gen 3"],
  },
  {
    name: "Snapdragon 7+ Gen 3",
    vendor: "qualcomm",
    antutu: 1660394,
    gb6Single: 1780,
    gb6Multi: 4750,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["snapdragon 7+ gen 3", "7+ gen 3", "7 plus gen 3"],
  },
  {
    name: "Snapdragon 7s Gen 3",
    vendor: "qualcomm",
    antutu: 1040961,
    gb6Single: 1150,
    gb6Multi: 3050,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["snapdragon 7s gen 3", "7s gen 3"],
  },
  {
    name: "Snapdragon 7s Gen 2",
    vendor: "qualcomm",
    antutu: 794638,
    gb6Single: 1030,
    gb6Multi: 2900,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["snapdragon 7s gen 2", "7s gen 2"],
  },
  {
    name: "Snapdragon 6 Gen 3",
    vendor: "qualcomm",
    antutu: 840643,
    gb6Single: 1050,
    gb6Multi: 2950,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["snapdragon 6 gen 3", "6 gen 3"],
  },
  {
    name: "Snapdragon 6s Gen 3",
    vendor: "qualcomm",
    antutu: 622608,
    gb6Single: 900,
    gb6Multi: 2050,
    nm: 6,
    year: 2024,
    has5g: true,
    aliases: ["snapdragon 6s gen 3", "6s gen 3"],
  },
  {
    name: "Snapdragon 6 Gen 1",
    vendor: "qualcomm",
    antutu: 736675,
    gb6Single: 950,
    gb6Multi: 2750,
    nm: 4,
    year: 2022,
    has5g: true,
    aliases: ["snapdragon 6 gen 1", "6 gen 1"],
  },
  {
    name: "Snapdragon 4 Gen 2",
    vendor: "qualcomm",
    antutu: 560863,
    gb6Single: 900,
    gb6Multi: 2100,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["snapdragon 4 gen 2", "sd 4 gen 2", "4 gen 2"],
  },
  {
    name: "Snapdragon 4s Gen 2",
    vendor: "qualcomm",
    antutu: 506757,
    gb6Single: 850,
    gb6Multi: 1950,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["snapdragon 4s gen 2", "4s gen 2"],
  },
  {
    name: "Snapdragon 4 Gen 1",
    vendor: "qualcomm",
    antutu: 521686,
    gb6Single: 830,
    gb6Multi: 1900,
    nm: 6,
    year: 2022,
    has5g: true,
    aliases: ["snapdragon 4 gen 1", "4 gen 1"],
  },
  {
    name: "Snapdragon 695",
    vendor: "qualcomm",
    antutu: 592015,
    gb6Single: 900,
    gb6Multi: 2000,
    nm: 6,
    year: 2021,
    has5g: true,
    aliases: ["snapdragon 695", "sd 695", "sm6375"],
  },
  {
    name: "Snapdragon 685",
    vendor: "qualcomm",
    antutu: 467392,
    gb6Single: 720,
    gb6Multi: 1750,
    nm: 6,
    year: 2023,
    has5g: false,
    aliases: ["snapdragon 685", "sd 685"],
  },
  {
    name: "Snapdragon 680",
    vendor: "qualcomm",
    antutu: 421228,
    gb6Single: 680,
    gb6Multi: 1650,
    nm: 6,
    year: 2021,
    has5g: false,
    aliases: ["snapdragon 680", "sd 680"],
  },
  {
    name: "Snapdragon 662",
    vendor: "qualcomm",
    antutu: 320666,
    gb6Single: 450,
    gb6Multi: 1400,
    nm: 11,
    year: 2020,
    has5g: false,
    aliases: ["snapdragon 662", "sd 662"],
  },

  // ---------------------------------------------------------------- MediaTek
  {
    name: "Dimensity 9300",
    vendor: "mediatek",
    antutu: 2415558,
    gb6Single: 2200,
    gb6Multi: 7300,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["dimensity 9300"],
  },
  {
    name: "Dimensity 8400",
    vendor: "mediatek",
    antutu: 1940768,
    gb6Single: 1450,
    gb6Multi: 6100,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["dimensity 8400"],
  },
  {
    name: "Dimensity 8300",
    vendor: "mediatek",
    antutu: 1600704,
    gb6Single: 1450,
    gb6Multi: 4500,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["dimensity 8300"],
  },
  {
    name: "Dimensity 8200",
    vendor: "mediatek",
    antutu: 1221748,
    gb6Single: 1250,
    gb6Multi: 3900,
    nm: 4,
    year: 2022,
    has5g: true,
    aliases: ["dimensity 8200"],
  },
  {
    name: "Dimensity 7400",
    vendor: "mediatek",
    antutu: 956756,
    gb6Single: 1080,
    gb6Multi: 2950,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["dimensity 7400"],
  },
  {
    name: "Dimensity 7300",
    vendor: "mediatek",
    antutu: 877641,
    gb6Single: 1050,
    gb6Multi: 2900,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["dimensity 7300"],
  },
  {
    name: "Dimensity 7050",
    vendor: "mediatek",
    antutu: 806012,
    gb6Single: 970,
    gb6Multi: 2350,
    nm: 6,
    year: 2023,
    has5g: true,
    aliases: ["dimensity 7050"],
  },
  {
    name: "Dimensity 7025",
    vendor: "mediatek",
    antutu: 668462,
    gb6Single: 800,
    gb6Multi: 2050,
    nm: 6,
    year: 2024,
    has5g: true,
    aliases: ["dimensity 7025", "dimensity 7020"],
  },
  {
    name: "Dimensity 6400",
    vendor: "mediatek",
    antutu: 550018,
    gb6Single: 800,
    gb6Multi: 2050,
    nm: 6,
    year: 2025,
    has5g: true,
    aliases: ["dimensity 6400"],
  },
  {
    name: "Dimensity 6300",
    vendor: "mediatek",
    antutu: 524785,
    gb6Single: 780,
    gb6Multi: 2000,
    nm: 6,
    year: 2024,
    has5g: true,
    aliases: ["dimensity 6300"],
  },
  {
    name: "Dimensity 6100+",
    vendor: "mediatek",
    antutu: 513809,
    gb6Single: 740,
    gb6Multi: 1950,
    nm: 6,
    year: 2023,
    has5g: true,
    aliases: ["dimensity 6100+", "dimensity 6100 plus", "dimensity 6100"],
  },
  {
    name: "Dimensity 6020",
    vendor: "mediatek",
    antutu: 530583,
    gb6Single: 700,
    gb6Multi: 1850,
    nm: 7,
    year: 2022,
    has5g: true,
    aliases: ["dimensity 6020"],
  },
  {
    name: "Helio G100",
    vendor: "mediatek",
    antutu: 576015,
    gb6Single: 740,
    gb6Multi: 1950,
    nm: 6,
    year: 2024,
    has5g: false,
    aliases: ["helio g100", "g100"],
  },
  {
    name: "Helio G99",
    vendor: "mediatek",
    antutu: 552286,
    gb6Single: 730,
    gb6Multi: 1900,
    nm: 6,
    year: 2022,
    has5g: false,
    aliases: ["helio g99", "g99"],
  },
  {
    name: "Helio G91",
    vendor: "mediatek",
    antutu: 361872,
    gb6Single: 530,
    gb6Multi: 1450,
    nm: 12,
    year: 2023,
    has5g: false,
    aliases: ["helio g91", "g91"],
  },
  {
    name: "Helio G85",
    vendor: "mediatek",
    antutu: 346495,
    gb6Single: 520,
    gb6Multi: 1450,
    nm: 12,
    year: 2020,
    has5g: false,
    aliases: ["helio g85", "g85"],
  },
  {
    name: "Helio G81",
    vendor: "mediatek",
    antutu: 358383,
    gb6Single: 500,
    gb6Multi: 1400,
    nm: 12,
    year: 2024,
    has5g: false,
    aliases: ["helio g81", "g81"],
  },

  // ----------------------------------------------------------------- Samsung
  {
    name: "Exynos 1580",
    vendor: "samsung",
    antutu: 1250625,
    gb6Single: 1350,
    gb6Multi: 3900,
    nm: 4,
    year: 2025,
    has5g: true,
    aliases: ["exynos 1580"],
  },
  {
    name: "Exynos 1480",
    vendor: "samsung",
    antutu: 1031048,
    gb6Single: 1200,
    gb6Multi: 3400,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["exynos 1480"],
  },
  {
    name: "Exynos 1380",
    vendor: "samsung",
    antutu: 768212,
    gb6Single: 1050,
    gb6Multi: 3000,
    nm: 5,
    year: 2023,
    has5g: true,
    aliases: ["exynos 1380"],
  },
  {
    name: "Exynos 1330",
    vendor: "samsung",
    antutu: 607137,
    gb6Single: 880,
    gb6Multi: 2050,
    nm: 5,
    year: 2023,
    has5g: true,
    aliases: ["exynos 1330"],
  },
  {
    name: "Exynos 1280",
    vendor: "samsung",
    antutu: 613957,
    gb6Single: 830,
    gb6Multi: 1950,
    nm: 5,
    year: 2022,
    has5g: true,
    aliases: ["exynos 1280"],
  },

  // ------------------------------------------------------------------ Unisoc
  {
    // Redmi A7 Pro 5G. Unisoc's budget 5G part is common in the 2026 sub-15k
    // shelf and its absence here left several phones showing "SoC ?".
    name: "Unisoc T8300",
    vendor: "unisoc",
    antutu: 646113,
    gb6Single: 730,
    gb6Multi: 1980,
    nm: 6,
    year: 2025,
    has5g: true,
    aliases: ["unisoc t8300", "t8300"],
  },
  {
    // Moto G35 5G. The captured product page says only "Unisoc" plus this
    // number, so without the entry the page read as no chipset at all.
    name: "Unisoc T760",
    vendor: "unisoc",
    antutu: 628581,
    gb6Single: 700,
    gb6Multi: 1900,
    nm: 6,
    year: 2022,
    has5g: true,
    aliases: ["unisoc t760", "t760"],
  },
  {
    // Lava Yuva-class entry phones. Genuinely slow — worth knowing rather
    // than imputing, because an unknown chip gets a median-ish guess.
    name: "Unisoc SC9863A",
    vendor: "unisoc",
    antutu: 160000,
    gb6Single: 180,
    gb6Multi: 620,
    nm: 28,
    year: 2019,
    has5g: false,
    aliases: ["unisoc sc9863a", "sc9863a", "sc9863"],
  },
  {
    name: "Unisoc T8200",
    vendor: "unisoc",
    antutu: 468000,
    gb6Single: 700,
    gb6Multi: 1900,
    nm: 6,
    year: 2024,
    has5g: true,
    aliases: ["unisoc t8200", "t8200"],
  },
  {
    name: "Unisoc T7250",
    vendor: "unisoc",
    antutu: 363000,
    gb6Single: 620,
    gb6Multi: 1750,
    nm: 6,
    year: 2024,
    has5g: true,
    aliases: ["unisoc t7250", "t7250"],
  },
  {
    name: "Unisoc T765",
    vendor: "unisoc",
    antutu: 469000,
    gb6Single: 600,
    gb6Multi: 1700,
    nm: 6,
    year: 2022,
    has5g: true,
    aliases: ["unisoc t765", "t765"],
  },
  {
    name: "Unisoc T620",
    vendor: "unisoc",
    antutu: 440000,
    gb6Single: 560,
    gb6Multi: 1600,
    nm: 6,
    year: 2023,
    has5g: false,
    aliases: ["unisoc t620", "t620"],
  },
  {
    name: "Unisoc T616",
    vendor: "unisoc",
    antutu: 380000,
    gb6Single: 470,
    gb6Multi: 1400,
    nm: 12,
    year: 2021,
    has5g: false,
    aliases: ["unisoc t616", "t616"],
  },
  {
    name: "Unisoc T612",
    vendor: "unisoc",
    antutu: 322000,
    gb6Single: 450,
    gb6Multi: 1350,
    nm: 12,
    year: 2021,
    has5g: false,
    aliases: ["unisoc t612", "t612"],
  },

  // ------------------------------------------------------------------- Apple
  {
    name: "Apple A18",
    vendor: "apple",
    antutu: 2000000,
    gb6Single: 3300,
    gb6Multi: 8200,
    nm: 3,
    year: 2024,
    has5g: true,
    aliases: ["apple a18 pro", "apple a18", "a18 bionic", "a18 pro"],
  },
  {
    name: "Apple A17 Pro",
    vendor: "apple",
    antutu: 1871000,
    gb6Single: 2900,
    gb6Multi: 7200,
    nm: 3,
    year: 2023,
    has5g: true,
    aliases: ["apple a17 pro", "apple a17", "a17 bionic", "a17 pro"],
  },
  {
    name: "Apple A16 Bionic",
    vendor: "apple",
    antutu: 1579000,
    gb6Single: 2600,
    gb6Multi: 6600,
    nm: 4,
    year: 2022,
    has5g: true,
    aliases: ["apple a16", "a16 bionic"],
  },
  {
    name: "Apple A15 Bionic",
    vendor: "apple",
    antutu: 1598000,
    gb6Single: 2300,
    gb6Multi: 5800,
    nm: 5,
    year: 2021,
    has5g: true,
    aliases: ["apple a15", "a15 bionic"],
  },

  // ------------------------------------------------------------------ Google
  {
    name: "Tensor G4",
    vendor: "google",
    antutu: 1499601,
    gb6Single: 1700,
    gb6Multi: 4400,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["tensor g4"],
  },
  {
    name: "Tensor G3",
    vendor: "google",
    antutu: 1409016,
    gb6Single: 1600,
    gb6Multi: 4200,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["tensor g3"],
  },
  // ------------------------------------------------- Qualcomm (added round 4)
  {
    name: "Snapdragon 8 Gen 2",
    vendor: "qualcomm",
    antutu: 1754213,
    gb6Single: 1950,
    gb6Multi: 5200,
    nm: 4,
    year: 2022,
    has5g: true,
    aliases: ["snapdragon 8 gen 2", "8 gen 2"],
  },
  {
    name: "Snapdragon 870",
    vendor: "qualcomm",
    antutu: 1010069,
    gb6Single: 1150,
    gb6Multi: 3300,
    nm: 7,
    year: 2021,
    has5g: true,
    aliases: ["snapdragon 870", "sd 870"],
  },
  {
    name: "Snapdragon 7 Gen 3",
    vendor: "qualcomm",
    antutu: 1025251,
    gb6Single: 1180,
    gb6Multi: 3250,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["snapdragon 7 gen 3", "7 gen 3"],
  },
  {
    name: "Snapdragon 7 Gen 1",
    vendor: "qualcomm",
    antutu: 840330,
    gb6Single: 1000,
    gb6Multi: 2900,
    nm: 4,
    year: 2022,
    has5g: true,
    aliases: ["snapdragon 7 gen 1", "7 gen 1"],
  },
  // ------------------------------------------------- MediaTek (added round 4)
  {
    name: "Dimensity 8400 Ultra",
    vendor: "mediatek",
    antutu: 1929000,
    gb6Single: 1470,
    gb6Multi: 6200,
    nm: 4,
    year: 2025,
    has5g: true,
    aliases: ["dimensity 8400 ultra"],
  },
  {
    name: "Dimensity 8300 Ultra",
    vendor: "mediatek",
    antutu: 1731000,
    gb6Single: 1460,
    gb6Multi: 4600,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["dimensity 8300 ultra"],
  },
  {
    name: "Dimensity 8020",
    vendor: "mediatek",
    antutu: 979624,
    gb6Single: 1010,
    gb6Multi: 3000,
    nm: 6,
    year: 2022,
    has5g: true,
    aliases: ["dimensity 8020"],
  },
  {
    name: "Dimensity 7350 Pro",
    vendor: "mediatek",
    antutu: 997000,
    gb6Single: 1100,
    gb6Multi: 2600,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["dimensity 7350 pro", "dimensity 7350"],
  },
  {
    name: "Dimensity 7300 Ultra",
    vendor: "mediatek",
    antutu: 919000,
    gb6Single: 1060,
    gb6Multi: 2950,
    nm: 4,
    year: 2024,
    has5g: true,
    aliases: ["dimensity 7300 ultra", "dimensity 7300x"],
  },
  {
    name: "Dimensity 7200",
    vendor: "mediatek",
    antutu: 971424,
    gb6Single: 1080,
    gb6Multi: 2500,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["dimensity 7200 ultra", "dimensity 7200 pro", "dimensity 7200"],
  },
  {
    name: "Dimensity 7020",
    vendor: "mediatek",
    antutu: 639509,
    gb6Single: 790,
    gb6Multi: 2040,
    nm: 6,
    year: 2023,
    has5g: true,
    aliases: ["dimensity 7020"],
  },
  {
    name: "Dimensity 6080",
    vendor: "mediatek",
    antutu: 567996,
    gb6Single: 740,
    gb6Multi: 1950,
    nm: 6,
    year: 2023,
    has5g: true,
    aliases: ["dimensity 6080"],
  },
  {
    name: "Dimensity 920",
    vendor: "mediatek",
    antutu: 750481,
    gb6Single: 900,
    gb6Multi: 2300,
    nm: 6,
    year: 2021,
    has5g: true,
    aliases: ["dimensity 920"],
  },
  {
    name: "Helio G88",
    vendor: "mediatek",
    antutu: 362744,
    gb6Single: 530,
    gb6Multi: 1470,
    nm: 12,
    year: 2021,
    has5g: false,
    aliases: ["helio g88", "g88"],
  },
  {
    name: "Helio G36",
    vendor: "mediatek",
    antutu: 195539,
    gb6Single: 320,
    gb6Multi: 1050,
    nm: 12,
    year: 2022,
    has5g: false,
    aliases: ["helio g36", "g36"],
  },
  // --------------------------------------------------- Google (added round 4)
  {
    name: "Tensor G2",
    vendor: "google",
    antutu: 1192791,
    gb6Single: 1400,
    gb6Multi: 3400,
    nm: 5,
    year: 2022,
    has5g: true,
    aliases: ["tensor g2"],
  },
];

/** Highest AnTuTu in the KB — used to normalise performance to 0..1. */
export const MAX_ANTUTU = Math.max(...SOCS.map((s) => s.antutu));

const ALIAS_INDEX: Array<{ alias: string; soc: SocEntry }> = SOCS
  .flatMap((soc) => soc.aliases.map((alias) => ({ alias, soc })))
  .sort((a, b) => b.alias.length - a.alias.length);

export interface SocMatch {
  soc: SocEntry;
  /**
   * True when the alias that matched carried no vendor name — Flipkart writes
   * "128 GB ROM 4 Gen 2 5G | Octa Core Processor", dropping "Snapdragon"
   * entirely. Such a match is real evidence but a weak identification, because
   * "4 Gen 2" and "4s Gen 2" are different chips and the abbreviation is
   * lossy. Callers should not let one overwrite a confident knowledge-base
   * entry; they should raise it for review instead.
   */
  ambiguous: boolean;
}

/** Find a SoC mentioned anywhere in a blob of text, with match quality. */
/**
 * Resolve a chipset name that arrived in a STRUCTURED field, where the whole
 * string is the chip and nothing else.
 *
 * `matchSoc` scans free text, so it requires a nearby context word before
 * trusting a vendor-less alias — otherwise "Aulumu A17" reads as an Apple
 * A17. That rule is right for page text and wrong here: a spec source that
 * returns Processor = "T7250" has given us the chip with no room for a
 * coincidence, and running it through the text matcher returned nothing,
 * which surfaced as the nonsense conflict "KB says Unisoc T7250, page says
 * T7250".
 */
export function matchSocExact(name: string): SocEntry | null {
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (!n) return null;
  for (const soc of SOCS) {
    if (soc.name.toLowerCase() === n) return soc;
  }
  for (const soc of SOCS) {
    if (soc.aliases.some((a) => a === n)) return soc;
  }
  return null;
}

export function matchSocDetailed(text: string): SocMatch | null {
  const soc = matchSoc(text);
  if (!soc) return null;
  const hay = text.toLowerCase();
  // Which alias actually hit? If any matching alias names a vendor, the
  // identification is solid.
  const hit = soc.aliases.find((a) => hay.includes(a));
  const ambiguous = hit ? !VENDOR_WORDS.test(hit) : true;
  return { soc, ambiguous };
}

/**
 * Words that establish we are looking at a chipset, not a coincidence.
 *
 * Product pages carry recommendation carousels, and a bare alias will happily
 * match inside another product's name — "Aulumu A17 for iPhone 17 Pro Max
 * Magnetic Thermal Case" once awarded a Rs 8,988 handset an Apple A17 Pro and
 * an AnTuTu of 1.6M, putting it top of the ranking.
 */
const VENDOR_WORDS =
  /snapdragon|dimensity|helio|exynos|unisoc|tensor|bionic|mediatek|qualcomm|apple/;

const CHIPSET_CONTEXT =
  /processor|chipset|cpu|octa[- ]?core|quad[- ]?core|soc\b|ghz|snapdragon|dimensity|helio|exynos|unisoc|tensor|bionic/i;

/** Find a SoC mentioned anywhere in a blob of text. Longest alias wins. */
export function matchSoc(text: string): SocEntry | null {
  if (!text) return null;
  // Flipkart's highlight strings lose spaces when tags are stripped
  // ("Snapdragon6 | Octa Core"), so re-separate vendor names from their digits.
  const hay = ` ${
    text
      .toLowerCase()
      .replace(/[_/]+/g, " ")
      .replace(
        /(snapdragon|dimensity|helio|exynos|unisoc|tensor)(\d)/g,
        "$1 $2",
      )
  } `;
  for (const { alias, soc } of ALIAS_INDEX) {
    // Bare numeric aliases ("4 gen 2") need word boundaries to avoid false hits.
    const idx = hay.indexOf(alias);
    if (idx === -1) continue;
    const before = hay[idx - 1];
    const after = hay[idx + alias.length];
    const isBoundary = (c: string | undefined) =>
      c === undefined || /[^a-z0-9]/.test(c);
    if (!isBoundary(before) || !isBoundary(after)) continue;

    // A vendor-less alias ("4 gen 2", "t7250") only counts when the surrounding
    // text is actually talking about a processor.
    if (!VENDOR_WORDS.test(alias)) {
      const window = hay.slice(Math.max(0, idx - 70), idx + alias.length + 70);
      if (!CHIPSET_CONTEXT.test(window)) continue;
    }
    return soc;
  }
  return null;
}

export type PerfTier =
  | "entry"
  | "budget"
  | "midrange"
  | "upper-midrange"
  | "flagship";

export function perfTier(antutu: number): PerfTier {
  if (antutu >= 1300000) return "flagship";
  if (antutu >= 700000) return "upper-midrange";
  if (antutu >= 400000) return "midrange";
  if (antutu >= 250000) return "budget";
  return "entry";
}
