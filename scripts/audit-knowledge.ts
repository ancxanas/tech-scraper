/**
 * Audit the offline knowledge base against a live source.
 *
 * The knowledge base is hand-written, so it rots: phones get variants with
 * the same name, and chip estimates drift from what the hardware actually
 * scores. This re-checks every entry we can name and prints the
 * disagreements. Run it before trusting a ranking.
 *
 * A disagreement does NOT mean the KB is wrong — the audit that prompted this
 * script found two of three disagreements were the live source confusing a
 * 4G variant with its 5G sibling. It marks what a human should adjudicate.
 *
 *   deno task audit           all entries
 *   deno task audit 10        first 10, for a quick check
 */

import { fetchBeebomSpecs } from "../src/knowledge/beebom.ts";
import { PHONE_MODELS } from "../src/knowledge/models.ts";
import { matchSocDetailed, SOCS } from "../src/knowledge/soc.ts";

const limit = Number(Deno.args[0]) || Number.MAX_SAFE_INTEGER;
const sample = PHONE_MODELS.filter((m) => m.soc).slice(0, limit);

let agree = 0, disagree = 0, notFound = 0;
const drift: Array<[string, number, number]> = [];
const seen = new Set<string>();

for (const m of sample) {
  const s = await fetchBeebomSpecs(m.display, m.brand);
  if (!s?.socName) {
    notFound++;
    console.log(`?  ${m.display.padEnd(30)} not on the live source`);
  } else {
    const live = matchSocDetailed(s.socName)?.soc.name ?? s.socName;
    if (live.toLowerCase() === (m.soc ?? "").toLowerCase()) agree++;
    else {
      disagree++;
      console.log(
        `XX ${m.display.padEnd(30)} kb=${
          String(m.soc).padEnd(22)
        } live=${live}`,
      );
    }
    if (
      m.batteryMah && s.batteryMah && Math.abs(m.batteryMah - s.batteryMah) > 60
    ) {
      console.log(
        `   ^ battery: kb=${m.batteryMah} live=${s.batteryMah}`,
      );
    }
    if (s.antutu && !seen.has(live)) {
      const ours = SOCS.find((x) => x.name === live)?.antutu;
      if (ours) {
        seen.add(live);
        drift.push([live, ours, s.antutu]);
      }
    }
  }
  await new Promise((r) => setTimeout(r, 700));
}

console.log(
  `\nchipset: ${agree} agree, ${disagree} disagree, ${notFound} not found`,
);

// The per-chip table is the ranking's scale, so drift here skews every phone
// on that chip at once. Over ~10% is worth correcting in soc.ts.
console.log("\n--- soc.ts estimate vs measured ---");
for (
  const [chip, ours, measured] of drift.sort((a, b) => a[0].localeCompare(b[0]))
) {
  const err = ((ours - measured) / measured) * 100;
  const flag = Math.abs(err) > 10 ? "  <-- correct this" : "";
  console.log(
    `${chip.padEnd(24)} ours=${String(ours).padEnd(8)} measured=${
      String(measured).padEnd(8)
    } ${err > 0 ? "+" : ""}${err.toFixed(0)}%${flag}`,
  );
}
