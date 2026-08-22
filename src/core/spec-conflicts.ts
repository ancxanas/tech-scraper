import { matchSocDetailed, matchSocExact } from "../knowledge/soc.ts";
import type { Candidate } from "./types.ts";
import type { ExternalSpecs } from "../knowledge/spec-source.ts";

export interface SpecConflict {
  product: string;
  field: string;
  knowledgeBase: string;
  productPage: string;
  ambiguous: boolean;
  source: "merchant" | "spec-db";
}

export function detectConflicts(
  c: Candidate,
  pageText: string,
): SpecConflict[] {
  const out: SpecConflict[] = [];
  const claimed = c.specs.socName;
  const fromSource = c.specSources.socName;
  if (claimed && (fromSource === "kb" || fromSource === "inferred")) {
    const found = matchSocDetailed(pageText);
    if (found && found.soc.name !== claimed) {
      out.push({
        product: c.modelName,
        field: "chipset",
        knowledgeBase: claimed,
        productPage: found.soc.name,
        ambiguous: found.ambiguous,
        source: "merchant",
      });
    }
  }
  return out;
}

export function conflictsAgainstKb(
  c: Candidate,
  g: ExternalSpecs,
): SpecConflict[] {
  const out: SpecConflict[] = [];
  if (
    c.specs.socName && c.specSources.socName === "kb" && g.socName &&
    // Exact-match first: the value came from a structured field, so it needs
    // no context word to be believed.
    (matchSocExact(g.socName) ?? matchSocDetailed(g.socName)?.soc)?.name !==
      c.specs.socName
  ) {
    out.push({
      product: c.modelName,
      field: "chipset",
      knowledgeBase: c.specs.socName,
      productPage: g.socName,
      ambiguous: false,
      source: "spec-db",
    });
  }
  return out;
}
