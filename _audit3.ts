import { loadRun } from "./src/core/replay.ts";
import { buildCandidates, runPipeline } from "./src/core/pipeline.ts";
import { parseIntentRules } from "./src/core/intent.ts";
import { resolveSpecs } from "./src/core/resolve.ts";
import { PHONE_MODELS } from "./src/knowledge/models.ts";

const F = [
  "socName",
  "ramGb",
  "storageGb",
  "batteryMah",
  "chargingW",
  "displayInches",
  "refreshHz",
  "panel",
  "resolution",
  "mainCameraMp",
  "has5g",
] as const;
const b = await loadRun(["tests/fixtures/run-phones-15000"]);
const i = parseIntentRules("best phones under 15000");
const { candidates } = buildCandidates(i, b);
const r = await resolveSpecs(candidates, {});
const { ranked } = runPipeline("q", i, b, {
  enrichText: r.text,
  checkoutInfo: r.checkout,
});

console.log("=== 1. WHERE DOES EACH SPEC FIELD COME FROM ===");
const srcTally = new Map<string, Map<string, number>>();
for (const p of ranked) {
  for (const f of F) {
    const src = (p.specSources as Record<string, string>)[f] ?? "MISSING";
    if (!srcTally.has(f)) srcTally.set(f, new Map());
    const m = srcTally.get(f)!;
    m.set(src, (m.get(src) ?? 0) + 1);
  }
}
for (const [f, m] of srcTally) {
  const parts = [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`)
    .join("  ");
  console.log(`  ${f.padEnd(15)} ${parts}`);
}

console.log("\n=== 2. HOW MUCH OF THE SCORE IS INVENTED ===");
const buckets = { none: 0, some: 0, mostly: 0 };
for (const p of ranked) {
  const known = F.filter((f) =>
    (p.specs as Record<string, unknown>)[f] !== null
  ).length;
  if (known === F.length) buckets.none++;
  else if (known >= 6) buckets.some++;
  else buckets.mostly++;
}
console.log(`  fully measured        ${buckets.none}/${ranked.length}`);
console.log(`  partly imputed (6-10) ${buckets.some}/${ranked.length}`);
console.log(`  mostly imputed (<6)   ${buckets.mostly}/${ranked.length}`);
console.log(
  `  top-10 mostly imputed ${
    ranked.slice(0, 10).filter((p) =>
      F.filter((f) => (p.specs as Record<string, unknown>)[f] !== null).length <
        6
    ).length
  }/10`,
);

console.log("\n=== 3. KNOWLEDGE BASE TRUST ===");
const kbConf = new Map<string, number>();
for (const m of PHONE_MODELS) {
  kbConf.set(m.confidence, (kbConf.get(m.confidence) ?? 0) + 1);
}
console.log(
  "  KB entries by confidence:",
  [...kbConf].map(([k, v]) => `${k} ${v}`).join(", "),
);
console.log(
  "  ranked products using a low/medium KB entry:",
  ranked.filter((p) => p.kbConfidence === "low" || p.kbConfidence === "medium")
    .length,
);
console.log(
  "  AnTuTu values: all hand-entered approximations, never validated against a benchmark run",
);

console.log("\n=== 4. EVIDENCE BEHIND RATINGS ===");
console.log(
  `  no rating at all        ${
    ranked.filter((p) => p.rating === null).length
  }/${ranked.length}`,
);
console.log(
  `  under 100 ratings       ${
    ranked.filter((p) => (p.ratingCount ?? 0) < 100).length
  }/${ranked.length}`,
);
console.log(`  review TEXT available   0/${ranked.length}  (not collected)`);
console.log(`  rating distribution     0/${ranked.length}  (not collected)`);

console.log("\n=== 5. COVERAGE / MARKET REALITY ===");
const plats = new Map<string, number>();
for (const p of ranked) {
  plats.set(p.best.platformName, (plats.get(p.best.platformName) ?? 0) + 1);
}
console.log(
  "  best offer by platform:",
  [...plats].map(([k, v]) => `${k} ${v}`).join(", "),
);
console.log(
  `  products on 2+ platforms: ${
    ranked.filter((p) => new Set(p.offers.map((o) => o.platform)).size > 1)
      .length
  }`,
);
console.log(
  `  in-stock status known:    ${
    ranked.filter((p) => p.best.inStock !== null).length
  }/${ranked.length}`,
);

console.log("\n=== 6. GROUND TRUTH ===");
console.log("  ranking validated against an external source: NEVER");
console.log("  golden-set regression on ordering:            NONE");
