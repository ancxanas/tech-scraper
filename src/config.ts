export type Platform = "reliance" | "tatacliq";
export type ToolType = "scraper";

export interface PlatformConfig {
  name: string;
  tool: ToolType;
  collectorId: string;
  url: string;
  searchPath: string;
  startIndex: number;
  productsPerPage: number;
  enabled: boolean;
}

export const PAGES_TO_SCRAPE = 3;

const relianceId = Deno.env.get("RELIANCE_COLLECTOR_ID") ||
  "c_msxt4lsv12k5p1328b";
const tatacliqId = Deno.env.get("TATACLIQ_COLLECTOR_ID") ||
  "c_msxt4nhe2fxyb7bjnw";

export const PLATFORMS: Record<Platform, PlatformConfig> = {
  reliance: {
    name: "Reliance Digital",
    tool: "scraper",
    collectorId: relianceId,
    url: "https://www.reliancedigital.in",
    searchPath: "/search",
    startIndex: 1,
    productsPerPage: 24,
    enabled: true,
  },
  tatacliq: {
    name: "Tata CLiQ",
    tool: "scraper",
    collectorId: tatacliqId,
    url: "https://www.tatacliq.com",
    searchPath: "/search/",
    startIndex: 0,
    productsPerPage: 40,
    enabled: false,
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
