/**
 * Rich terminal rendering.
 *
 * Everything here degrades gracefully: colours are dropped when NO_COLOR is
 * set, layouts reflow to the terminal width, and any value we are unsure about
 * is rendered dim with a marker rather than presented as fact.
 */

import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";
import type {
  PipelineDiagnostics,
  PipelineResult,
  RankedCandidate,
} from "../core/types.ts";
import { formatCount } from "../core/rank.ts";
import { describeIntent } from "../core/intent.ts";

const BAR_FULL = "█";
const BAR_EMPTY = "░";

export function termWidth(): number {
  try {
    return Math.max(80, Math.min(Deno.consoleSize().columns, 200));
  } catch {
    return 100;
  }
}

export function rupees(n: number | null): string {
  if (n === null) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Colour a 0..100 score: red -> yellow -> green. */
function scoreColor(v: number): (s: string) => string {
  if (v >= 75) return colors.green;
  if (v >= 55) return colors.yellow;
  if (v >= 35) {
    return colors.rgb24
      ? (s: string) => colors.rgb24(s, 0xff9e64)
      : colors.yellow;
  }
  return colors.red;
}

export function bar(value: number, width = 10): string {
  const v = Math.max(0, Math.min(100, value));
  const filled = Math.round((v / 100) * width);
  const paint = scoreColor(v);
  return paint(BAR_FULL.repeat(filled)) +
    colors.dim(BAR_EMPTY.repeat(width - filled));
}

function badgeChip(b: string): string {
  const styles: Record<string, (s: string) => string> = {
    "TOP PICK": (s) => colors.bgGreen(colors.black(` ${s} `)),
    "BEST VALUE": (s) => colors.bgBlue(colors.white(` ${s} `)),
    "CHEAPEST": (s) => colors.bgMagenta(colors.white(` ${s} `)),
    "FASTEST": (s) => colors.bgYellow(colors.black(` ${s} `)),
    "BATTERY KING": (s) => colors.bgCyan(colors.black(` ${s} `)),
    "BEST RATED": (s) => colors.bgWhite(colors.black(` ${s} `)),
    "LOWEST YET": (s) => colors.bgBrightGreen(colors.black(` ${s} `)),
    "OUT OF STOCK": (s) => colors.bgRed(colors.white(` ${s} `)),
  };
  return (styles[b] ?? ((s: string) => colors.inverse(` ${s} `)))(b);
}

export function rule(title = "", width = termWidth()): string {
  if (!title) return colors.dim("─".repeat(width));
  const label = ` ${title} `;
  const left = 3;
  const right = Math.max(0, width - left - label.length);
  return colors.dim("─".repeat(left)) + colors.bold(label) +
    colors.dim("─".repeat(right));
}

export function header(result: PipelineResult): string {
  const { stats, intent } = result;
  const lines: string[] = [];
  lines.push("");
  lines.push(rule("RESULTS"));
  lines.push(
    `  ${colors.bold(colors.white(`"${result.query}"`))}  ${
      colors.dim(`→ ${describeIntent(intent)}`)
    }`,
  );
  const priceInfo = stats.priceRange
    ? `${rupees(stats.priceRange[0])}–${rupees(stats.priceRange[1])}, median ${
      rupees(stats.medianPrice)
    }`
    : "no priced results";
  lines.push(
    colors.dim(
      `  ${stats.rawCards} cards scraped → ${stats.candidates} distinct products → ${
        colors.bold(String(stats.ranked))
      } ranked  ·  ${priceInfo}`,
    ),
  );
  lines.push("");
  return lines.join("\n");
}

function specSummary(r: RankedCandidate): string {
  const s = r.specs;
  const bits: string[] = [];
  if (s.socName) {
    bits.push(s.socName.replace("Snapdragon", "SD").replace("Dimensity", "D"));
  } else bits.push(colors.dim("SoC ?"));
  if (s.ramGb || s.storageGb) {
    bits.push(`${s.ramGb ?? "?"}/${s.storageGb ?? "?"}GB`);
  }
  if (s.batteryMah) bits.push(`${(s.batteryMah / 1000).toFixed(1)}k mAh`);
  if (s.panel) bits.push(s.panel.replace(" LCD", ""));
  if (s.refreshHz) bits.push(`${s.refreshHz}Hz`);
  return bits.join(" · ");
}

function ratingCell(r: RankedCandidate): string {
  if (r.rating === null) return colors.dim("—");
  const stars = r.rating >= 4.2
    ? colors.green(`${r.rating}★`)
    : r.rating >= 3.9
    ? colors.yellow(`${r.rating}★`)
    : colors.red(`${r.rating}★`);
  return r.ratingCount
    ? `${stars} ${colors.dim(formatCount(r.ratingCount))}`
    : stars;
}

function priceCell(r: RankedCandidate): string {
  const main = r.best.inStock === false
    ? colors.dim(colors.strikethrough(rupees(r.best.price)))
    : colors.bold(colors.green(rupees(r.best.price)));
  if (r.best.inStock === false) return `${main}\n${colors.red("out of stock")}`;
  if (r.best.mrp && r.best.discountPct) {
    const suspicious = r.best.discountPct > 55;
    const off = suspicious
      ? colors.dim(`${r.best.discountPct}%*`)
      : colors.cyan(`${r.best.discountPct}%`);
    return `${main}\n${colors.dim(rupees(r.best.mrp))} ${off}`;
  }
  return main;
}

function nameCell(r: RankedCandidate, width: number): string {
  let name = r.modelName;
  if (name.length > width) name = `${name.slice(0, width - 1)}…`;
  const badges = r.badges.length
    ? `\n${r.badges.slice(0, 2).map(badgeChip).join(" ")}`
    : "";
  return colors.bold(name) + badges;
}

/** The main ranking table. */
export function rankTable(ranked: RankedCandidate[], limit: number): string {
  if (ranked.length === 0) return colors.yellow("  No products matched.\n");

  const w = termWidth();
  const nameWidth = Math.max(22, Math.min(40, w - 78));

  const table = new Table()
    .header([
      colors.dim("#"),
      colors.bold("Product"),
      colors.bold("Price"),
      colors.bold("Key specs"),
      colors.bold("Rating"),
      colors.bold("Score"),
      colors.bold("Where"),
    ])
    .body(
      ranked.slice(0, limit).map((r) => [
        r.rank === 1
          ? colors.green(colors.bold("1"))
          : colors.dim(String(r.rank)),
        nameCell(r, nameWidth),
        priceCell(r),
        colors.dim(specSummary(r)),
        ratingCell(r),
        `${bar(r.score.total, 8)} ${colors.bold(r.score.total.toFixed(1))}\n${
          colors.dim(`conf ${Math.round(r.score.confidence * 100)}%`)
        }`,
        r.offers.length > 1
          ? `${r.best.platformName}\n${
            colors.dim(`+${r.offers.length - 1} more`)
          }`
          : r.best.platformName,
      ]),
    )
    .border(true)
    .padding(1);

  return table.toString();
}

/** Detailed cards for the top N picks. */
export function detailCards(ranked: RankedCandidate[], count: number): string {
  const out: string[] = [];
  for (const r of ranked.slice(0, count)) {
    out.push("");
    out.push(rule(`#${r.rank}  ${r.modelName}`));
    out.push("");
    if (r.badges.length) {
      out.push(`  ${r.badges.map(badgeChip).join(" ")}`);
      out.push("");
    }
    out.push(
      `  ${colors.bold(colors.green(rupees(r.best.price)))} on ${
        colors.bold(r.best.platformName)
      }${
        r.best.mrp
          ? colors.dim(
            `  (MRP ${rupees(r.best.mrp)}${
              r.best.discountPct ? `, ${r.best.discountPct}% off` : ""
            })`,
          )
          : ""
      }`,
    );
    // What you actually pay, when enrichment fetched the offer block.
    const co = r.checkout;
    if (co) {
      const bits: string[] = [];
      if (co.buyAt !== null && co.buyAt < r.best.price) {
        bits.push(
          `${colors.bold(rupees(co.buyAt))} at checkout${
            co.bankOffer
              ? colors.dim(` (${rupees(co.bankOffer)} card offer)`)
              : ""
          }`,
        );
      }
      if (co.exchangeUpTo !== null) {
        bits.push(colors.dim(`up to ${rupees(co.exchangeUpTo)} exchange`));
      }
      if (co.deliveryBy) bits.push(colors.dim(`delivery by ${co.deliveryBy}`));
      if (co.noCostEmi) bits.push(colors.dim("no-cost EMI"));
      if (bits.length) out.push(`  ${bits.join("  ·  ")}`);
      if (co.pincodeBlocked) {
        out.push(
          colors.yellow("  offer/delivery unavailable at the default pincode"),
        );
      }
    }

    out.push("");
    out.push(`  ${colors.italic(r.verdict)}`);
    out.push("");

    // Score bars
    const dims: Array<[string, number]> = [
      ["Performance", r.score.performance],
      ["Display", r.score.display],
      ["Battery", r.score.battery],
      ["Camera", r.score.camera],
      ["Memory", r.score.memory],
      ["Extras", r.score.extras],
    ];

    const half = Math.ceil(dims.length / 2);
    for (let i = 0; i < half; i++) {
      const left = dims[i];
      const right = dims[i + half];
      const fmt = ([label, v]: [string, number]) =>
        `${colors.dim(label.padEnd(12))} ${bar(v, 12)} ${
          String(Math.round(v)).padStart(3)
        }`;
      out.push(`  ${fmt(left)}${right ? `    ${fmt(right)}` : ""}`);
    }
    out.push("");
    out.push(
      `  ${colors.dim("Value")} ${bar(r.score.valueScore, 12)} ${
        String(r.score.valueScore).padStart(3)
      }    ${colors.dim("Trust")} ${bar(r.score.trustScore, 12)} ${
        String(r.score.trustScore).padStart(3)
      }    ${colors.dim("Deal")} ${bar(r.score.dealScore, 12)} ${
        String(r.score.dealScore).padStart(3)
      }`,
    );
    out.push("");

    if (r.pros.length) {
      out.push(`  ${colors.green("▲ Pros")}`);
      for (const p of r.pros) out.push(`    ${colors.green("+")} ${p}`);
    }
    if (r.cons.length) {
      out.push(`  ${colors.red("▼ Watch out")}`);
      for (const c of r.cons) out.push(`    ${colors.red("−")} ${c}`);
    }

    if (r.offers.length > 1) {
      out.push("");
      out.push(`  ${colors.dim("Offers")}`);
      for (const o of r.offers.slice(0, 5)) {
        const isBest = o === r.best;
        const line = `    ${o.platformName.padEnd(18)} ${
          rupees(o.price).padStart(10)
        }${o.discountPct ? colors.dim(`  ${o.discountPct}% off`) : ""}`;
        out.push(isBest ? colors.green(line) : colors.dim(line));
      }
    }

    if (r.siblingConfigs.length) {
      const sib = r.siblingConfigs
        .map((s) =>
          `${s.configKey.replace("r-", "GB/").replace("s", "GB")} ${
            rupees(s.price)
          }`
        )
        .join("  ·  ");
      out.push("");
      out.push(`  ${colors.dim(`Other configs: ${sib}`)}`);
    }

    out.push("");
    out.push(colors.dim(`  ${r.best.url.slice(0, termWidth() - 6)}`));
  }
  return out.join("\n");
}

/** Side-by-side spec matrix for the top N. */
export function comparisonMatrix(ranked: RankedCandidate[], count = 5): string {
  // One row per model family — comparing four memory configs of the same phone
  // side by side tells the buyer nothing.
  const seen = new Set<string>();
  const top: RankedCandidate[] = [];
  for (const r of ranked) {
    const family = r.key.split("|")[0].split("#")[0].trim();
    if (seen.has(family)) continue;
    seen.add(family);
    top.push(r);
    if (top.length >= count) break;
  }
  if (top.length < 2) return "";

  const rows: Array<[string, (r: RankedCandidate) => string]> = [
    ["Price", (r) => rupees(r.best.price)],
    ["Chipset", (r) => r.specs.socName ?? dimUnknown()],
    [
      "AnTuTu ≈",
      (
        r,
      ) => (r.specs.antutu
        ? r.specs.antutu.toLocaleString("en-IN")
        : dimUnknown()),
    ],
    [
      "RAM / Storage",
      (r) =>
        r.specs.ramGb || r.specs.storageGb
          ? `${r.specs.ramGb ?? "?"}GB / ${r.specs.storageGb ?? "?"}GB`
          : dimUnknown(),
    ],
    ["Display", (r) =>
      [
        r.specs.displayInches ? `${r.specs.displayInches}"` : null,
        r.specs.panel,
        r.specs.refreshHz ? `${r.specs.refreshHz}Hz` : null,
        r.specs.resolution,
      ].filter(Boolean).join(" ") || dimUnknown()],
    [
      "Battery",
      (r) =>
        r.specs.batteryMah
          ? `${r.specs.batteryMah}mAh${
            r.specs.chargingW ? ` / ${r.specs.chargingW}W` : ""
          }`
          : dimUnknown(),
    ],
    [
      "Camera",
      (r) =>
        r.specs.mainCameraMp
          ? `${r.specs.mainCameraMp}MP${r.specs.ois ? " OIS" : ""}`
          : dimUnknown(),
    ],
    [
      "5G",
      (r) =>
        r.specs.has5g === null
          ? dimUnknown()
          : r.specs.has5g
          ? colors.green("yes")
          : colors.red("no"),
    ],
    [
      "Rating",
      (r) =>
        r.rating
          ? `${r.rating}★ (${formatCount(r.ratingCount ?? 0)})`
          : dimUnknown(),
    ],
    ["Score", (r) => colors.bold(r.score.total.toFixed(1))],
    ["Confidence", (r) => `${Math.round(r.score.confidence * 100)}%`],
  ];

  const table = new Table()
    .header([
      colors.dim("Spec"),
      ...top.map((r) => colors.bold(truncate(r.modelName, 20))),
    ])
    .body(rows.map(([label, get]) => [colors.dim(label), ...top.map(get)]))
    .border(true)
    .padding(1);

  return `\n${rule("HEAD TO HEAD")}\n\n${table.toString()}\n`;
}

function dimUnknown(): string {
  return colors.dim("unknown");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Coverage + funnel diagnostics — where every card went. */
export function diagnosticsTable(diags: PipelineDiagnostics[]): string {
  const table = new Table()
    .header([
      colors.bold("Platform"),
      colors.dim("raw"),
      colors.dim("parsed"),
      colors.dim("recovered"),
      colors.dim("priced"),
      colors.dim("in category"),
      colors.dim("in budget"),
      colors.dim("fields"),
      colors.dim("status"),
    ])
    .body(
      diags.map((d) => [
        d.status === "ok"
          ? colors.green("✓ ") + d.platform
          : colors.red("✗ ") + d.platform,
        String(d.rawCards),
        String(d.normalized),
        d.titleRecovered > 0
          ? colors.cyan(`+${d.titleRecovered}`)
          : colors.dim("0"),
        String(d.priced),
        String(d.categoryMatched),
        String(d.inBudget),
        fillCell(d.fieldFill),
        d.error ? colors.red(truncate(d.error, 34)) : colors.green("ok"),
      ]),
    )
    .border(true)
    .padding(1);

  return `\n${rule("COVERAGE")}\n\n${table.toString()}\n`;
}

function fillCell(fill: number): string {
  const pct = Math.round(fill * 100);
  const paint = pct >= 80
    ? colors.green
    : pct >= 60
    ? colors.yellow
    : colors.red;
  return paint(`${pct}%`);
}

/** Why things were thrown out — the check that the filter isn't over-eager. */
export function rejectionSummary(result: PipelineResult, limit = 8): string {
  const tally = new Map<string, number>();
  for (const d of result.diagnostics) {
    for (const [reason, n] of Object.entries(d.rejectionReasons)) {
      tally.set(reason, (tally.get(reason) ?? 0) + n);
    }
  }
  if (tally.size === 0) return "";
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(
    0,
    limit,
  );
  const lines = sorted.map(([reason, n]) =>
    `  ${colors.dim("·")} ${String(n).padStart(4)} ${colors.dim(reason)}`
  );
  return `\n${rule("FILTERED OUT")}\n\n${lines.join("\n")}\n`;
}

/** Explain the one case where the table is not in descending score order. */
function sortNote(ranked: RankedCandidate[]): string {
  const matched = ranked.filter((r) => r.matchesRequestedModel);
  if (matched.length === 0 || matched.length === ranked.length) return "";
  const outscored = ranked.some((r) =>
    !r.matchesRequestedModel && r.score.total > matched[0].score.total
  );
  if (!outscored) return "";
  return colors.dim(
    `\n  You named a specific model, so it is listed first. Items marked ${
      badgeChip("ALTERNATIVE")
    }${colors.dim(" are different models that scored higher on value.")}`,
  );
}

export function renderFull(
  result: PipelineResult,
  opts: {
    limit: number;
    details: number;
    compare: boolean;
    diagnostics: boolean;
    /** How many products were enriched in this run, if any. */
    enriched?: number;
  },
): string {
  const parts = [
    header(result),
    rankTable(result.ranked, opts.limit),
    sortNote(result.ranked),
  ];
  if (opts.compare) {
    parts.push(comparisonMatrix(result.ranked, Math.min(5, opts.limit)));
  }
  if (opts.details > 0) parts.push(detailCards(result.ranked, opts.details));
  if (opts.diagnostics) {
    parts.push(diagnosticsTable(result.diagnostics));
    parts.push(rejectionSummary(result));
  }
  parts.push(
    colors.dim(
      `\n  Scores are 0–100 and relative to this result set. "conf" is data confidence:\n  low values mean specs were inferred rather than read. * marks a discount whose MRP looks inflated.`,
    ),
  );

  // If a lot of the table is guesswork, say so and point at the free fix.
  const unverified =
    result.ranked.filter((r) => r.score.confidence < 0.5).length;
  if (unverified >= 3) {
    parts.push(
      colors.yellow(
        `  ${unverified} of ${result.ranked.length} results have unverified specs. Re-run with --enrich ${
          Math.min(30, unverified + 5)
        } to fetch\n  their spec sheets (free via direct fetch where the marketplace allows it).\n`,
      ),
    );
  } else {
    parts.push("");
  }
  return parts.filter(Boolean).join("\n");
}
