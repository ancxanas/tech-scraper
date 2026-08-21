/**
 * The shape every external spec source returns.
 *
 * Marketplace listings do not state the chipset — measured across the
 * reference run, 0 of 48 cards named it anywhere in the title, slug or card
 * text. So a phone's silicon can only come from somewhere else, and this is
 * the contract that "somewhere else" has to satisfy. GSMArena and Beebom both
 * implement it; a third source would only need to fill the same fields.
 *
 * Every field is nullable on purpose. A source that knows the chipset but not
 * the charging wattage should say so rather than guess — the ranker treats a
 * null as "unknown" and penalises confidence, which is the honest outcome.
 */
export interface ExternalSpecs {
  /** Page the values were read from, kept so the UI can cite it. */
  url: string;
  /** The name the source matched, so a wrong match is visible after the fact. */
  matchedName: string;
  socName: string | null;
  nm: number | null;
  /** Measured where the source publishes one — never our own approximation. */
  antutu: number | null;
  geekbench: number | null;
  batteryMah: number | null;
  chargingW: number | null;
  panel: string | null;
  inches: number | null;
  refreshHz: number | null;
  resolution: string | null;
  mainCameraMp: number | null;
  ois: boolean;
  nfc: boolean | null;
  ipRating: string | null;
  weightG: number | null;
}
