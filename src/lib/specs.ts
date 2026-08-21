import type { Product } from "../types.ts";
import type { ProductCategory } from "./catalog.ts";

export interface ProductSpecs {
  category: ProductCategory;
  specs: Record<string, string | number>;
  benchmarkScore: number | null;
  comparisonFields: string[];
}

const PHONE_RAM = /(\d+)\s*gb\s*(?:ram|lpddr)/i;
const PHONE_STORAGE = /(\d+)\s*gb\s*(?:storage|rom|internal)/i;
const PHONE_BATTERY = /(\d{4,5})\s*mah/i;
const PHONE_CAMERA = /(\d+)\s*mp(?:\s*(?:\+\s*\d+\s*mp)*)?/i;
const PHONE_DISPLAY = /(\d+\.?\d*)\s*(?:inch|")/i;
const PHONE_REFRESH = /(\d+)\s*hz/i;
const PHONE_PROC =
  /(snapdragon\s*\d+\s*\w*|mediatek\s*\w+\s*\d*|dimensity\s*\d+\w*|exynos\s*\d+\w*|a\d{4}|m\d{4}|bionic\s*\w+)/i;
const PHONE_5G = /\b5g\b/i;

const HP_ANC = /\b(anc|noise\s*cancell?ing|active\s*noise)/i;
const HP_BATTERY = /(\d+)\s*h(?:ou)?rs?\s*(?:battery|life|playback)/i;
const HP_DRIVER = /(\d+)\s*mm\s*driver/i;
const HP_BLUETOOTH = /bluetooth\s*(\d+\.?\d*)/i;
const HP_WEIGHT = /(\d+)\s*g(?:m|r)?(?:\s*(?:weight|lightweight))/i;
const HP_TYPE =
  /\b(over[- ]?ear|on[- ]?ear|in[- ]?ear|true\s*wireless|neckband|clip)/i;
const HP_CODEC = /(ldac|aptx|aac|sbc|lhdc)/gi;

interface BenchmarkEntry {
  antutu?: number;
  geekbench_single?: number;
  geekbench_multi?: number;
  battery_mah?: number;
  ram_gb?: number;
  storage_gb?: number;
  camera_mp?: number;
  display_type?: string;
  refresh_rate?: number;
  anc?: string;
  battery_hours?: number;
  driver_mm?: number;
  weight_g?: number;
  score: number;
}

const BENCHMARKS: Record<string, Record<string, BenchmarkEntry>> = {
  phone: {
    "samsung galaxy m34 5g": {
      antutu: 410000,
      geekbench_single: 580,
      geekbench_multi: 1720,
      battery_mah: 6000,
      ram_gb: 6,
      storage_gb: 128,
      camera_mp: 50,
      display_type: "AMOLED",
      refresh_rate: 120,
      score: 78,
    },
    "redmi note 13 5g": {
      antutu: 395000,
      geekbench_single: 550,
      geekbench_multi: 1650,
      battery_mah: 5000,
      ram_gb: 6,
      storage_gb: 128,
      camera_mp: 108,
      display_type: "AMOLED",
      refresh_rate: 120,
      score: 75,
    },
    "realme narzo 70x 5g": {
      antutu: 380000,
      geekbench_single: 520,
      geekbench_multi: 1550,
      battery_mah: 5000,
      ram_gb: 6,
      storage_gb: 128,
      camera_mp: 50,
      display_type: "IPS LCD",
      refresh_rate: 120,
      score: 72,
    },
    "samsung galaxy a15": {
      antutu: 280000,
      geekbench_single: 400,
      geekbench_multi: 1200,
      battery_mah: 5000,
      ram_gb: 8,
      storage_gb: 256,
      camera_mp: 50,
      display_type: "AMOLED",
      refresh_rate: 90,
      score: 65,
    },
    "oneplus nord ce 3 lite 5g": {
      antutu: 400000,
      geekbench_single: 560,
      geekbench_multi: 1680,
      battery_mah: 5000,
      ram_gb: 8,
      storage_gb: 128,
      camera_mp: 108,
      display_type: "IPS LCD",
      refresh_rate: 120,
      score: 76,
    },
    "poco m6 pro": {
      antutu: 350000,
      geekbench_single: 480,
      geekbench_multi: 1400,
      battery_mah: 5000,
      ram_gb: 6,
      storage_gb: 128,
      camera_mp: 64,
      display_type: "AMOLED",
      refresh_rate: 120,
      score: 70,
    },
    "vivo t3 5g": {
      antutu: 420000,
      geekbench_single: 590,
      geekbench_multi: 1750,
      battery_mah: 5000,
      ram_gb: 8,
      storage_gb: 128,
      camera_mp: 50,
      display_type: "AMOLED",
      refresh_rate: 120,
      score: 79,
    },
    "motorola moto g84 5g": {
      antutu: 405000,
      geekbench_single: 570,
      geekbench_multi: 1700,
      battery_mah: 5000,
      ram_gb: 8,
      storage_gb: 256,
      camera_mp: 50,
      display_type: "pOLED",
      refresh_rate: 120,
      score: 77,
    },
    "nothing phone 2a": {
      antutu: 430000,
      geekbench_single: 600,
      geekbench_multi: 1800,
      battery_mah: 5000,
      ram_gb: 8,
      storage_gb: 128,
      camera_mp: 50,
      display_type: "AMOLED",
      refresh_rate: 120,
      score: 80,
    },
    "iqoo z9x 5g": {
      antutu: 415000,
      geekbench_single: 585,
      geekbench_multi: 1730,
      battery_mah: 6000,
      ram_gb: 6,
      storage_gb: 128,
      camera_mp: 50,
      display_type: "IPS LCD",
      refresh_rate: 120,
      score: 77,
    },
  },
  headphone: {
    "sony wh-1000xm5": {
      anc: "adaptive",
      battery_hours: 30,
      driver_mm: 30,
      weight_g: 250,
      score: 95,
    },
    "sony wh-1000xm4": {
      anc: "adaptive",
      battery_hours: 30,
      driver_mm: 40,
      weight_g: 254,
      score: 90,
    },
    "sony wh-ch720n": {
      anc: "yes",
      battery_hours: 35,
      driver_mm: 30,
      weight_g: 192,
      score: 75,
    },
    "sony wh-ch520": {
      anc: "no",
      battery_hours: 50,
      driver_mm: 30,
      weight_g: 147,
      score: 65,
    },
    "bose quietcomfort 45": {
      anc: "adaptive",
      battery_hours: 24,
      driver_mm: 40,
      weight_g: 240,
      score: 88,
    },
    "sennheiser hd 450bt": {
      anc: "yes",
      battery_hours: 30,
      driver_mm: 42,
      weight_g: 238,
      score: 78,
    },
    "jbl tune 770nc": {
      anc: "adaptive",
      battery_hours: 44,
      driver_mm: 40,
      weight_g: 252,
      score: 72,
    },
    "jbl tune 760nc": {
      anc: "yes",
      battery_hours: 44,
      driver_mm: 40,
      weight_g: 252,
      score: 70,
    },
    "boAt rockerz 450": {
      anc: "no",
      battery_hours: 15,
      driver_mm: 40,
      weight_g: 230,
      score: 50,
    },
  },
  earbuds: {
    "sony wf-1000xm5": {
      anc: "adaptive",
      battery_hours: 8,
      driver_mm: 8.4,
      weight_g: 25,
      score: 93,
    },
    "sony wf-c500": {
      anc: "no",
      battery_hours: 10,
      driver_mm: 5.8,
      weight_g: 12,
      score: 60,
    },
    "sony wf-c510": {
      anc: "no",
      battery_hours: 10,
      driver_mm: 5.8,
      weight_g: 13,
      score: 62,
    },
    "sony wf-c700n": {
      anc: "yes",
      battery_hours: 7.5,
      driver_mm: 5,
      weight_g: 4.8,
      score: 75,
    },
    "apple airpods pro 2": {
      anc: "adaptive",
      battery_hours: 6,
      driver_mm: 11,
      weight_g: 5.3,
      score: 92,
    },
    "samsung galaxy buds fe": {
      anc: "yes",
      battery_hours: 6,
      driver_mm: 5.6,
      weight_g: 5.6,
      score: 70,
    },
  },
};

export function extractSpecs(
  product: Product,
  category: ProductCategory,
): ProductSpecs {
  const name = product.name;
  const specs: Record<string, string | number> = {};

  switch (category) {
    case "phone":
      extractPhoneSpecs(name, specs);
      break;
    case "headphone":
      extractHeadphoneSpecs(name, specs);
      break;
    case "earbuds":
      extractEarbudsSpecs(name, specs);
      break;
    default:
      break;
  }

  const benchmark = lookupBenchmark(name, category);
  const comparisonFields = getComparisonFields(category);

  return {
    category,
    specs,
    benchmarkScore: benchmark?.score ?? null,
    comparisonFields,
  };
}

function extractPhoneSpecs(
  name: string,
  specs: Record<string, string | number>,
): void {
  const ram = name.match(PHONE_RAM);
  if (ram) specs.ram_gb = parseInt(ram[1]);

  const storage = name.match(PHONE_STORAGE);
  if (storage) specs.storage_gb = parseInt(storage[1]);

  const battery = name.match(PHONE_BATTERY);
  if (battery) specs.battery_mah = parseInt(battery[1]);

  const camera = name.match(PHONE_CAMERA);
  if (camera) specs.camera_mp = parseInt(camera[1]);

  const display = name.match(PHONE_DISPLAY);
  if (display) specs.display_size = parseFloat(display[1]);

  const refresh = name.match(PHONE_REFRESH);
  if (refresh) specs.refresh_rate = parseInt(refresh[1]);

  const proc = name.match(PHONE_PROC);
  if (proc) specs.processor = proc[1];

  if (PHONE_5G.test(name)) specs.is_5g = 1;
}

function extractHeadphoneSpecs(
  name: string,
  specs: Record<string, string | number>,
): void {
  if (HP_ANC.test(name)) specs.anc = "yes";
  else specs.anc = "no";

  const battery = name.match(HP_BATTERY);
  if (battery) specs.battery_hours = parseInt(battery[1]);

  const driver = name.match(HP_DRIVER);
  if (driver) specs.driver_mm = parseInt(driver[1]);

  const bt = name.match(HP_BLUETOOTH);
  if (bt) specs.bluetooth = parseFloat(bt[1]);

  const weight = name.match(HP_WEIGHT);
  if (weight) specs.weight_g = parseInt(weight[1]);

  const type = name.match(HP_TYPE);
  if (type) specs.type = type[1].toLowerCase();

  const codecs: string[] = [];
  let m: RegExpExecArray | null;
  const codecRe = new RegExp(HP_CODEC.source, "gi");
  while ((m = codecRe.exec(name)) !== null) {
    codecs.push(m[1].toUpperCase());
  }
  if (codecs.length > 0) specs.codecs = codecs.join(", ");
}

function extractEarbudsSpecs(
  name: string,
  specs: Record<string, string | number>,
): void {
  if (HP_ANC.test(name)) specs.anc = "yes";
  else specs.anc = "no";

  const battery = name.match(HP_BATTERY);
  if (battery) specs.battery_hours = parseInt(battery[1]);

  const driver = name.match(HP_DRIVER);
  if (driver) specs.driver_mm = parseFloat(driver[1]);

  const weight = name.match(HP_WEIGHT);
  if (weight) specs.weight_g = parseFloat(weight[1]);
}

function lookupBenchmark(
  name: string,
  category: ProductCategory,
): BenchmarkEntry | null {
  const catBenchmarks = BENCHMARKS[category];
  if (!catBenchmarks) return null;

  const nameLower = name.toLowerCase();
  for (const [key, entry] of Object.entries(catBenchmarks)) {
    if (nameLower.includes(key)) return entry;
  }

  const tokens = nameLower.split(/\s+/).filter((t) => t.length > 2);
  let bestMatch:
    | { key: string; entry: BenchmarkEntry; overlap: number }
    | null = null;
  for (const [key, entry] of Object.entries(catBenchmarks)) {
    const keyTokens = key.split(/\s+/);
    let overlap = 0;
    for (const kt of keyTokens) {
      if (tokens.includes(kt)) overlap++;
    }
    if (overlap >= 2 && (!bestMatch || overlap > bestMatch.overlap)) {
      bestMatch = { key, entry, overlap };
    }
  }

  return bestMatch?.entry ?? null;
}

export function getComparisonFields(category: ProductCategory): string[] {
  switch (category) {
    case "phone":
      return [
        "processor",
        "ram_gb",
        "storage_gb",
        "battery_mah",
        "camera_mp",
        "display_size",
        "refresh_rate",
        "is_5g",
      ];
    case "headphone":
      return ["anc", "battery_hours", "driver_mm", "weight_g", "type"];
    case "earbuds":
      return ["anc", "battery_hours", "driver_mm", "weight_g"];
    case "laptop":
      return ["processor", "ram_gb", "storage_gb", "display_size"];
    default:
      return ["rating", "reviewsCount", "price"];
  }
}
