import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { buildIndex, loadIndex } from "../knowledge/gsmarena.ts";

const DEFAULT_BRANDS = [
  "Xiaomi",
  "Samsung",
  "Realme",
  "vivo",
  "Oppo",
  "OnePlus",
  "Motorola",
  "Nothing",
  "Google",
  "Apple",
  "Infinix",
  "Tecno",
  "Itel",
  "Honor",
  "Nokia",
  "Alcatel",
  "Micromax",
];

export const indexCommand = new Command()
  .description("Build the external spec-database index (run once)")
  .option("--brands <list:string>", "Comma-separated brands", {
    default: DEFAULT_BRANDS.join(","),
  })
  .option("--pages <n:number>", "Listing pages per brand (~40 models each)", {
    default: 3,
  })
  .option("--show", "Just report what is already indexed", { default: false })
  .action(async (options) => {
    if (options.show) {
      const idx = await loadIndex();
      const byBrand = new Map<string, number>();
      for (const e of idx) {
        byBrand.set(e.brand, (byBrand.get(e.brand) ?? 0) + 1);
      }
      console.log(`\n  ${idx.length} models indexed\n`);
      for (const [b, n] of [...byBrand].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${b.padEnd(12)} ${n}`);
      }
      console.log();
      return;
    }

    const brands = options.brands.split(",").map((b) => b.trim()).filter(
      Boolean,
    );
    console.error(
      colors.dim(
        `  Indexing ${brands.length} brands x ${options.pages} pages, paced to avoid throttling…`,
      ),
    );
    const idx = await buildIndex({
      brands,
      pagesPerBrand: options.pages,
      verbose: true,
    });
    console.error(
      colors.green(`\n  ${idx.length} models indexed and cached.\n`),
    );
  });
