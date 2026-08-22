import { Command } from "@cliffy/command";
import { findCommand } from "./commands/find.ts";
import { rankCommand } from "./commands/rank.ts";
import { snapshotCommand } from "./commands/snapshot.ts";
import { healCommand } from "./commands/heal.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { historyCommand } from "./commands/history.ts";
import { indexCommand } from "./commands/spec-index.ts";
import { specsCommand } from "./commands/specs.ts";

export const cli = new Command()
  .name("tech-scraper")
  .version("2.0.0")
  .description(
    "Rank phones across Indian e-commerce on measured specs, verified prices and buyer trust - not on price alone.",
  )
  .action(function () {
    this.showHelp();
  })
  .command("find", findCommand)
  .command("rank", rankCommand)
  .command("snapshot", snapshotCommand)
  .command("heal", healCommand)
  .command("doctor", doctorCommand)
  .command("history", historyCommand)
  .command("index", indexCommand)
  .command("specs", specsCommand);
