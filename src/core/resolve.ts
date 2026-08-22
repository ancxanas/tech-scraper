/**
 * Facade over the split resolution modules.
 *
 * resolve.ts grew past 780 lines doing three jobs: reading pages, resolving
 * specs from knowledge sources, and refreshing buy-box prices. Each now lives
 * in its own module; this file re-exports the public surface so existing
 * importers are untouched.
 */
export type { FetchMode, Transport } from "./page-text.ts";
export {
  extractSpecSection,
  fetchPage,
  httpTransport,
  pidOf,
  sleep,
  specRichness,
} from "./page-text.ts";
export type { SpecConflict } from "./spec-conflicts.ts";
export type { ResolveOptions, ResolveResult } from "./resolve-specs.ts";
export { reportResolution, resolveSpecs, toSpecs } from "./resolve-specs.ts";
export type { RefreshResult } from "./refresh-prices.ts";
export {
  refreshPrices,
  reportRefresh,
  reportRefreshDetail,
} from "./refresh-prices.ts";
