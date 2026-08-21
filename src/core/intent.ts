/**
 * Deterministic intent parsing.
 *
 * Runs with zero network calls and zero API keys. If GEMINI_API_KEY is present
 * the pipeline can layer LLM intent on top (see pipeline.ts), but the rules
 * below must stand alone — every test in the suite depends on them.
 */

import type { Category, RankIntent } from "./types.ts";
import { BRANDS } from "./extract.ts";

const CATEGORY_WORDS: Array<[RegExp, Category]> = [
  [/\b(phones?|smartphones?|mobiles?|handsets?)\b/i, "phone"],
  [/\b(earbuds?|tws|airdopes|neckbands?)\b/i, "earbuds"],
  [/\b(headphones?|headsets?|over[-\s]?ear|on[-\s]?ear)\b/i, "headphone"],
  [/\b(laptops?|notebooks?|macbooks?)\b/i, "laptop"],
  [/\b(tablets?|ipads?)\b/i, "tablet"],
  [
    /\b(smart\s*watch(?:es)?|smartwatch(?:es)?|fitness\s*bands?)\b/i,
    "smartwatch",
  ],
  [/\b(tvs?|televisions?)\b/i, "tv"],
  [/\b(cameras?|dslrs?)\b/i, "camera"],
];

const PRIORITY_WORDS: Array<[RegExp, string]> = [
  [
    /\b(gaming|game|pubg|bgmi|fps|performance|processor|fast)\b/i,
    "performance",
  ],
  [/\b(camera|photo|photography|selfie|video|vlog)\b/i, "camera"],
  [/\b(battery|backup|long\s*lasting|charging|charge)\b/i, "battery"],
  [/\b(display|screen|amoled|refresh|120\s*hz)\b/i, "display"],
  [/\b(compact|light|lightweight|small)\b/i, "compact"],
  [/\b(value|budget|cheap|affordable|vfm|worth)\b/i, "value"],
  [/\b(premium|flagship|best\s*in\s*class)\b/i, "premium"],
];

const MUST_HAVE_WORDS: Array<[RegExp, string]> = [
  [/\b5g\b/i, "5g"],
  [/\bamoled\b/i, "amoled"],
  [/\bnfc\b/i, "nfc"],
  [/\bstereo\b/i, "stereo"],
];

/** "15000", "15k", "15,000", "1.5 lakh", "₹15000" */
function parseAmount(s: string): number | null {
  const cleaned = s.toLowerCase().replace(/[₹,\s]/g, "");
  const m = cleaned.match(/^([\d.]+)(k|l|lakh|lac|cr)?$/);
  if (!m) return null;
  let n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "k") n *= 1_000;
  else if (m[2] === "l" || m[2] === "lakh" || m[2] === "lac") n *= 100_000;
  else if (m[2] === "cr") n *= 10_000_000;
  return n > 0 ? Math.round(n) : null;
}

const AMOUNT = String.raw`(?:₹\s*)?[\d][\d,.]*\s*(?:k|l|lakh|lac|cr)?`;

export function parseIntentRules(query: string): RankIntent {
  const q = query.trim();
  const lower = q.toLowerCase();

  let category: Category = "unknown";
  for (const [re, cat] of CATEGORY_WORDS) {
    if (re.test(lower)) {
      category = cat;
      break;
    }
  }

  let budgetMax: number | null = null;
  let budgetMin: number | null = null;
  let budgetOperator: RankIntent["budgetOperator"] = "none";

  const between = lower.match(
    new RegExp(
      String.raw`(?:between|from)\s*(${AMOUNT})\s*(?:and|to|-)\s*(${AMOUNT})`,
      "i",
    ),
  );
  const under = lower.match(
    new RegExp(
      String
        .raw`(?:under|below|less\s*than|within|upto|up\s*to|max)\s*(${AMOUNT})`,
      "i",
    ),
  );
  const around = lower.match(
    new RegExp(
      String.raw`(?:around|about|near|approx\.?|~)\s*(${AMOUNT})`,
      "i",
    ),
  );
  const over = lower.match(
    new RegExp(
      String.raw`(?:over|above|more\s*than|at\s*least)\s*(${AMOUNT})`,
      "i",
    ),
  );

  if (between) {
    budgetMin = parseAmount(between[1]);
    budgetMax = parseAmount(between[2]);
    budgetOperator = "between";
  } else if (under) {
    budgetMax = parseAmount(under[1]);
    budgetOperator = "under";
  } else if (around) {
    const c = parseAmount(around[1]);
    if (c) {
      budgetMin = Math.round(c * 0.85);
      budgetMax = Math.round(c * 1.15);
      budgetOperator = "around";
    }
  } else if (over) {
    budgetMin = parseAmount(over[1]);
    budgetOperator = "over";
  } else {
    // Bare trailing number in a shopping query is almost always a budget.
    const bare = lower.match(new RegExp(String.raw`(?:^|\s)(${AMOUNT})\s*$`));
    const n = bare ? parseAmount(bare[1]) : null;
    if (n && n >= 500) {
      budgetMax = n;
      budgetOperator = "under";
    }
  }

  const brands: string[] = [];
  const excludeBrands: string[] = [];
  for (const [re, name] of BRANDS) {
    if (!re.test(lower)) continue;
    const notRe = new RegExp(
      String.raw`\b(?:no|not|except|excluding|other\s+than)\s+\w*\s*${name}`,
      "i",
    );
    if (notRe.test(lower)) excludeBrands.push(name);
    else brands.push(name);
  }

  const priorities: string[] = [];
  for (const [re, p] of PRIORITY_WORDS) {
    if (re.test(lower) && !priorities.includes(p)) priorities.push(p);
  }

  const mustHave: string[] = [];
  for (const [re, m] of MUST_HAVE_WORDS) {
    if (re.test(lower)) mustHave.push(m);
  }

  // A specific model mention ("redmi note 14", "wh-1000xm5") tightens matching.
  const modelHint = lower.match(
    /\b([a-z]+\s*[-]?\s*\d{2,4}[a-z]*(?:\s*(?:pro|plus|ultra|lite|max|5g))?)\b/i,
  )?.[1] ?? null;

  return {
    raw: q,
    category,
    brands,
    excludeBrands,
    budgetMax,
    budgetMin,
    budgetOperator,
    priorities,
    mustHave,
    modelHint: budgetMax && modelHint && parseAmount(modelHint)
      ? null
      : modelHint,
  };
}

export function describeIntent(i: RankIntent): string {
  const parts: string[] = [];
  parts.push(i.category === "unknown" ? "any product" : i.category);
  if (i.brands.length) parts.push(`brand: ${i.brands.join("/")}`);
  if (i.budgetOperator === "under" && i.budgetMax) {
    parts.push(`under ₹${i.budgetMax.toLocaleString("en-IN")}`);
  } else if (i.budgetOperator === "between") {
    parts.push(
      `₹${i.budgetMin?.toLocaleString("en-IN")}–₹${
        i.budgetMax?.toLocaleString("en-IN")
      }`,
    );
  } else if (i.budgetOperator === "around" && i.budgetMax) {
    parts.push(
      `around ₹${
        Math.round(((i.budgetMin ?? 0) + i.budgetMax) / 2).toLocaleString(
          "en-IN",
        )
      }`,
    );
  } else if (i.budgetOperator === "over" && i.budgetMin) {
    parts.push(`over ₹${i.budgetMin.toLocaleString("en-IN")}`);
  }
  if (i.priorities.length) parts.push(`priorities: ${i.priorities.join(", ")}`);
  if (i.mustHave.length) parts.push(`must have: ${i.mustHave.join(", ")}`);
  return parts.join(" · ");
}
