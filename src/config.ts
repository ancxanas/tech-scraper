export type Platform = "reliance" | "tatacliq" | "amazon" | "flipkart";
export type ToolType = "scraper" | "prebuilt";
export type PaginationType = "page" | "scroll";

export interface PlatformConfig {
  name: string;
  tool: ToolType;
  enabled: boolean;
  searchUrlTemplate: string;
  pagination: PaginationType;
  startIndex: number;
  pageSize: number;
  collectorId?: string;
  datasetId?: string;
}

export const PAGES_TO_SCRAPE = 3;
export const MAX_PRODUCTS_HARD_CAP = 500;
export const MAX_ENRICH = 20;

const relianceId = Deno.env.get("RELIANCE_COLLECTOR_ID") ||
  "c_msxt4lsv12k5p1328b";
const tatacliqId = Deno.env.get("TATACLIQ_COLLECTOR_ID") ||
  "c_msxt4nhe2fxyb7bjnw";
const flipkartId = Deno.env.get("FLIPKART_COLLECTOR_ID") ||
  "c_msyq5fv71wizb98a5s";
const amazonId = Deno.env.get("AMAZON_COLLECTOR_ID") || "";

export const PLATFORMS: Record<Platform, PlatformConfig> = {
  flipkart: {
    name: "Flipkart",
    tool: "scraper",
    enabled: true,
    searchUrlTemplate: "https://www.flipkart.com/search?q={q}&page={page}",
    pagination: "page",
    startIndex: 1,
    pageSize: 40,
    collectorId: flipkartId,
  },
  reliance: {
    name: "Reliance Digital",
    tool: "scraper",
    enabled: true,
    searchUrlTemplate: "https://www.reliancedigital.in/products?q={q}",
    pagination: "scroll",
    startIndex: 1,
    pageSize: 40,
    collectorId: relianceId,
  },
  tatacliq: {
    name: "Tata CLiQ",
    tool: "scraper",
    enabled: true,
    searchUrlTemplate:
      "https://www.tatacliq.com/search/?searchCategory=all&text={q}",
    pagination: "scroll",
    startIndex: 0,
    pageSize: 40,
    collectorId: tatacliqId,
  },
  amazon: {
    name: "Amazon India",
    tool: amazonId ? "scraper" : "prebuilt",
    enabled: true,
    searchUrlTemplate: "https://www.amazon.in/s?k={q}&page={page}",
    pagination: "page",
    startIndex: 1,
    pageSize: 60,
    collectorId: amazonId || undefined,
    datasetId: "gd_lwdb4vjm1ehb499uxs",
  },
};

export const ALL_ENABLED: Platform[] = Object.entries(PLATFORMS)
  .filter(([, c]) => c.enabled)
  .map(([k]) => k as Platform);

export const ALL_PLATFORMS: Platform[] = Object.keys(PLATFORMS) as Platform[];

export const SCORE_WEIGHTS = {
  price: 0.45,
  discount: 0.25,
  rating: 0.2,
  availability: 0.1,
} as const;
