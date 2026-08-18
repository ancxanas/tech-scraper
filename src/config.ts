export type Platform = "reliance" | "tatacliq";

export interface PlatformConfig {
  name: string;
  url: string;
  collectorId: string;
}

export const PLATFORMS: Record<Platform, PlatformConfig> = {
  reliance: {
    name: "Reliance Digital",
    url: "https://www.reliancedigital.in",
    collectorId: "c_msxt4lsv12k5p1328b",
  },
  tatacliq: {
    name: "Tata CLiQ",
    url: "https://www.tatacliq.com",
    collectorId: "c_msxt4nhe2fxyb7bjnw",
  },
};

export const ALL_PLATFORMS: Platform[] = ["reliance", "tatacliq"];

export const SCORE_WEIGHTS = {
  price: 0.4,
  discount: 0.3,
  rating: 0.2,
  reviews: 0.1,
} as const;
