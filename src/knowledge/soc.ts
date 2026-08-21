/**
 * Offline SoC knowledge base.
 *
 * Values are approximate AnTuTu v10 / Geekbench 6 figures used for RELATIVE
 * ranking only. They are never presented as exact measurements — the UI shows
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
    antutu: 2050000,
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
    antutu: 1450000,
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
    antutu: 1420000,
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
    antutu: 820000,
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
    antutu: 620000,
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
    antutu: 620000,
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
    antutu: 420000,
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
    antutu: 570000,
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
    antutu: 450000,
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
    antutu: 400000,
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
    antutu: 400000,
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
    antutu: 400000,
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
    antutu: 290000,
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
    antutu: 270000,
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
    antutu: 180000,
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
    antutu: 2100000,
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
    antutu: 1620000,
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
    antutu: 1450000,
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
    antutu: 1000000,
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
    antutu: 720000,
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
    antutu: 680000,
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
    antutu: 560000,
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
    antutu: 440000,
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
    antutu: 440000,
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
    antutu: 420000,
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
    antutu: 400000,
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
    antutu: 380000,
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
    antutu: 300000,
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
    antutu: 290000,
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
    antutu: 210000,
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
    antutu: 220000,
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
    antutu: 200000,
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
    antutu: 900000,
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
    antutu: 820000,
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
    antutu: 610000,
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
    antutu: 420000,
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
    antutu: 400000,
    gb6Single: 830,
    gb6Multi: 1950,
    nm: 5,
    year: 2022,
    has5g: true,
    aliases: ["exynos 1280"],
  },

  // ------------------------------------------------------------------ Unisoc
  {
    name: "Unisoc T8200",
    vendor: "unisoc",
    antutu: 380000,
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
    antutu: 330000,
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
    antutu: 320000,
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
    antutu: 250000,
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
    antutu: 230000,
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
    antutu: 210000,
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
    antutu: 1750000,
    gb6Single: 3300,
    gb6Multi: 8200,
    nm: 3,
    year: 2024,
    has5g: true,
    aliases: ["a18 bionic", "a18 pro", "a18"],
  },
  {
    name: "Apple A17 Pro",
    vendor: "apple",
    antutu: 1600000,
    gb6Single: 2900,
    gb6Multi: 7200,
    nm: 3,
    year: 2023,
    has5g: true,
    aliases: ["a17 pro", "a17"],
  },
  {
    name: "Apple A16 Bionic",
    vendor: "apple",
    antutu: 1350000,
    gb6Single: 2600,
    gb6Multi: 6600,
    nm: 4,
    year: 2022,
    has5g: true,
    aliases: ["a16 bionic", "a16"],
  },
  {
    name: "Apple A15 Bionic",
    vendor: "apple",
    antutu: 1150000,
    gb6Single: 2300,
    gb6Multi: 5800,
    nm: 5,
    year: 2021,
    has5g: true,
    aliases: ["a15 bionic", "a15"],
  },

  // ------------------------------------------------------------------ Google
  {
    name: "Tensor G4",
    vendor: "google",
    antutu: 1050000,
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
    antutu: 980000,
    gb6Single: 1600,
    gb6Multi: 4200,
    nm: 4,
    year: 2023,
    has5g: true,
    aliases: ["tensor g3"],
  },
];

/** Highest AnTuTu in the KB — used to normalise performance to 0..1. */
export const MAX_ANTUTU = Math.max(...SOCS.map((s) => s.antutu));

const ALIAS_INDEX: Array<{ alias: string; soc: SocEntry }> = SOCS
  .flatMap((soc) => soc.aliases.map((alias) => ({ alias, soc })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Find a SoC mentioned anywhere in a blob of text. Longest alias wins. */
export function matchSoc(text: string): SocEntry | null {
  if (!text) return null;
  const hay = ` ${text.toLowerCase().replace(/[_/]+/g, " ")} `;
  for (const { alias, soc } of ALIAS_INDEX) {
    // Bare numeric aliases ("4 gen 2") need word boundaries to avoid false hits.
    const idx = hay.indexOf(alias);
    if (idx === -1) continue;
    const before = hay[idx - 1];
    const after = hay[idx + alias.length];
    const isBoundary = (c: string | undefined) =>
      c === undefined || /[^a-z0-9]/.test(c);
    if (isBoundary(before) && isBoundary(after)) return soc;
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
