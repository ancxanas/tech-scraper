import { Command } from "@cliffy/command";
import { ALL_PLATFORMS, type Platform, PLATFORMS } from "./config.ts";

function _parsePlatforms(input: string): Platform[] {
  const parts = input.split(",").map((p) => p.trim().toLowerCase());
  const valid: Platform[] = [];
  for (const part of parts) {
    if (part in PLATFORMS) {
      valid.push(part as Platform);
    } else {
      console.error(`Unknown platform: ${part}`);
      console.error(`Available: ${ALL_PLATFORMS.join(", ")}`);
      Deno.exit(1);
    }
  }
  return valid;
}

export const cli = new Command()
  .name("tech-scraper")
  .version("0.1.0")
  .description("Find the best tech deals across Indian e-commerce platforms")
  .command(
    "search",
    new Command()
      .description("Search for a product across platforms")
      .arguments("<query:string>")
      .option(
        "-p, --platforms <platforms:string>",
        "Comma-separated platforms to search (default: all)",
      )
      .action((_options, _query) => {
        console.log("Search command — coming in Step 2");
      }),
  )
  .command(
    "compare",
    new Command()
      .description("Compare prices from specific platforms")
      .arguments("<query:string>")
      .option(
        "-p, --platforms <platforms:string>",
        "Comma-separated platforms to compare",
      )
      .action((_options, _query) => {
        console.log("Compare command — coming in Step 2");
      }),
  )
  .command(
    "best-deal",
    new Command()
      .description("Show the best deal for a product")
      .arguments("<query:string>")
      .option(
        "-p, --platforms <platforms:string>",
        "Comma-separated platforms to check",
      )
      .action((_options, _query) => {
        console.log("Best-deal command — coming in Step 2");
      }),
  )
  .command(
    "status",
    new Command()
      .description("Show configured scrapers and their status")
      .action(() => {
        console.log("\nConfigured Platforms:\n");
        for (const [key, config] of Object.entries(PLATFORMS)) {
          const status = config.collectorId ? "Ready" : "Not configured";
          const icon = config.collectorId ? "+" : "-";
          console.log(`  ${icon} ${config.name} (${key})`);
          console.log(`    URL: ${config.url}`);
          console.log(`    Status: ${status}`);
          if (config.collectorId) {
            console.log(`    Collector ID: ${config.collectorId}`);
          }
          console.log();
        }
      }),
  );
