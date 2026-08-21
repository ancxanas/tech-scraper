export type Category =
  | "phone"
  | "featurephone"
  | "tablet"
  | "laptop"
  | "headphone"
  | "earbuds"
  | "smartwatch"
  | "tv"
  | "camera"
  | "accessory"
  | "unknown";

export const RANKABLE: Category = "phone";

export type PlatformId =
  | "flipkart"
  | "amazon"
  | "reliance"
  | "tatacliq"
  | "unknown";

export interface Listing {
  id: string;
  platform: PlatformId;
  platformName: string;
  title: string;
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
  sourceRank: number | null;
  scrapedAt: string;
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

export type SpecSource =
  | "gsmarena"
  | "enrich"
  | "kb"
  | "title"
  | "slug"
  | "inferred";

export interface AnalyzedListing extends Listing {
  category: Category;
  categoryConfidence: number;
  brand: string | null;
  modelKey: string | null;
  modelName: string;
  configKey: string;
  specs: Specs;
  specSources: Partial<Record<keyof Specs, SpecSource>>;
  specCompleteness: number;
  kbConfidence: "high" | "medium" | "low" | "none";
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

export interface Candidate {
  key: string;
  modelName: string;
  brand: string | null;
  category: Category;
  specs: Specs;
  specSources: Partial<Record<keyof Specs, SpecSource>>;
  specCompleteness: number;
  kbConfidence: "high" | "medium" | "low" | "none";
  best: Offer;
  offers: Offer[];
  siblingConfigs: Array<{ configKey: string; price: number }>;
  rating: number | null;
  ratingCount: number | null;
  imageUrl: string | null;
  checkout?: import("./checkout.ts").CheckoutInfo;
  reviews?: import("./reviews.ts").ReviewSummary;
  listings: AnalyzedListing[];
}

export interface ScoreBreakdown {
  performance: number;
  display: number;
  battery: number;
  camera: number;
  memory: number;
  extras: number;
  specScore: number;
  valueScore: number;
  trustScore: number;
  dealScore: number;
  total: number;
  confidence: number;
}

export interface RankedCandidate extends Candidate {
  rank: number;
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

export interface RankIntent {
  raw: string;
  category: Category;
  brands: string[];
  excludeBrands: string[];
  budgetMax: number | null;
  budgetMin: number | null;
  budgetOperator: "under" | "around" | "over" | "between" | "none";
  priorities: string[];
  mustHave: string[];
  modelHint: string | null;
}
