/** Core data model for the ranking pipeline. */

/**
 * This tool ranks phones. Everything else exists in this union only so the
 * classifier can name what it rejected — "11 earbuds filtered out" is far more
 * useful than "11 items filtered out", and it is how we caught the Reliance
 * collector returning audio for a phone query.
 *
 * `phone` is the only rankable value. See RANKABLE below.
 */
export type Category =
  | "phone"
  | "tablet"
  | "laptop"
  | "headphone"
  | "earbuds"
  | "smartwatch"
  | "tv"
  | "camera"
  | "accessory"
  | "unknown";

/** The single category this tool is willing to rank. */
export const RANKABLE: Category = "phone";

export type PlatformId =
  | "flipkart"
  | "amazon"
  | "reliance"
  | "tatacliq"
  | "unknown";

/** A single raw marketplace card after normalisation. */
export interface Listing {
  id: string;
  platform: PlatformId;
  platformName: string;
  title: string;
  /** Where the title came from — "slug" means we recovered it from the URL. */
  titleSource: "field" | "slug" | "unknown";
  url: string;
  imageUrl: string | null;
  price: number | null;
  mrp: number | null;
  discountPct: number | null;
  rating: number | null;
  ratingCount: number | null;
  availability: string | null;
  inStock: boolean | null;
  sponsored: boolean;
  /** Position in the platform's own result list (1-based) if known. */
  sourceRank: number | null;
  scrapedAt: string;
  /** Fields the source simply did not provide. */
  missing: string[];
  raw: Record<string, unknown>;
}

export interface Specs {
  ramGb: number | null;
  storageGb: number | null;
  batteryMah: number | null;
  chargingW: number | null;
  displayInches: number | null;
  refreshHz: number | null;
  panel: string | null;
  resolution: string | null;
  mainCameraMp: number | null;
  ois: boolean | null;
  has5g: boolean | null;
  ipRating: string | null;
  nfc: boolean | null;
  socName: string | null;
  antutu: number | null;
  perfTier: string | null;
  osUpgrades: number | null;
  releaseYear: number | null;
  colour: string | null;
}

export type SpecSource = "title" | "slug" | "kb" | "enrich" | "inferred";

export interface AnalyzedListing extends Listing {
  category: Category;
  categoryConfidence: number;
  brand: string | null;
  /** Normalised model identity, e.g. "poco m7 5g". */
  modelKey: string | null;
  /** Human-readable model name, e.g. "POCO M7 5G". */
  modelName: string;
  /** Config identity within a model: "8gb-128gb". */
  configKey: string;
  specs: Specs;
  specSources: Partial<Record<keyof Specs, SpecSource>>;
  /** 0..1 — how much of the spec sheet we actually know. */
  specCompleteness: number;
  kbConfidence: "high" | "medium" | "low" | "none";
  /** Reasons this listing was rejected, if any. */
  rejected: string[];
}

export interface Offer {
  platform: PlatformId;
  platformName: string;
  price: number;
  mrp: number | null;
  discountPct: number | null;
  url: string;
  inStock: boolean | null;
  rating: number | null;
  ratingCount: number | null;
}

/** One ranked entity = one model+config, with every offer we found for it. */
export interface Candidate {
  key: string;
  modelName: string;
  brand: string | null;
  category: Category;
  specs: Specs;
  specSources: Partial<Record<keyof Specs, SpecSource>>;
  specCompleteness: number;
  kbConfidence: "high" | "medium" | "low" | "none";
  /** Cheapest in-stock offer. */
  best: Offer;
  offers: Offer[];
  /** Other RAM/storage configs of the same model that we also saw. */
  siblingConfigs: Array<{ configKey: string; price: number }>;
  rating: number | null;
  ratingCount: number | null;
  imageUrl: string | null;
  /** Checkout details from the product page, when enrichment ran. */
  checkout?: import("./offers.ts").CheckoutInfo;
  listings: AnalyzedListing[];
}

export interface ScoreBreakdown {
  performance: number;
  display: number;
  battery: number;
  camera: number;
  memory: number;
  extras: number;
  /** Weighted spec quality 0..100. */
  specScore: number;
  /** Spec points per rupee, percentile-normalised 0..100. */
  valueScore: number;
  /** Bayesian-adjusted user rating 0..100. */
  trustScore: number;
  /** Deal quality vs. peers + MRP credibility 0..100. */
  dealScore: number;
  /** Final blended 0..100. */
  total: number;
  /** 0..1 confidence in the above, driven by data completeness. */
  confidence: number;
}

export interface RankedCandidate extends Candidate {
  rank: number;
  /** True when the query named a specific model and this is that model. */
  matchesRequestedModel: boolean;
  score: ScoreBreakdown;
  pros: string[];
  cons: string[];
  verdict: string;
  badges: string[];
}

export interface PipelineDiagnostics {
  platform: string;
  rawCards: number;
  normalized: number;
  titleRecovered: number;
  priced: number;
  categoryMatched: number;
  inBudget: number;
  survived: number;
  fieldFill: number;
  status: "ok" | "error" | "empty";
  error?: string;
  rejectionReasons: Record<string, number>;
}

export interface PipelineResult {
  query: string;
  intent: RankIntent;
  ranked: RankedCandidate[];
  rejected: AnalyzedListing[];
  diagnostics: PipelineDiagnostics[];
  stats: {
    rawCards: number;
    candidates: number;
    ranked: number;
    medianPrice: number | null;
    priceRange: [number, number] | null;
  };
}

/** What the user actually asked for, after intent parsing. */
export interface RankIntent {
  raw: string;
  /**
   * What the user appears to be shopping for. Anything other than "phone"
   * means we decline the query rather than rank it badly — see the laptop
   * experiment in docs/RANKING-V2.md.
   */
  category: Category;
  brands: string[];
  excludeBrands: string[];
  budgetMax: number | null;
  budgetMin: number | null;
  budgetOperator: "under" | "around" | "over" | "between" | "none";
  /** Priorities detected in the query: gaming, camera, battery, display... */
  priorities: string[];
  mustHave: string[];
  modelHint: string | null;
}
