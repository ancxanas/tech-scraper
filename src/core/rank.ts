import type {
  Candidate,
  RankedCandidate,
  RankIntent,
  ScoreBreakdown,
  Specs,
} from "./types.ts";
import { categoryMatches } from "./classify.ts";

function curve(value: number, points: Array<[number, number]>): number {
  if (value <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (value <= x2) {
      const t = (value - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return last[1];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

const PANEL_SCORE: Record<string, number> = {
  AMOLED: 100,
  pOLED: 100,
  "PLS LCD": 55,
  "IPS LCD": 55,
  "TFT LCD": 40,
};

function perfScore(antutu: number | null): number | null {
  if (antutu === null) return null;
  const lo = Math.log(150_000);
  const hi = Math.log(2_200_000);
  return clamp(((Math.log(antutu) - lo) / (hi - lo)) * 100);
}

function memoryScore(s: Specs): number | null {
  if (s.ramGb === null && s.storageGb === null) return null;
  const ram = s.ramGb === null
    ? null
    : curve(s.ramGb, [[2, 10], [4, 35], [6, 60], [8, 80], [12, 95], [16, 100]]);
  const storage = s.storageGb === null
    ? null
    : curve(s.storageGb, [[32, 10], [64, 35], [128, 65], [256, 85], [512, 97], [
      1024,
      100,
    ]]);
  if (ram === null) return storage;
  if (storage === null) return ram;
  return ram * 0.5 + storage * 0.5;
}

function displayScore(s: Specs): number | null {
  const parts: Array<[number, number]> = [];
  if (s.panel) parts.push([PANEL_SCORE[s.panel] ?? 50, 0.4]);
  if (s.refreshHz !== null) {
    parts.push([
      curve(s.refreshHz, [[60, 35], [90, 65], [120, 90], [144, 97], [
        165,
        100,
      ]]),
      0.35,
    ]);
  }
  if (s.resolution) {
    parts.push([
      s.resolution === "QHD+" ? 100 : s.resolution === "FHD+" ? 80 : 45,
      0.25,
    ]);
  }
  if (parts.length === 0) return null;
  const w = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return parts.reduce((sum, [v, weight]) => sum + v * weight, 0) / w;
}

function batteryScore(s: Specs): number | null {
  const parts: Array<[number, number]> = [];
  if (s.batteryMah !== null) {
    parts.push([
      curve(s.batteryMah, [[3000, 15], [4000, 35], [5000, 65], [6000, 88], [
        7000,
        100,
      ]]),
      0.7,
    ]);
  }
  if (s.chargingW !== null) {
    parts.push([
      curve(s.chargingW, [[10, 15], [18, 35], [33, 60], [45, 75], [67, 90], [
        100,
        100,
      ]]),
      0.3,
    ]);
  }
  if (parts.length === 0) return null;
  const w = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return parts.reduce((sum, [v, weight]) => sum + v * weight, 0) / w;
}

function cameraScore(s: Specs): number | null {
  if (s.mainCameraMp === null && s.ois === null) return null;
  let base = s.mainCameraMp === null
    ? 50
    : curve(s.mainCameraMp, [[8, 15], [13, 30], [32, 55], [50, 72], [64, 78], [
      108,
      88,
    ], [200, 95]]);
  if (s.ois === true) base = Math.min(100, base + 12);
  // The main sensor is table stakes at every tier above budget; the ARRAY
  // is what makes a camera phone. Without these bonuses a "camera priority"
  // query cannot separate a dozen identical 50MP+OIS handsets.
  if (s.teleMp !== null) base += 10;
  if (s.ultraWideMp !== null) base += 6;
  if (s.aperture !== null) {
    if (s.aperture <= 1.7) base += 6;
    else if (s.aperture <= 2.0) base += 3;
  }
  return Math.min(100, Math.round(base));
}

function extrasScore(s: Specs): number | null {
  let known = 0;
  let score = 0;
  const add = (has: boolean | null, weight: number) => {
    if (has === null) return;
    known += weight;
    if (has) score += weight;
  };
  add(s.has5g, 35);
  add(s.nfc, 15);
  add(s.ipRating !== null ? true : null, 20);
  if (s.osUpgrades !== null) {
    known += 30;
    score += curve(s.osUpgrades, [[0, 0], [2, 15], [4, 27], [6, 30]]);
  }
  if (known === 0) return null;
  return (score / known) * 100;
}

export function specWeights(intent: RankIntent): Record<string, number> {
  const base: Record<string, number> = {
    performance: 0.3,
    memory: 0.15,
    display: 0.18,
    battery: 0.17,
    camera: 0.12,
    extras: 0.08,
  };

  const boost: Record<string, string> = {
    performance: "performance",
    camera: "camera",
    battery: "battery",
    display: "display",
  };
  for (const p of intent.priorities) {
    const key = boost[p];
    if (key && base[key] !== undefined) base[key] += 0.15;
  }
  const total = Object.values(base).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(base)) base[k] /= total;
  return base;
}

function trustScore(
  rating: number | null,
  count: number | null,
  priorMean: number,
): number | null {
  if (rating === null) return null;
  const m = 500;
  const v = count ?? 0;
  const blended = (v / (v + m)) * rating + (m / (v + m)) * priorMean;
  const base = clamp(((blended - 3.0) / 1.7) * 100);
  const evidence = clamp(0.35 + Math.log10(v + 1) / 5.5, 0.35, 1);
  const NEUTRAL = 45;
  return clamp(NEUTRAL + (base - NEUTRAL) * evidence);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Specs nobody can vouch for are claims, not facts. A listing with real
 * buyer volume, or one the knowledge base independently confirms, gets
 * full credit; an anonymous sheet on a no-name card gets a fraction.
 * Without this, "Dimensity 7400 + pOLED for ₹8,499" from a 1-rating
 * seller outranks every honest phone in the table.
 */
export function corroboration(c: {
  ratingCount?: number | null;
  kbConfidence?: Candidate["kbConfidence"];
}): number {
  if ((c.ratingCount ?? 0) >= 5) return 1;
  switch (c.kbConfidence) {
    case "high":
      return 0.95;
    case "medium":
      return 0.85;
    case "low":
      return 0.75;
    default:
      return 0.6;
  }
}

function specTotalWithCorroboration(c: Candidate, total: number): number {
  return total * corroboration(c);
}

function percentileRank(value: number, sorted: number[]): number {
  if (sorted.length <= 1) return 50;
  let below = 0;
  for (const v of sorted) if (v < value) below++;
  return (below / (sorted.length - 1)) * 100;
}

function modelToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesModel(
  hint: string | null,
  brands: string[],
  name: string,
  key: string,
): boolean {
  if (!hint) return false;
  const h = modelToken(hint);
  if (h.length < 2 || !/\d/.test(h)) return false;
  const hay = modelToken(`${name} ${key}`);
  if (!hay.includes(h)) return false;
  if (h.length <= 3 && brands.length > 0) {
    return brands.some((b) => hay.includes(modelToken(b)));
  }
  return true;
}

export interface PriceHistoryEntry {
  min: number;
  max: number;
  position: number;
  trend: "falling" | "rising" | "stable";
  observations: number;
  runs: number;
  daysTracked: number;
}

export interface RankOptions {
  priceHistory?: Map<string, PriceHistoryEntry>;
  inStockOnly?: boolean;
  excludeSponsored?: boolean;
  budgetTolerance?: number;
}

export interface RankOutcome {
  ranked: RankedCandidate[];
  rejected: Array<{ candidate: Candidate; reasons: string[] }>;
}

export function rankCandidates(
  candidates: Candidate[],
  intent: RankIntent,
  options: RankOptions = {},
): RankOutcome {
  const tolerance = options.budgetTolerance ?? 0;
  const rejected: Array<{ candidate: Candidate; reasons: string[] }> = [];
  const survivors: Candidate[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];

    if (!categoryMatches(intent.category, c.category)) {
      reasons.push(
        `category: ${c.category} ≠ ${intent.category}`,
      );
    }
    if (c.category === "accessory") reasons.push("accessory, not a product");

    const price = c.best.price;
    if (!price || price <= 0) reasons.push("no usable price");

    if (price && intent.budgetMax) {
      const ceiling = intent.budgetMax * (1 + tolerance);
      if (price > ceiling) {
        reasons.push(
          `₹${price.toLocaleString("en-IN")} over budget ₹${
            intent.budgetMax.toLocaleString("en-IN")
          }`,
        );
      }
    }
    if (price && intent.budgetMin && price < intent.budgetMin) {
      reasons.push(`₹${price.toLocaleString("en-IN")} below asked range`);
    }

    if (intent.brands.length && c.brand && !intent.brands.includes(c.brand)) {
      reasons.push(`brand ${c.brand} not requested`);
    }
    if (
      intent.excludeBrands.length && c.brand &&
      intent.excludeBrands.includes(c.brand)
    ) {
      reasons.push(`brand ${c.brand} excluded`);
    }

    for (const must of intent.mustHave) {
      if (must === "5g" && c.specs.has5g === false) reasons.push("not 5G");
      if (must === "amoled" && c.specs.panel && !/oled/i.test(c.specs.panel)) {
        reasons.push("not AMOLED");
      }
      if (must === "nfc" && c.specs.nfc === false) reasons.push("no NFC");
      if (must === "ois" && c.specs.ois === false) {
        reasons.push("no stabilisation on the main camera");
      }
    }

    if (options.inStockOnly && c.offers.every((o) => o.inStock === false)) {
      reasons.push("out of stock everywhere");
    }

    if (reasons.length) rejected.push({ candidate: c, reasons });
    else survivors.push(c);
  }

  if (survivors.length === 0) return { ranked: [], rejected };

  const weights = specWeights(intent);
  const rawComponents: Array<Record<string, number | null>> = survivors.map((
    c,
  ): Record<string, number | null> => ({
    performance: perfScore(c.specs.antutu),
    memory: memoryScore(c.specs),
    display: displayScore(c.specs),
    battery: batteryScore(c.specs),
    camera: cameraScore(c.specs),
    extras: extrasScore(c.specs),
  }));

  const peerMedian: Record<string, number> = {};
  for (const key of Object.keys(weights)) {
    const vals = rawComponents
      .map((r) => (r as Record<string, number | null>)[key])
      .filter((v): v is number => v !== null);
    peerMedian[key] = (median(vals) ?? 50) * 0.9;
  }

  const ratings = survivors.map((c) => c.rating).filter((r): r is number =>
    r !== null
  );
  const priorMean = ratings.length
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : 4.0;

  const specScores = survivors.map((_c, i) => {
    const comp = rawComponents[i] as unknown as Record<string, number | null>;
    let total = 0;
    let imputedWeight = 0;
    for (const [key, w] of Object.entries(weights)) {
      if (w === 0) continue;
      const v = comp[key];
      if (v === null) {
        total += peerMedian[key] * w;
        imputedWeight += w;
      } else {
        total += v * w;
      }
    }
    return { total: clamp(total), imputedWeight, comp };
  });

  const ratios = survivors.map((c, i) =>
    specTotalWithCorroboration(c, specScores[i].total) /
    (c.best.price / 1000)
  );
  const sortedRatios = [...ratios].sort((a, b) => a - b);

  const prices = survivors.map((c) => c.best.price);
  const medPrice = median(prices) ?? 0;

  const ranked: RankedCandidate[] = survivors.map((c, i) => {
    const spec = specScores[i];
    const comp = spec.comp;

    const evidence = 1 - spec.imputedWeight;
    const valueScore = clamp(
      percentileRank(ratios[i], sortedRatios) * (0.45 + 0.55 * evidence),
    );
    const trust = trustScore(c.rating, c.ratingCount, priorMean);

    let deal = 50;
    const o = c.best;
    if (o.discountPct !== null && o.mrp) {
      const d = o.discountPct;
      // Above 55% off the deal is a story, not a price - the same threshold
      // the table stars with an asterisk. Such MRPs add nothing here; a
      // fabricated discount must not buy ranking points.
      if (d > 55) {
        deal -= 6;
      } else {
        const credible = d <= 40 ? d : Math.max(0, 40 - (d - 40) * 2);
        deal += credible * 0.6;
      }
    }
    if (c.offers.length > 1) {
      const spread = Math.max(...c.offers.map((x) => x.price)) - o.price;
      if (spread > 0) deal += Math.min(15, (spread / o.price) * 100);
      deal += 5;
    }
    if (medPrice && o.price < medPrice) deal += 5;

    const hist = options.priceHistory?.get(c.key);
    if (hist && hist.runs >= 2) {
      if (o.price <= hist.min) deal += 20;
      else if (hist.position <= 0.15) deal += 12;
      else if (hist.position >= 0.85) deal -= 12;
      if (hist.trend === "falling") deal -= 4;
      else if (hist.trend === "rising") deal += 4;
    }
    const dealScore = clamp(deal);

    const confidence = clamp(
      (1 - spec.imputedWeight) * 60 +
        c.specCompleteness * 20 +
        (c.rating !== null ? 10 : 0) +
        (c.kbConfidence === "high"
          ? 10
          : c.kbConfidence === "medium"
          ? 6
          : c.kbConfidence === "low"
          ? 3
          : 0),
      0,
      100,
    ) / 100;

    // Two products share this ranker. A bargain query ("budget phones",
    // "value for money") wants the most quality per rupee, so cheapness
    // carries half the score. A ceiling query ("best under 50000") wants
    // the best phone the budget allows - there the spec sheet leads,
    // trust breaks ties between equals, and deal only polishes.
    const bargain = intent.priorities.includes("value");
    const totalRaw = bargain
      ? valueScore * 0.35 +
        spec.total * corroboration(c) * 0.3 +
        (trust ?? 45) * 0.2 +
        dealScore * 0.15
      : spec.total * corroboration(c) * 0.6 +
        (trust ?? 45) * 0.25 +
        dealScore * 0.15;

    const total = clamp(totalRaw * (0.7 + 0.3 * confidence));

    const pick = (k: string) => Math.round(comp[k] ?? peerMedian[k] ?? 45);
    const score: ScoreBreakdown = {
      performance: pick("performance"),
      display: pick("display"),
      battery: pick("battery"),
      camera: pick("camera"),
      memory: pick("memory"),
      extras: pick("extras"),
      specScore: Math.round(spec.total),
      valueScore: Math.round(valueScore),
      trustScore: Math.round(trust ?? 45),
      dealScore: Math.round(dealScore),
      total: Math.round(total * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };

    return {
      ...c,
      rank: 0,
      matchesRequestedModel: matchesModel(
        intent.modelHint,
        intent.brands,
        c.modelName,
        c.key,
      ),
      score,
      pros: [],
      cons: [],
      verdict: "",
      badges: [],
    };
  });

  const anyExactMatch = ranked.some((r) => r.matchesRequestedModel);
  // Anything you cannot buy sorts below everything you can. A replay put an
  // out-of-stock Galaxy M17 at #1 wearing TOP PICK, which is not a
  // recommendation — it is a phone the reader cannot act on. It stays in the
  // table, badged, because the price is still useful context; it just cannot
  // lead. Applied before score so no amount of value outranks availability.
  const unbuyable = (r: RankedCandidate) => Number(r.best.inStock === false);
  // Nothing to go on: no chipset read from anywhere, and too few buyers for
  // the rating to mean anything. A 1-star phone with one review and "SoC ?"
  // was reaching the top ten on a fabricated discount. Scored down rather
  // than sorted into a hidden tier, so the table stays ordered by the number
  // it displays and the reason shows up in the row.
  for (const r of ranked) {
    r.unvouchable = !r.specs.socName && (r.ratingCount ?? 0) < 20;
    if (r.unvouchable) r.score.total = clamp(r.score.total * 0.7);
  }
  ranked.sort((a, b) =>
    (anyExactMatch
      ? Number(b.matchesRequestedModel) - Number(a.matchesRequestedModel)
      : 0) ||
    unbuyable(a) - unbuyable(b) ||
    b.score.total - a.score.total ||
    b.score.confidence - a.score.confidence ||
    a.best.price - b.best.price
  );
  // One row per phone. Three storage variants of the same handset filling
  // three of the top five is a list of configs, not a recommendation - and
  // every row already carries its siblings under "Other configs".
  const bestOfModel = new Map<string, RankedCandidate>();
  for (const r of ranked) {
    const model = r.key.split("|")[0];
    const seen = bestOfModel.get(model);
    if (seen) r.variantOf = seen.modelName;
    else bestOfModel.set(model, r);
  }

  ranked.forEach((r, i) => (r.rank = i + 1));

  annotate(ranked, intent, options.priceHistory);
  return { ranked, rejected };
}

function annotate(
  ranked: RankedCandidate[],
  intent: RankIntent,
  priceHistory?: Map<string, PriceHistoryEntry>,
): void {
  if (ranked.length === 0) return;
  const anyMatch = ranked.some((r) => r.matchesRequestedModel);

  const med = {
    price: median(ranked.map((r) => r.best.price)) ?? 0,
    battery: median(
      ranked.map((r) => r.specs.batteryMah).filter((v): v is number =>
        v !== null
      ),
    ),
    antutu: median(
      ranked.map((r) => r.specs.antutu).filter((v): v is number => v !== null),
    ),
    ram: median(
      ranked.map((r) => r.specs.ramGb).filter((v): v is number => v !== null),
    ),
    storage: median(
      ranked.map((r) => r.specs.storageGb).filter((v): v is number =>
        v !== null
      ),
    ),
  };

  const badgesFromHistory = new Set<string>();
  const credible = ranked.filter((r) => r.score.confidence >= 0.5);
  const pool = credible.length >= 2 ? credible : ranked;

  const isVouchable = (r: RankedCandidate) =>
    r.best.inStock !== false &&
    r.score.confidence >= 0.6 &&
    r.specs.socName !== null &&
    (r.ratingCount ?? 0) >= 100 &&
    (r.rating ?? 0) >= 3.5;

  const vouchable = pool.filter(isVouchable);
  const recommendPool = vouchable.length >= 2 ? vouchable : pool;

  const cheapest = ranked.reduce((
    a,
    b,
  ) => (b.best.price < a.best.price ? b : a));
  const bestValue = recommendPool.reduce((
    a,
    b,
  ) => (b.score.valueScore > a.score.valueScore ? b : a));
  const fastest = pool.reduce((
    a,
    b,
  ) => (b.score.performance > a.score.performance ? b : a));
  const fastestIsClear = !pool.some((r) =>
    r !== fastest && r.score.performance >= fastest.score.performance - 0.5
  );
  const bestRated = pool
    .filter((r) => (r.ratingCount ?? 0) > 500)
    .reduce<RankedCandidate | null>(
      (a, b) => (a === null || b.score.trustScore > a.score.trustScore ? b : a),
      null,
    );
  const bestBattery = pool.reduce((
    a,
    b,
  ) => (b.score.battery > a.score.battery ? b : a));
  const batteryIsClear = !pool.some((r) =>
    r !== bestBattery && r.score.battery >= bestBattery.score.battery - 0.5
  );

  for (const r of ranked) {
    const pros: string[] = [];
    const cons: string[] = [];
    const s = r.specs;

    if (s.socName) {
      const tierWord = s.perfTier?.replace("-", " ") ?? "";
      if (med.antutu && s.antutu && s.antutu > med.antutu * 1.15) {
        pros.push(
          tierWord
            ? `${s.socName} — faster than most here (${tierWord})`
            : `${s.socName} — faster than most here`,
        );
      } else if (med.antutu && s.antutu && s.antutu < med.antutu * 0.8) {
        cons.push(`${s.socName} is slower than the segment median`);
      }
    } else {
      cons.push("chipset unknown — performance not verified");
    }

    if (s.panel && /oled/i.test(s.panel)) {
      pros.push(`${s.panel} panel`);
    } else if (s.panel) cons.push(`${s.panel} panel (no OLED)`);
    if (s.refreshHz && s.refreshHz >= 120) {
      pros.push(`${s.refreshHz}Hz display`);
    } else if (s.refreshHz && s.refreshHz <= 60) cons.push("60Hz display");
    if (s.resolution === "HD+") cons.push("HD+ resolution only");

    if (
      s.batteryMah && med.battery && s.batteryMah >= med.battery * 1.1
    ) {
      pros.push(`${s.batteryMah}mAh battery`);
    }
    if (s.chargingW && s.chargingW >= 33) {
      pros.push(`${s.chargingW}W charging`);
    } else if (s.chargingW && s.chargingW <= 15) {
      cons.push(`slow ${s.chargingW}W charging`);
    }

    if (s.ramGb && med.ram && s.ramGb > med.ram) {
      pros.push(`${s.ramGb}GB RAM`);
    }
    if (s.storageGb && med.storage && s.storageGb < med.storage) {
      cons.push(`only ${s.storageGb}GB storage`);
    }
    if (s.has5g === false) cons.push("4G only");
    if (s.ois) pros.push("OIS on main camera");
    if (s.ipRating) pros.push(`${s.ipRating} rated`);

    if (r.best.price < med.price * 0.85) {
      pros.push(
        `₹${
          Math.round(med.price - r.best.price).toLocaleString("en-IN")
        } below segment median`,
      );
    }
    if (r.offers.length > 1) {
      pros.push(
        `${r.offers.length} offers — cheapest on ${r.best.platformName}`,
      );
    }
    if (r.rating !== null && r.rating >= 4.2 && (r.ratingCount ?? 0) > 1000) {
      pros.push(`${r.rating}★ from ${formatCount(r.ratingCount!)} buyers`);
    }
    if (r.rating !== null && r.rating < 3.9) {
      cons.push(`weak ${r.rating}★ rating`);
    }
    if (r.unvouchable) {
      cons.unshift("no chipset found and almost no buyers — nothing to verify");
    }
    if ((r.ratingCount ?? 0) < 100) cons.push("very few reviews — unproven");
    if (r.best.inStock === false) {
      cons.unshift("out of stock in this colour/variant right now");
    }

    const hist = priceHistory?.get(r.key);
    if (hist && hist.runs >= 2) {
      if (r.best.price <= hist.min) {
        pros.unshift(
          hist.daysTracked >= 1
            ? `lowest price in ${hist.daysTracked} day(s) of tracking`
            : "lowest price we have recorded so far",
        );
        badgesFromHistory.add(r.key);
      } else if (hist.position >= 0.85) {
        cons.push(
          `near its recorded high of ₹${hist.max.toLocaleString("en-IN")}`,
        );
      }
      if (hist.trend === "falling") {
        cons.push("price is still trending down — worth waiting");
      }
    }
    if (r.best.discountPct !== null && r.best.discountPct > 55) {
      cons.push(`${r.best.discountPct}% "discount" — inflated MRP likely`);
    }
    if (r.score.confidence < 0.5) {
      cons.push("limited spec data — verify before buying");
    }
    if (r.kbConfidence === "low") cons.push("spec sheet partly unverified");
    const qualifier = r.key.match(/#([a-z+-]+)\|/)?.[1];
    if (qualifier) {
      cons.unshift(
        qualifier === "carrier-locked"
          ? "carrier-locked SKU — cheaper but tied to one network"
          : `${
            qualifier.replace(/[+]/g, " + ")
          } unit, not a standard new device`,
      );
    }

    const badges: string[] = [];
    if (anyMatch && !r.matchesRequestedModel) badges.push("ALTERNATIVE");
    if (r === bestValue && isVouchable(r)) badges.push("BEST VALUE");
    if (r === cheapest) badges.push("CHEAPEST");
    if (
      r === fastest && fastestIsClear && (r.specs.antutu ?? 0) > 0 &&
      isVouchable(r)
    ) {
      badges.push("FASTEST");
    }
    if (
      r === bestBattery && batteryIsClear && (r.specs.batteryMah ?? 0) > 0
    ) {
      badges.push("BATTERY KING");
    }
    if (bestRated && r === bestRated) badges.push("BEST RATED");
    if (r.best.inStock === false) badges.unshift("OUT OF STOCK");
    if (badgesFromHistory.has(r.key)) badges.push("LOWEST YET");
    if (r.rank === 1) badges.unshift("TOP PICK");

    r.pros = pros.slice(0, 5);
    r.cons = cons.slice(0, 4);
    r.badges = badges;
    r.verdict = buildVerdict(r, intent, med.price, r === fastest);
  }
}

function buildVerdict(
  r: RankedCandidate,
  intent: RankIntent,
  medPrice: number,
  leadsPerformance: boolean,
): string {
  const price = `₹${r.best.price.toLocaleString("en-IN")}`;
  const bits: string[] = [];
  // A ceiling query picked this phone for quality, not price. Calling the
  // best phone "the cheapest way into the segment" reads like an apology.
  const bargain = intent.priorities.includes("value");

  if (r.rank === 1) {
    bits.push(`Best overall pick at ${price}`);
  } else if (r.score.valueScore >= 80 && bargain) {
    bits.push(`Strong value at ${price}`);
  } else if (bargain && r.best.price < medPrice * 0.85) {
    bits.push(`Cheapest way into this segment at ${price}`);
  } else {
    bits.push(`Solid option at ${price}`);
  }

  const strengths: string[] = [];
  if (r.score.performance >= 65) strengths.push("performance");
  if (r.score.battery >= 75) strengths.push("battery");
  if (r.score.display >= 75) strengths.push("display");
  if (r.score.camera >= 75) strengths.push("camera");
  if (strengths.length) bits.push(`leads on ${strengths.join(" and ")}`);

  const weak: string[] = [];
  if (r.score.performance < 40 && !leadsPerformance) weak.push("raw speed");
  if (r.score.display < 45) weak.push("screen quality");
  if (r.score.battery < 45) weak.push("battery");
  if (weak.length) bits.push(`compromises on ${weak.join(" and ")}`);

  if (intent.priorities.includes("performance") && r.score.performance < 50) {
    bits.push("not ideal for gaming");
  }
  if (r.score.confidence < 0.5) bits.push("specs partly inferred");

  return `${bits.join("; ")}.`;
}

export function formatCount(n: number): string {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
