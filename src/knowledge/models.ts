/**
 * Offline model knowledge base (seed set).
 *
 * Purpose: recover specs that marketplace listing cards never expose
 * (chipset, panel type, refresh rate, charging, OIS...) so ranking can be
 * spec-aware without spending a scrape credit per product.
 *
 * Rules for this file:
 *  - Only add a model when the specs are actually known. A missing entry is
 *    handled gracefully (specs come from the title, confidence drops, and
 *    `--enrich` can fetch the rest live). A WRONG entry silently corrupts the
 *    ranking, which is far worse.
 *  - `confidence` marks how sure we are. "low" entries are used but flagged.
 *
 * Extend via `deno task kb:add` or by hand — matching is on normalised model
 * keys, so "POCO M7 5G (Ocean Blue, 128 GB) (8 GB RAM)" resolves to "poco m7 5g".
 */

export interface ModelEntry {
  /** Normalised model key: lowercase, no colour/config suffixes. */
  key: string;
  brand: string;
  display: string;
  soc?: string;
  panel?: "AMOLED" | "pOLED" | "IPS LCD" | "PLS LCD" | "TFT LCD";
  inches?: number;
  refreshHz?: number;
  resolution?: "HD+" | "FHD+" | "QHD+";
  batteryMah?: number;
  chargingW?: number;
  mainCameraMp?: number;
  ois?: boolean;
  ipRating?: string;
  nfc?: boolean;
  stereoSpeakers?: boolean;
  headphoneJack?: boolean;
  releaseYear?: number;
  /** Promised OS upgrades, when the vendor states them. */
  osUpgrades?: number;
  confidence: "high" | "medium" | "low";
  /** Extra aliases that should resolve to this entry. */
  aliases?: string[];
}

export const PHONE_MODELS: ModelEntry[] = [
  // --------------------------------------------------------- Xiaomi / POCO
  {
    key: "poco m7 5g",
    brand: "POCO",
    display: "POCO M7 5G",
    soc: "Snapdragon 4s Gen 2",
    panel: "IPS LCD",
    inches: 6.88,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 5160,
    chargingW: 18,
    mainCameraMp: 50,
    ois: false,
    ipRating: "IP64",
    nfc: false,
    headphoneJack: true,
    releaseYear: 2025,
    confidence: "high",
  },
  {
    key: "poco m7 pro 5g",
    brand: "POCO",
    display: "POCO M7 Pro 5G",
    soc: "Dimensity 7025",
    panel: "AMOLED",
    inches: 6.67,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 5110,
    chargingW: 45,
    mainCameraMp: 50,
    ois: true,
    ipRating: "IP64",
    nfc: true,
    stereoSpeakers: true,
    releaseYear: 2025,
    confidence: "high",
  },
  {
    key: "poco c75 5g",
    brand: "POCO",
    display: "POCO C75 5G",
    soc: "Snapdragon 4s Gen 2",
    panel: "IPS LCD",
    inches: 6.88,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 5160,
    chargingW: 18,
    mainCameraMp: 50,
    ois: false,
    headphoneJack: true,
    releaseYear: 2024,
    confidence: "high",
  },
  {
    key: "poco m6 pro 5g",
    brand: "POCO",
    display: "POCO M6 Pro 5G",
    soc: "Snapdragon 4 Gen 2",
    panel: "IPS LCD",
    inches: 6.79,
    refreshHz: 90,
    resolution: "FHD+",
    batteryMah: 5000,
    chargingW: 18,
    mainCameraMp: 50,
    releaseYear: 2023,
    confidence: "high",
  },
  {
    key: "redmi 14c 5g",
    brand: "Xiaomi",
    display: "Redmi 14C 5G",
    soc: "Snapdragon 4s Gen 2",
    panel: "IPS LCD",
    inches: 6.88,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 5160,
    chargingW: 18,
    mainCameraMp: 50,
    releaseYear: 2024,
    confidence: "high",
  },
  {
    key: "redmi 14c",
    brand: "Xiaomi",
    display: "Redmi 14C",
    soc: "Helio G81",
    panel: "IPS LCD",
    inches: 6.88,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 5160,
    chargingW: 18,
    mainCameraMp: 50,
    releaseYear: 2024,
    confidence: "high",
  },
  {
    key: "redmi a4 5g",
    brand: "Xiaomi",
    display: "Redmi A4 5G",
    soc: "Snapdragon 4s Gen 2",
    panel: "IPS LCD",
    inches: 6.88,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 5160,
    chargingW: 18,
    mainCameraMp: 50,
    releaseYear: 2024,
    confidence: "high",
  },
  {
    key: "redmi note 14 5g",
    brand: "Xiaomi",
    display: "Redmi Note 14 5G",
    soc: "Dimensity 7025",
    panel: "AMOLED",
    inches: 6.67,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 5110,
    chargingW: 45,
    mainCameraMp: 108,
    ois: true,
    ipRating: "IP64",
    nfc: true,
    releaseYear: 2025,
    confidence: "high",
  },
  {
    key: "redmi note 13 5g",
    brand: "Xiaomi",
    display: "Redmi Note 13 5G",
    soc: "Dimensity 6080",
    panel: "AMOLED",
    inches: 6.67,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 5000,
    chargingW: 33,
    mainCameraMp: 108,
    releaseYear: 2024,
    confidence: "high",
  },

  // ------------------------------------------------------------- Samsung
  {
    key: "samsung galaxy m06 5g",
    brand: "Samsung",
    display: "Samsung Galaxy M06 5G",
    soc: "Dimensity 6300",
    panel: "PLS LCD",
    inches: 6.7,
    refreshHz: 90,
    resolution: "HD+",
    batteryMah: 5000,
    chargingW: 25,
    mainCameraMp: 50,
    releaseYear: 2025,
    osUpgrades: 4,
    confidence: "high",
    aliases: ["samsung m06 5g", "galaxy m06 5g"],
  },
  {
    key: "samsung galaxy m07",
    brand: "Samsung",
    display: "Samsung Galaxy M07",
    soc: "Helio G99",
    panel: "PLS LCD",
    inches: 6.7,
    refreshHz: 90,
    resolution: "HD+",
    batteryMah: 5000,
    chargingW: 25,
    mainCameraMp: 50,
    releaseYear: 2025,
    osUpgrades: 4,
    confidence: "low",
    aliases: ["galaxy m07"],
  },
  {
    key: "samsung galaxy f07",
    brand: "Samsung",
    display: "Samsung Galaxy F07",
    soc: "Helio G99",
    panel: "PLS LCD",
    inches: 6.7,
    refreshHz: 90,
    resolution: "HD+",
    batteryMah: 5000,
    chargingW: 25,
    mainCameraMp: 50,
    releaseYear: 2025,
    osUpgrades: 4,
    confidence: "low",
    aliases: ["galaxy f07"],
  },
  {
    key: "samsung galaxy m15 5g",
    brand: "Samsung",
    display: "Samsung Galaxy M15 5G",
    soc: "Dimensity 6100+",
    panel: "AMOLED",
    inches: 6.5,
    refreshHz: 90,
    resolution: "FHD+",
    batteryMah: 6000,
    chargingW: 25,
    mainCameraMp: 50,
    releaseYear: 2024,
    osUpgrades: 4,
    confidence: "high",
  },
  {
    key: "samsung galaxy a15 5g",
    brand: "Samsung",
    display: "Samsung Galaxy A15 5G",
    soc: "Dimensity 6100+",
    panel: "AMOLED",
    inches: 6.5,
    refreshHz: 90,
    resolution: "FHD+",
    batteryMah: 5000,
    chargingW: 25,
    mainCameraMp: 50,
    releaseYear: 2024,
    osUpgrades: 4,
    confidence: "high",
  },
  {
    key: "samsung galaxy m14 5g",
    brand: "Samsung",
    display: "Samsung Galaxy M14 5G",
    soc: "Exynos 1330",
    panel: "PLS LCD",
    inches: 6.6,
    refreshHz: 90,
    resolution: "FHD+",
    batteryMah: 6000,
    chargingW: 25,
    mainCameraMp: 50,
    releaseYear: 2023,
    confidence: "high",
  },
  {
    key: "samsung galaxy m35 5g",
    brand: "Samsung",
    display: "Samsung Galaxy M35 5G",
    soc: "Exynos 1380",
    panel: "AMOLED",
    inches: 6.6,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 6000,
    chargingW: 25,
    mainCameraMp: 50,
    ois: true,
    ipRating: "IP67",
    nfc: true,
    stereoSpeakers: true,
    releaseYear: 2024,
    osUpgrades: 4,
    confidence: "high",
  },

  // -------------------------------------------------------------- realme
  {
    key: "realme narzo 80 lite",
    brand: "realme",
    display: "realme narzo 80 Lite",
    soc: "Unisoc T7250",
    panel: "IPS LCD",
    inches: 6.67,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 6300,
    chargingW: 15,
    mainCameraMp: 32,
    ipRating: "IP64",
    releaseYear: 2025,
    confidence: "low",
  },
  {
    key: "realme p3 lite 5g",
    brand: "realme",
    display: "realme P3 Lite 5G",
    soc: "Dimensity 6300",
    panel: "IPS LCD",
    inches: 6.67,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 6000,
    chargingW: 45,
    mainCameraMp: 32,
    ipRating: "IP64",
    releaseYear: 2025,
    confidence: "medium",
  },
  {
    key: "realme narzo 70x 5g",
    brand: "realme",
    display: "realme narzo 70x 5G",
    soc: "Dimensity 6100+",
    panel: "IPS LCD",
    inches: 6.72,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 5000,
    chargingW: 45,
    mainCameraMp: 50,
    releaseYear: 2024,
    confidence: "high",
  },
  {
    key: "realme p1 5g",
    brand: "realme",
    display: "realme P1 5G",
    soc: "Dimensity 7050",
    panel: "AMOLED",
    inches: 6.67,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 5000,
    chargingW: 45,
    mainCameraMp: 50,
    releaseYear: 2024,
    confidence: "high",
  },

  // ------------------------------------------------------------- Motorola
  {
    key: "motorola g45 5g",
    brand: "Motorola",
    display: "Motorola G45 5G",
    soc: "Snapdragon 6s Gen 3",
    panel: "IPS LCD",
    inches: 6.5,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 5000,
    chargingW: 18,
    mainCameraMp: 50,
    nfc: true,
    stereoSpeakers: true,
    releaseYear: 2024,
    confidence: "high",
    aliases: ["moto g45 5g"],
  },
  {
    key: "motorola g85 5g",
    brand: "Motorola",
    display: "Motorola G85 5G",
    soc: "Snapdragon 6s Gen 3",
    panel: "pOLED",
    inches: 6.67,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 5000,
    chargingW: 33,
    mainCameraMp: 50,
    ois: true,
    ipRating: "IP52",
    nfc: true,
    stereoSpeakers: true,
    releaseYear: 2024,
    confidence: "high",
    aliases: ["moto g85 5g"],
  },

  // ----------------------------------------------------------------- iQOO
  {
    key: "iqoo z10 lite 5g",
    brand: "iQOO",
    display: "iQOO Z10 Lite 5G",
    soc: "Dimensity 6300",
    panel: "IPS LCD",
    inches: 6.74,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 6000,
    chargingW: 15,
    mainCameraMp: 50,
    ipRating: "IP64",
    releaseYear: 2025,
    confidence: "medium",
  },
  {
    key: "iqoo z9x 5g",
    brand: "iQOO",
    display: "iQOO Z9x 5G",
    soc: "Snapdragon 6 Gen 1",
    panel: "IPS LCD",
    inches: 6.72,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 6000,
    chargingW: 44,
    mainCameraMp: 50,
    releaseYear: 2024,
    confidence: "high",
  },

  // --------------------------------------------------------------- Infinix
  {
    key: "infinix hot 50 5g",
    brand: "Infinix",
    display: "Infinix Hot 50 5G",
    soc: "Dimensity 6300",
    panel: "IPS LCD",
    inches: 6.7,
    refreshHz: 120,
    resolution: "HD+",
    batteryMah: 5000,
    chargingW: 18,
    mainCameraMp: 48,
    releaseYear: 2024,
    confidence: "medium",
  },

  // ------------------------------------------------------------------ Lava
  {
    key: "lava blaze duo 5g",
    brand: "LAVA",
    display: "LAVA Blaze Duo 5G",
    soc: "Dimensity 7025",
    panel: "AMOLED",
    inches: 6.67,
    refreshHz: 120,
    resolution: "FHD+",
    batteryMah: 5000,
    chargingW: 33,
    mainCameraMp: 64,
    releaseYear: 2024,
    confidence: "medium",
  },
];

const MODEL_INDEX = new Map<string, ModelEntry>();
for (const m of PHONE_MODELS) {
  MODEL_INDEX.set(m.key, m);
  for (const a of m.aliases ?? []) MODEL_INDEX.set(a, m);
}

/** Sorted longest-first so "poco m7 pro 5g" beats "poco m7 5g". */
const MODEL_KEYS = [...MODEL_INDEX.keys()].sort((a, b) => b.length - a.length);

export function lookupModel(text: string): ModelEntry | null {
  if (!text) return null;
  const hay = ` ${
    text.toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim()
  } `;
  for (const key of MODEL_KEYS) {
    if (hay.includes(` ${key} `)) return MODEL_INDEX.get(key)!;
  }
  return null;
}
