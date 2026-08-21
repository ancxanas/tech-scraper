import { SOCS } from "../src/knowledge/soc.ts";

const BASE = "https://nanoreview.net/en/soc";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const VENDOR_PREFIX: Record<string, string> = {
  qualcomm: "qualcomm",
  mediatek: "mediatek",
  samsung: "samsung",
  unisoc: "unisoc",
  apple: "apple",
  google: "google",
};

function slugFor(name: string, vendor: string): string[] {
  const base = name
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const p = VENDOR_PREFIX[vendor] ?? vendor;
  const out = [`${p}-${base}`];
  if (!base.startsWith(p)) out.push(base);
  return out;
}

function parse(htmlText: string): { antutu: number | null } {
  const t = htmlText
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  const a = t.match(/Total score\s*(\d{5,7})/i);
  return { antutu: a ? Number(a[1]) : null };
}

const write = Deno.args.includes("--write");
const rows: Array<[string, number, number]> = [];
const missing: string[] = [];

for (const soc of SOCS) {
  let hit = null;
  for (const slug of slugFor(soc.name, soc.vendor)) {
    const res = await fetch(`${BASE}/${slug}`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }
    const parsed = parse(await res.text());
    if (parsed.antutu) {
      hit = parsed;
      break;
    }
  }
  if (!hit?.antutu) {
    missing.push(soc.name);
  } else {
    rows.push([soc.name, soc.antutu, hit.antutu]);
  }
  await new Promise((r) => setTimeout(r, 400));
}

rows.sort((a, b) => Math.abs(b[1] / b[2] - 1) - Math.abs(a[1] / a[2] - 1));
console.log(
  "chip".padEnd(24),
  "ours".padEnd(9),
  "nanoreview".padEnd(11),
  "drift",
);
for (const [name, ours, theirs] of rows) {
  const d = ((ours - theirs) / theirs) * 100;
  console.log(
    name.padEnd(24),
    String(ours).padEnd(9),
    String(theirs).padEnd(11),
    `${d > 0 ? "+" : ""}${d.toFixed(0)}%`,
  );
}
console.log(`\n${rows.length} calibrated, ${missing.length} not on the source`);
if (missing.length) console.log("missing:", missing.join(", "));

function convert(ours: number): number {
  const near = rows
    .map(([, o, t]) => [Math.abs(o - ours), t / o] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, 5)
    .map(([, r]) => r)
    .sort((a, b) => a - b);
  const ratio = near[Math.floor(near.length / 2)] ?? 1;
  return Math.round((ours * ratio) / 1000) * 1000;
}

if (write) {
  let src = await Deno.readTextFile("src/knowledge/soc.ts");
  const apply = (name: string, value: number) => {
    const i = src.indexOf(`name: "${name}"`);
    if (i < 0) return;
    const j = src.indexOf("antutu:", i);
    const k = src.indexOf(",", j);
    src = src.slice(0, j) + `antutu: ${value}` + src.slice(k);
  };
  for (const [name, , theirs] of rows) apply(name, theirs);
  for (const name of missing) {
    const soc = SOCS.find((x) => x.name === name);
    if (soc) {
      const v = convert(soc.antutu);
      apply(name, v);
      console.log(`converted ${name.padEnd(22)} ${soc.antutu} -> ${v}`);
    }
  }
  await Deno.writeTextFile("src/knowledge/soc.ts", src);
  console.log("\nwritten to src/knowledge/soc.ts");
}
