export interface Review {
  stars: number;
  text: string;
  verified: boolean;
  date: string | null;
}

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface AspectTally {
  aspect: string;
  positive: number;
  negative: number;
  example: string | null;
}

export interface ReviewSummary {
  totalRatings: number | null;
  totalReviews: number | null;
  distribution: RatingDistribution | null;
  negativeShare: number | null;
  sampled: number;
  aspects: AspectTally[];
  praised: AspectTally[];
  complained: AspectTally[];
}

const ASPECTS: Array<[string, RegExp]> = [
  ["battery", /\b(battery|backup|charg\w*|drain\w*|power\s*bank)\b/i],
  ["heating", /\b(heat\w*|hot|overheat\w*|temperature|warm)\b/i],
  ["camera", /\b(camera|photo\w*|picture\w*|selfie|video|lens|clarity)\b/i],
  ["display", /\b(display|screen|brightness|bright|touch|refresh)\b/i],
  [
    "performance",
    /\b(performance|speed|fast|slow|lag\w*|hang\w*|gaming|game|processor|smooth)\b/i,
  ],
  ["build", /\b(build|design|look\w*|premium|plastic|sturdy|weight|heavy)\b/i],
  ["sound", /\b(sound|speaker\w*|audio|volume|mic|call\s*quality)\b/i],
  ["software", /\b(ads|bloatware|software|update\w*|ui|android|app\w*)\b/i],
  [
    "service",
    /\b(service|warranty|replace\w*|defective|damaged|return|delivery)\b/i,
  ],
  ["value", /\b(price|budget|worth|value|money|cheap|expensive)\b/i],
];

const POSITIVE =
  /\b(good|great|nice|best|excellent|amazing|awesome|superb|fabulous|love\w*|wow|perfect|satisfied|happy|smooth|fast|strong|clear|beautiful|worth|recommend\w*)\b/i;

const NEGATIVE =
  /\b(bad|poor|worst|worse|issue\w*|problem\w*|slow|lag\w*|drain\w*|heat\w*|hot|defective|damaged|waste|disappoint\w*|useless|cheap|weak|dull|blur\w*|hang\w*|too\s*much|not\s*worth)\b/i;

const NEGATION =
  /\b(not|no|never|isn'?t|doesn'?t|don'?t|can'?t|won'?t|without)\b/i;

const INHERENTLY_NEGATIVE = new Set(["heating"]);

function decodeEntities(s: string): string {
  return s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

export function parseDistribution(text: string): RatingDistribution | null {
  const out: Partial<RatingDistribution> = {};
  for (const m of text.matchAll(/([1-5])\s*★\s*([\d,]+)/g)) {
    const star = Number(m[1]) as 1 | 2 | 3 | 4 | 5;
    out[star] = Number(m[2].replace(/,/g, ""));
  }
  const keys = [1, 2, 3, 4, 5] as const;
  return keys.every((k) => out[k] !== undefined)
    ? (out as RatingDistribution)
    : null;
}

export function parseReviews(text: string): Review[] {
  const out: Review[] = [];
  const parts = text.split(/(?=\b[1-5]\.\d\s*•\s)/);

  for (const part of parts) {
    const head = part.match(/^([1-5]\.\d)\s*•\s*/);
    if (!head) continue;

    let body = part.slice(head[0].length);
    body = body.replace(/Review for:[^|]*?Storage\s*\d+\s*GB\s*/i, " ");
    body = body.replace(/Review for:\s*/i, " ");
    body = body.replace(/\s*Helpful for[\s\S]*$/i, " ");

    out.push({
      stars: Number(head[1]),
      text: decodeEntities(body).replace(/\s+/g, " ").trim(),
      verified: /Verified Purchase/i.test(part),
      date:
        part.match(/Verified Purchase\s*·\s*([A-Za-z]{3,9},?\s*\d{4})/i)?.[1] ??
          null,
    });
  }
  return out;
}

function clauses(text: string): string[] {
  return text
    .split(/[.!?,;]+|\band\b|\bbut\b/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
}

export function mineAspects(reviews: Review[]): AspectTally[] {
  const tally = new Map<string, AspectTally>();

  for (const review of reviews) {
    for (const clause of clauses(review.text)) {
      for (const [aspect, pattern] of ASPECTS) {
        if (!pattern.test(clause)) continue;

        const entry = tally.get(aspect) ??
          { aspect, positive: 0, negative: 0, example: null };

        let positive = POSITIVE.test(clause);
        let negative = NEGATIVE.test(clause);
        if (NEGATION.test(clause)) {
          [positive, negative] = [negative, positive];
        }
        if (INHERENTLY_NEGATIVE.has(aspect) && !NEGATION.test(clause)) {
          negative = true;
          positive = false;
        }

        if (positive && !negative) entry.positive++;
        else if (negative && !positive) entry.negative++;
        else if (review.stars >= 4) entry.positive++;
        else if (review.stars <= 2) entry.negative++;
        else continue;

        if (!entry.example && clause.length <= 70) entry.example = clause;
        tally.set(aspect, entry);
      }
    }
  }

  return [...tally.values()].sort((a, b) =>
    (b.positive + b.negative) - (a.positive + a.negative)
  );
}

export function summariseReviews(pageText: string): ReviewSummary {
  const distribution = parseDistribution(pageText);
  const totals = pageText.match(
    /([\d,]+)\s*ratings?\s*and\s*([\d,]+)\s*reviews?/i,
  );
  const reviews = parseReviews(pageText);
  const aspects = mineAspects(reviews);

  const negativeShare = distribution
    ? (distribution[1] + distribution[2]) /
      Math.max(
        1,
        distribution[1] + distribution[2] + distribution[3] +
          distribution[4] + distribution[5],
      )
    : null;

  const MIN_MENTIONS = 2;
  const decisive = (a: AspectTally, side: "pos" | "neg") => {
    const [win, lose] = side === "pos"
      ? [a.positive, a.negative]
      : [a.negative, a.positive];
    return win >= MIN_MENTIONS && win >= lose * 2;
  };

  return {
    totalRatings: totals ? Number(totals[1].replace(/,/g, "")) : null,
    totalReviews: totals ? Number(totals[2].replace(/,/g, "")) : null,
    distribution,
    negativeShare,
    sampled: reviews.length,
    aspects,
    praised: aspects.filter((a) => decisive(a, "pos")),
    complained: aspects.filter((a) => decisive(a, "neg")),
  };
}

export function reviewsUrlFor(productUrl: string): string | null {
  if (!/flipkart\.com/.test(productUrl) || !productUrl.includes("/p/")) {
    return null;
  }
  const [path, query = ""] = productUrl.split("?");
  const pid = new URLSearchParams(query).get("pid");
  const base = path.replace("/p/", "/product-reviews/");
  return pid ? `${base}?pid=${pid}` : base;
}
