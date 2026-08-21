export type Platform = "reliance" | "tatacliq" | "amazon" | "flipkart";
export type ToolType = "scraper" | "prebuilt";
export type PaginationType = "page" | "scroll";

export interface PlatformConfig {
  name: string;
  tool: ToolType;
  /** In the default set. Disabled platforms still run via --platforms. */
  enabled: boolean;
  /** Why it is not in the default set, shown when someone opts in. */
  disabledReason?: string;
  searchUrlTemplate: string;
  pagination: PaginationType;
  startIndex: number;
  pageSize: number;
  collectorId?: string;
  datasetId?: string;
}

export const PAGES_TO_SCRAPE = 3;
export const MAX_PRODUCTS_HARD_CAP = 500;
export const MAX_ENRICH = 0;

const relianceId = Deno.env.get("RELIANCE_COLLECTOR_ID") ||
  "c_msxt4lsv12k5p1328b";
const tatacliqId = Deno.env.get("TATACLIQ_COLLECTOR_ID") ||
  "c_mt0oxjk82pao8tyc4u";
const flipkartId = Deno.env.get("FLIPKART_COLLECTOR_ID") ||
  "c_mt1bpy5nvn2i7o1r7";

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
    // Off by default. Across every run recorded so far it has returned
    // ZERO in-category products: 22 cards in the reference run were all
    // earphones, headphones and neckbands, and the 12:05 run's 11 cards
    // classified to nothing. The seed URL is a real search endpoint, so the
    // fault is in the hosted collector's own extraction — it appears to read
    // an accessories rail rather than the product grid. That code lives in
    // the BrightData dashboard, not in this repo, so it cannot be fixed here.
    enabled: false,
    disabledReason:
      "returns accessories, not phones — 0 in-category products in every recorded run; " +
      "the hosted collector's extraction needs fixing in BrightData",
    searchUrlTemplate:
      "https://www.reliancedigital.in/search?q={q}&page_no={page}",
    pagination: "scroll",
    startIndex: 1,
    pageSize: 40,
    collectorId: relianceId,
  },
  tatacliq: {
    name: "Tata CLiQ",
    tool: "scraper",
    // Off by default. Its collector fails on its own selector --
    // `waiting for selector "a[id^="ProductModule-"]" failed: timeout 30000ms`
    // -- so it either times out entirely or returns a near-empty grid: 35
    // cards yielding 1 usable product, after 276 seconds. Same story as
    // Reliance: the selector is configured in BrightData, not here.
    enabled: false,
    disabledReason:
      "its collector's product selector no longer matches the site — 1 usable product " +
      "from 35 cards, after 276s; fix the selector in BrightData",
    searchUrlTemplate:
      "https://www.tatacliq.com/search/?searchCategory=all&text={q}",
    pagination: "scroll",
    startIndex: 0,
    pageSize: 40,
    collectorId: tatacliqId,
  },
  amazon: {
    name: "Amazon India",
    tool: "prebuilt",
    enabled: true,
    searchUrlTemplate: "",
    pagination: "page",
    startIndex: 1,
    pageSize: 60,
    datasetId: "gd_lwdb4vjm1ehb499uxs",
  },
};

/**
 * The default platform set: those actually returning phones.
 *
 * Two marketplaces are deliberately excluded. Running them cost roughly five
 * minutes of wall time and BrightData credit per run to contribute about one
 * product between them, and a coverage table reading "4 platforms" when two
 * return nothing is a worse lie than saying "2".
 */
export const ALL_ENABLED: Platform[] = Object.entries(PLATFORMS)
  .filter(([, c]) => c.enabled)
  .map(([k]) => k as Platform);

export const ALL_PLATFORMS: Platform[] = Object.keys(PLATFORMS) as Platform[];

export const SCORE_WEIGHTS = {
  price: 0.45,
  discount: 0.25,
  rating: 0.2,
  availability: 0.1,
  reviews: 0.05,
  modelFamilyBonus: 0.1,
  modelFamilyPenalty: 0.05,
  brandMatchBonus: 0.08,
} as const;
