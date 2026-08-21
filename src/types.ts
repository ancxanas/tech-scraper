export interface Product {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  discount: number;
  currency: string;
  productUrl: string;
  imageUrl: string;
  platform: string;
  scrapedAt: string;

  brand?: string;
  rating?: number;
  reviewsCount?: number;
  seller?: string;
  availability?: string;
  offers?: string[];
  listingPosition?: number;
  pageNumber?: number;
  extras?: Record<string, unknown>;

  enriched?: boolean;
  images?: string[];
  inStock?: boolean;
  description?: string;
  highlights?: string[];
  specifications?: Record<string, string>;
  variants?: ProductVariant[];
  warranty?: string;
  deliveryEta?: string;
  exchangePrice?: number;
  emiFrom?: number;
  category?: string;
  sku?: string;
  offerBreakdown?: Array<{
    type: "bank_offer" | "exchange" | "coupon" | "cashback";
    text: string;
    savings: number;
  }>;
  sellerTrust?: "high" | "medium" | "low";
}

export interface ProductVariant {
  name: string;
  price: number;
  url: string;
  inStock: boolean;
}

export interface SearchResult {
  query: string;
  platform: string;
  products: Product[];
  timestamp: string;
  status: "ok" | "error" | "empty";
  error?: string;
  requestedPages: number;
  rawCount: number;
  parsedCount: number;
  healAttempted: boolean;
  healSuccess: boolean;
  coverage: {
    fieldFillRate: number;
  };
}

export type ProductCategory =
  | "phone"
  | "headphone"
  | "earbuds"
  | "laptop"
  | "tablet"
  | "watch"
  | "camera"
  | "tv"
  | "generic";

export interface ParsedIntent {
  category: ProductCategory;
  brand: string | null;
  model: string | null;
  budget: number | null;
  budgetOperator: "under" | "around" | "exactly";
  temporal: {
    before?: string;
    urgency?: "asap" | "flexible";
  } | null;
  useCase: string[];
  preferences: string[];
  comparisonProduct: string | null;
  excludeBrands: string[];
  superlative: string | null;
  searchQueries: string[];
  rawQuery: string;
}

export interface PriceAnalytics {
  currentPrice: number;
  lowestPrice: number;
  lowestDate: string;
  highestPrice: number;
  averagePrice: number;
  priceTrend: "rising" | "stable" | "falling";
  daysSinceLowest: number;
  pricePosition: "at_lowest" | "near_lowest" | "above_average" | "at_peak";
  buyAdvice: "buy_now" | "wait" | "good_deal" | "great_deal";
  dataPoints: number;
}

export interface DealReport {
  verdict: string;
  verdictSummary: string;
  priceIntelligence: {
    position: string;
    trend: string;
    buyAdvice: string;
  };
  whyThisOne: string[];
  effectivePrice: {
    listed: number;
    bankOffers: Array<{ text: string; savings: number }>;
    exchangeBonus: number;
    coupons: Array<{ code: string; savings: number }>;
    effectivePrice: number;
    totalSavings: number;
  };
  alternatives: Array<{
    type: "cheaper" | "pricier" | "different_form" | "different_brand";
    productName: string;
    productPrice: number;
    platform: string;
    comparison: string;
  }>;
  watchOut: string[];
  specBreakdown: Array<{
    name: string;
    rating: number;
    text: string;
    stars: string;
  }>;
  temporalAdvice: string | null;
}
