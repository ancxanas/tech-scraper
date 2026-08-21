/**
 * Offline audio knowledge base (headphones / earbuds).
 *
 * Listing titles for audio gear are far less structured than phone cards —
 * there is no "(Colour, 128 GB) (8 GB RAM)" convention — so the KB carries more
 * of the weight here than it does for phones.
 *
 * `soundGrade` (0-100) is a coarse, deliberately conservative summary of how
 * the model is generally regarded for sound quality by mainstream reviewers.
 * It is a tie-breaker, not a measurement, and is weighted accordingly.
 *
 * Same rule as the phone KB: only add what you actually know. A missing entry
 * degrades gracefully; a wrong one silently corrupts the ranking.
 */

export interface AudioModel {
  key: string;
  brand: string;
  display: string;
  formFactor: "over-ear" | "on-ear" | "in-ear" | "tws" | "neckband";
  ancType?: "hybrid-anc" | "anc" | "enc" | "passive";
  batteryHours?: number;
  driverMm?: number;
  codecs?: string[];
  bluetoothVersion?: number;
  weightG?: number;
  multipoint?: boolean;
  ipRating?: string;
  soundGrade?: number;
  releaseYear?: number;
  confidence: "high" | "medium" | "low";
  aliases?: string[];
}

export const AUDIO_MODELS: AudioModel[] = [
  // ------------------------------------------------------------------ Sony
  {
    key: "wh-1000xm5",
    brand: "Sony",
    display: "Sony WH-1000XM5",
    formFactor: "over-ear",
    ancType: "hybrid-anc",
    batteryHours: 30,
    driverMm: 30,
    codecs: ["LDAC", "AAC", "SBC"],
    bluetoothVersion: 5.2,
    weightG: 250,
    multipoint: true,
    soundGrade: 92,
    releaseYear: 2022,
    confidence: "high",
    aliases: ["wh1000xm5", "wh 1000xm5"],
  },
  {
    key: "wh-1000xm4",
    brand: "Sony",
    display: "Sony WH-1000XM4",
    formFactor: "over-ear",
    ancType: "hybrid-anc",
    batteryHours: 30,
    driverMm: 40,
    codecs: ["LDAC", "AAC", "SBC"],
    bluetoothVersion: 5.0,
    weightG: 254,
    multipoint: true,
    soundGrade: 90,
    releaseYear: 2020,
    confidence: "high",
    aliases: ["wh1000xm4"],
  },
  {
    key: "wh-ch720n",
    brand: "Sony",
    display: "Sony WH-CH720N",
    formFactor: "over-ear",
    ancType: "anc",
    batteryHours: 35,
    driverMm: 30,
    codecs: ["AAC", "SBC"],
    bluetoothVersion: 5.2,
    weightG: 192,
    multipoint: true,
    soundGrade: 74,
    releaseYear: 2023,
    confidence: "high",
  },
  {
    key: "wh-ch520",
    brand: "Sony",
    display: "Sony WH-CH520",
    formFactor: "on-ear",
    ancType: "passive",
    batteryHours: 50,
    driverMm: 30,
    codecs: ["AAC", "SBC"],
    bluetoothVersion: 5.2,
    weightG: 147,
    multipoint: true,
    soundGrade: 62,
    releaseYear: 2023,
    confidence: "high",
  },
  {
    key: "wh-ult900n",
    brand: "Sony",
    display: "Sony ULT WEAR WH-ULT900N",
    formFactor: "over-ear",
    ancType: "hybrid-anc",
    batteryHours: 30,
    driverMm: 40,
    codecs: ["LDAC", "AAC", "SBC"],
    bluetoothVersion: 5.2,
    weightG: 255,
    multipoint: true,
    soundGrade: 80,
    releaseYear: 2024,
    confidence: "high",
    aliases: ["ult wear"],
  },
  {
    key: "wf-1000xm5",
    brand: "Sony",
    display: "Sony WF-1000XM5",
    formFactor: "tws",
    ancType: "hybrid-anc",
    batteryHours: 8,
    driverMm: 8.4,
    codecs: ["LDAC", "AAC", "SBC"],
    bluetoothVersion: 5.3,
    multipoint: true,
    ipRating: "IPX4",
    soundGrade: 90,
    releaseYear: 2023,
    confidence: "high",
  },
  {
    key: "wf-c710n",
    brand: "Sony",
    display: "Sony WF-C710N",
    formFactor: "tws",
    ancType: "anc",
    batteryHours: 8.5,
    codecs: ["AAC", "SBC"],
    bluetoothVersion: 5.3,
    ipRating: "IPX4",
    soundGrade: 72,
    releaseYear: 2025,
    confidence: "medium",
  },

  // ------------------------------------------------------------------ Bose
  {
    key: "quietcomfort ultra",
    brand: "Bose",
    display: "Bose QuietComfort Ultra Headphones",
    formFactor: "over-ear",
    ancType: "hybrid-anc",
    batteryHours: 24,
    codecs: ["aptX Adaptive", "AAC", "SBC"],
    bluetoothVersion: 5.3,
    weightG: 250,
    multipoint: true,
    soundGrade: 90,
    releaseYear: 2023,
    confidence: "high",
  },
  {
    key: "quietcomfort 45",
    brand: "Bose",
    display: "Bose QuietComfort 45",
    formFactor: "over-ear",
    ancType: "hybrid-anc",
    batteryHours: 24,
    codecs: ["AAC", "SBC"],
    bluetoothVersion: 5.1,
    weightG: 240,
    multipoint: true,
    soundGrade: 85,
    releaseYear: 2021,
    confidence: "high",
    aliases: ["qc45"],
  },

  // ----------------------------------------------------------------- Apple
  {
    key: "airpods pro 2",
    brand: "Apple",
    display: "Apple AirPods Pro (2nd gen)",
    formFactor: "tws",
    ancType: "hybrid-anc",
    batteryHours: 6,
    codecs: ["AAC", "SBC"],
    bluetoothVersion: 5.3,
    ipRating: "IPX4",
    soundGrade: 86,
    releaseYear: 2022,
    confidence: "high",
    aliases: ["airpods pro 2nd generation"],
  },

  // ------------------------------------------------------------------- JBL
  {
    key: "jbl tune 770nc",
    brand: "JBL",
    display: "JBL Tune 770NC",
    formFactor: "over-ear",
    ancType: "anc",
    batteryHours: 70,
    driverMm: 40,
    codecs: ["AAC", "SBC"],
    bluetoothVersion: 5.3,
    multipoint: true,
    soundGrade: 72,
    releaseYear: 2023,
    confidence: "high",
  },
  {
    key: "jbl tune 520bt",
    brand: "JBL",
    display: "JBL Tune 520BT",
    formFactor: "on-ear",
    ancType: "passive",
    batteryHours: 57,
    driverMm: 33,
    codecs: ["SBC"],
    bluetoothVersion: 5.3,
    soundGrade: 60,
    releaseYear: 2023,
    confidence: "high",
  },

  // --------------------------------------------------------------- OnePlus
  {
    key: "oneplus bullets z2",
    brand: "OnePlus",
    display: "OnePlus Bullets Wireless Z2",
    formFactor: "neckband",
    ancType: "enc",
    batteryHours: 30,
    driverMm: 12.4,
    codecs: ["AAC", "SBC"],
    bluetoothVersion: 5.0,
    ipRating: "IP55",
    soundGrade: 58,
    releaseYear: 2022,
    confidence: "high",
  },

  // ------------------------------------------------------------------ boAt
  {
    key: "boat airdopes 141",
    brand: "boAt",
    display: "boAt Airdopes 141",
    formFactor: "tws",
    ancType: "enc",
    batteryHours: 42,
    driverMm: 8,
    codecs: ["SBC"],
    bluetoothVersion: 5.1,
    ipRating: "IPX4",
    soundGrade: 48,
    releaseYear: 2022,
    confidence: "high",
  },
  {
    key: "boat rockerz 450",
    brand: "boAt",
    display: "boAt Rockerz 450",
    formFactor: "on-ear",
    ancType: "passive",
    batteryHours: 15,
    driverMm: 40,
    codecs: ["SBC"],
    bluetoothVersion: 5.0,
    soundGrade: 50,
    releaseYear: 2020,
    confidence: "high",
  },
];

const INDEX = new Map<string, AudioModel>();
for (const m of AUDIO_MODELS) {
  INDEX.set(m.key, m);
  for (const a of m.aliases ?? []) INDEX.set(a, m);
}
const KEYS = [...INDEX.keys()].sort((a, b) => b.length - a.length);

export function lookupAudioModel(text: string): AudioModel | null {
  if (!text) return null;
  const hay = ` ${
    text.toLowerCase().replace(/[^a-z0-9-]+/g, " ").replace(/\s+/g, " ").trim()
  } `;
  for (const key of KEYS) {
    if (hay.includes(` ${key} `) || hay.includes(`${key} `)) {
      return INDEX.get(key)!;
    }
  }
  return null;
}
