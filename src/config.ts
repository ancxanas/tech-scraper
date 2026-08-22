export type Platform = "reliance" | "tatacliq" | "amazon" | "flipkart";
export type ToolType = "scraper" | "prebuilt";
export type PaginationType = "page" | "scroll";

export interface PlatformConfig {
  name: string;
  tool: ToolType;
  enabled: boolean;
  /**
   * A defect we know about but cannot fix from this repo, reported after a
   * run when the platform actually underdelivers rather than on every run.
   */
  knownIssue?: string;
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
    enabled: true,
    knownIssue:
      "its collector returns accessories rather than phones — 22 cards in the " +
      "reference run were all earphones and headphones. The extraction lives in " +
      "the BrightData dashboard, not this repo.",
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
    enabled: true,
    knownIssue:
      'its collector fails on its own selector (a[id^="ProductModule-"]), so it ' +
      "times out or returns a near-empty grid — 1 usable product from 35 cards. " +
      "The selector is configured in BrightData, not this repo.",
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

export const ALL_ENABLED: Platform[] = Object.entries(PLATFORMS)
  .filter(([, c]) => c.enabled)
  .map(([k]) => k as Platform);

export const ALL_PLATFORMS: Platform[] = Object.keys(PLATFORMS) as Platform[];
