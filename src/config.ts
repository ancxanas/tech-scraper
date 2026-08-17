export type Platform =
  | "amazon"
  | "flipkart"
  | "croma"
  | "reliance"
  | "tacliq";

export interface PlatformConfig {
  name: string;
  url: string;
  collectorId: string | null;
}

export const PLATFORMS: Record<Platform, PlatformConfig> = {
  amazon: {
    name: "Amazon India",
    url: "https://www.amazon.in",
    collectorId: null,
  },
  flipkart: {
    name: "Flipkart",
    url: "https://www.flipkart.com",
    collectorId: null,
  },
  croma: {
    name: "Croma",
    url: "https://www.croma.com",
    collectorId: null,
  },
  reliance: {
    name: "Reliance Digital",
    url: "https://www.reliancedigital.in",
    collectorId: null,
  },
  tacliq: {
    name: "Tata CLiQ",
    url: "https://www.tatacliq.com",
    collectorId: null,
  },
};

export const ALL_PLATFORMS: Platform[] = [
  "amazon",
  "flipkart",
  "croma",
  "reliance",
  "tacliq",
];

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
