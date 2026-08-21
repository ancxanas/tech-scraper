/**
 * Category classification.
 *
 * The old pipeline ranked earphones for a "phones under 15000" query because
 * relevance was token overlap against the raw query string ("phones under
 * 15000" shares no tokens with anything, so everything scored equally) and the
 * only defence was a regex blocklist applied AFTER scoring.
 *
 * Here classification is a first-class, weighted decision made BEFORE scoring,
 * and a mismatch is a hard gate, not a penalty.
 */

import type { Category } from "./types.ts";

interface Rule {
  category: Category;
  /** Strong signals — a single hit is near-conclusive. */
  strong?: RegExp[];
  /** Weak signals — supporting evidence. */
  weak?: RegExp[];
  /** If present, this category is ruled out. */
  veto?: RegExp[];
}

const RULES: Rule[] = [
  {
    category: "earbuds",
    strong: [
      /\b(tws|true\s*wireless|earbuds?|ear\s*buds?|airdopes|airpods|neckband)\b/i,
      /\bin[-\s]?ear\s+(?:wireless\s+)?(?:head|ear)phones?\b/i,
      /\bbullets\s+z\d/i,
    ],
    weak: [/\bipx\d\b/i, /playtime/i, /\bearphones?\b/i],
  },
  {
    category: "headphone",
    strong: [
      /\b(over[-\s]?ear|on[-\s]?ear)\b/i,
      /\bheadphones?\b/i,
      /\bheadset\b/i,
      /\bwh-\d{4}|\bqc\d{2}\b|quietcomfort/i,
    ],
    weak: [/\banc\b|noise\s*cancell/i, /\bdriver\b/i],
    veto: [/\bearbuds?\b|\btws\b/i],
  },
  {
    category: "phone",
    strong: [
      /\b(smartphone|mobile\s*phone)\b/i,
      // "(Colour, 128 GB)" + "(8 GB RAM)" is the canonical Indian phone card.
      /\(\s*[\w\s]+,\s*\d+\s*(?:gb|tb)\s*\)/i,
      /\biphone\s*\d/i,
      /\bgalaxy\s+[amszf]\d/i,
    ],
    weak: [
      /\b\d+\s*gb\s*ram\b/i,
      /\b5g\b/i,
      /\bdual\s*sim\b/i,
      /\b(poco|redmi|realme|narzo|iqoo|vivo|oppo|infinix|tecno|lava|motorola|moto|nothing\s*phone)\b/i,
    ],
    veto: [
      /\b(case|cover|tempered|screen\s*guard|protector|charger|cable|adapter|holder|mount|stand|pouch|skin|sticker|lens\s*protector|back\s*cover|flip\s*cover)\b/i,
      /\b(earphones?|earbuds?|headphones?|headset|neckband|tws|speaker|smart\s*watch|smartwatch|power\s*bank|powerbank|tablet|laptop)\b/i,
      /\bcompatible\s+with\b/i,
    ],
  },
  {
    category: "smartwatch",
    strong: [/\bsmart\s*watch\b|\bsmartwatch\b|\bfitness\s*band\b/i],
    weak: [/\bamoled\s+display\b.*\bwatch\b/i, /\bbluetooth\s+calling\b/i],
  },
  {
    category: "laptop",
    strong: [/\blaptop\b|\bnotebook\b|\bmacbook\b|\bchromebook\b/i],
    weak: [/\b(i[3579]|ryzen|celeron)\b/i, /\bwindows\s*11\b/i],
  },
  {
    category: "tablet",
    strong: [/\btablet\b|\bipad\b|\btab\s+[a-z]?\d/i],
    veto: [/\bcase\b|\bcover\b|\bkeyboard\b/i],
  },
  {
    category: "tv",
    strong: [
      /\b(smart\s*)?(led|qled|oled)\s*tv\b/i,
      /\btelevision\b/i,
      /\b\d{2}\s*inch\b.*\btv\b/i,
    ],
  },
  {
    category: "camera",
    strong: [/\bdslr\b|\bmirrorless\b|\baction\s*camera\b|\bgopro\b/i],
    veto: [/\bcamera\s*(lens\s*)?(protector|cover)\b/i],
  },
  {
    category: "accessory",
    strong: [
      /\b(back\s*cover|flip\s*cover|tempered\s*glass|screen\s*(guard|protector)|charging\s*cable|usb\s*cable|charger|adapter|power\s*bank|powerbank|car\s*mount|mobile\s*holder|selfie\s*stick|stylus|memory\s*card|sim\s*ejector)\b/i,
      /\bcompatible\s+with\b/i,
      /\bfor\s+(?:apple|samsung|oneplus|xiaomi|redmi|poco|realme|vivo|oppo|iqoo)\b/i,
    ],
  },
];

export interface Classification {
  category: Category;
  confidence: number;
  evidence: string[];
}

export function classify(title: string, url = ""): Classification {
  const text = `${title} ${url.replace(/[-/]/g, " ")}`;
  const scores = new Map<Category, { score: number; evidence: string[] }>();

  for (const rule of RULES) {
    if (rule.veto?.some((r) => r.test(text))) continue;
    let score = 0;
    const evidence: string[] = [];
    for (const r of rule.strong ?? []) {
      const m = text.match(r);
      if (m) {
        score += 3;
        evidence.push(m[0].trim());
      }
    }
    for (const r of rule.weak ?? []) {
      const m = text.match(r);
      if (m) {
        score += 1;
        evidence.push(m[0].trim());
      }
    }
    if (score > 0) scores.set(rule.category, { score, evidence });
  }

  if (scores.size === 0) {
    return { category: "unknown", confidence: 0, evidence: [] };
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [topCat, top] = sorted[0];
  const runnerUp = sorted[1]?.[1].score ?? 0;
  // Confidence rises with absolute evidence and with the margin over #2.
  const margin = (top.score - runnerUp) / Math.max(top.score, 1);
  const confidence = Math.min(
    1,
    (Math.min(top.score, 6) / 6) * 0.6 + margin * 0.4,
  );

  return {
    category: topCat,
    confidence: Math.round(confidence * 100) / 100,
    evidence: top.evidence.slice(0, 4),
  };
}

/** Categories that are acceptable substitutes for one another in a query. */
const COMPATIBLE: Partial<Record<Category, Category[]>> = {
  earbuds: ["headphone"],
  headphone: ["earbuds"],
};

export function categoryMatches(
  wanted: Category,
  actual: Category,
): boolean {
  if (wanted === "unknown") return actual !== "accessory";
  if (wanted === actual) return true;
  return COMPATIBLE[wanted]?.includes(actual) ?? false;
}
