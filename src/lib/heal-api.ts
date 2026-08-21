import { colors } from "@cliffy/ansi/colors";
import { Confirm } from "@cliffy/prompt";
import { bdFetch, pollUntil } from "./brightdata.ts";

interface HealProgress {
  step?: string;
  status?: string;
  preview_result?: unknown[];
  diff_summary?: string;
  view_url?: string;
  prompt?: string;
  completed_steps?: string[];
}

let healMutex: Promise<void> = Promise.resolve();

async function withHealMutex<T>(fn: () => Promise<T>): Promise<T> {
  await healMutex;
  let release!: () => void;
  healMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    return await fn();
  } finally {
    release();
  }
}

const MAX_HEAL_RETRIES = 3;
const HEAL_RETRY_DELAY_MS = 30_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function checkStuckHeal(
  collectorId: string,
): Promise<boolean> {
  try {
    const progress = await bdFetch<HealProgress>(
      `/dca/collectors/${collectorId}/refactor_template/progress`,
    );
    const status = progress.status || "";
    const step = progress.step || "";
    if (
      status === "pending_answer" ||
      status === "awaiting_approval" ||
      step === "user_approval"
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function triggerHeal(
  collectorId: string,
  prompt: string,
  customInput: Record<string, unknown>[] = [],
): Promise<void> {
  const stuck = await checkStuckHeal(collectorId);
  if (stuck) {
    console.error(
      colors.yellow(
        `    Heal stuck on ${collectorId.slice(0, 15)} — skipping`,
      ),
    );
    return;
  }

  for (let attempt = 0; attempt < MAX_HEAL_RETRIES; attempt++) {
    try {
      await bdFetch(`/dca/collectors/${collectorId}/refactor_template`, {
        method: "POST",
        body: JSON.stringify({ prompt, custom_input: customInput }),
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("409") && attempt < MAX_HEAL_RETRIES - 1) {
        console.error(
          colors.yellow(
            `    Another heal job in progress, waiting ${
              HEAL_RETRY_DELAY_MS / 1000
            }s (attempt ${attempt + 1}/${MAX_HEAL_RETRIES})...`,
          ),
        );
        await sleep(HEAL_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

export async function approveHeal(
  collectorId: string,
  approve: boolean,
): Promise<void> {
  await bdFetch(`/dca/collectors/${collectorId}/resume_automation_job`, {
    method: "POST",
    body: JSON.stringify({ message: approve }),
  });
}

export function runHealFlow(
  collectorId: string,
  prompt: string,
  autoApprove: boolean,
  customInput: Record<string, unknown>[] = [],
): Promise<{ success: boolean; preview?: unknown[] }> {
  return withHealMutex(async () => {
    console.log(colors.cyan.bold("  [1/4] Triggering AI self-healing..."));
    await triggerHeal(collectorId, prompt, customInput);

    console.log(colors.cyan("  [2/4] Analyzing scraper template..."));

    let lastStep = "";
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      try {
        const progress = await bdFetch<HealProgress>(
          `/dca/collectors/${collectorId}/refactor_template/progress`,
        );

        const step = progress.step || "";
        const status = progress.status || "";

        if (step !== lastStep) {
          const stepNum = getStepNumber(step);
          console.log(colors.cyan(`  [${stepNum}/4] ${getStepLabel(step)}...`));
          lastStep = step;
        }

        if (status === "failed" || status === "error") {
          console.error(colors.red.bold(`  Heal failed at step: ${step}`));
          return { success: false };
        }

        if (
          step === "user_approval" ||
          status === "pending_answer" ||
          status === "awaiting_approval"
        ) {
          console.log(
            colors.cyan.bold("  [3/4] Fix ready — awaiting approval"),
          );

          if (progress.preview_result) {
            console.log(
              colors.green.bold("\n  Preview of fixed scraper output:"),
            );
            const items = progress.preview_result;
            if (Array.isArray(items)) {
              for (const item of items.slice(0, 3)) {
                const record = item as Record<string, unknown>;
                const fields = Object.entries(record)
                  .filter(([k]) => k !== "input")
                  .map(([k, v]) => {
                    const val = typeof v === "object" && v !== null
                      ? JSON.stringify(v)
                      : String(v ?? "null");
                    return colors.green(`${k}: ${val.slice(0, 40)}`);
                  })
                  .join(", ");
                console.log(`    ${fields}`);
              }
            }
            console.log();
          }

          if (progress.diff_summary) {
            console.log(colors.yellow(`  Diff: ${progress.diff_summary}`));
          }

          if (autoApprove) {
            console.log(colors.green("  Auto-approving fix..."));
            await approveHeal(collectorId, true);
          } else {
            const approve = await Confirm.prompt("  Approve this fix?");
            if (!approve) {
              console.log(colors.red("  Fix rejected."));
              await approveHeal(collectorId, false);
              return { success: false };
            }
            console.log(colors.green("  Approving fix..."));
            await approveHeal(collectorId, true);
          }

          console.log(colors.cyan("  [4/4] Waiting for fix to apply..."));
          continue;
        }

        if (
          status === "done" || status === "completed" || status === "success"
        ) {
          console.log(colors.green.bold("  [4/4] Fix applied successfully"));
          return { success: true, preview: progress.preview_result };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429") || msg.includes("rate limit")) {
          console.log(colors.yellow("    Rate limited, waiting 10s..."));
          await new Promise((r) => setTimeout(r, 10000));
          continue;
        }
        throw err;
      }
    }

    console.error(colors.red.bold("  Heal timed out after 10 minutes"));
    return { success: false };
  });
}

export async function verifyHeal(
  collectorId: string,
  url: string,
): Promise<{ success: boolean; count: number }> {
  console.log(colors.cyan("  Verifying with test run..."));
  try {
    const res = await bdFetch<{ collection_id: string }>(
      `/dca/trigger?collector=${collectorId}&queue_next=1`,
      {
        method: "POST",
        body: JSON.stringify([{ url }]),
      },
    );

    const items = await pollUntil<unknown[]>(
      async () => {
        try {
          const data = await bdFetch(
            `/dca/dataset?id=${res.collection_id}`,
          );
          if (Array.isArray(data) && data.length > 0) return data;
          return null;
        } catch {
          return null;
        }
      },
      10000,
      30,
      "Verification",
    );

    const hasData = items.some((item) => {
      const r = item as Record<string, unknown>;
      return r.product_name || r.price;
    });

    if (hasData) {
      console.log(
        colors.green(`  Verification passed: ${items.length} items returned`),
      );
      return { success: true, count: items.length };
    }

    console.error(colors.red("  Verification failed: no valid product data"));
    return { success: false, count: 0 };
  } catch (err) {
    console.error(colors.red(`  Verification failed: ${err}`));
    return { success: false, count: 0 };
  }
}

function getStepNumber(step: string): string {
  if (step.includes("analyz")) return "2";
  if (step.includes("refactor") || step.includes("code_fix")) return "2";
  if (step.includes("preview") || step.includes("runner")) return "3";
  if (step.includes("approval")) return "3";
  if (step.includes("advance") || step.includes("done")) return "4";
  return "2";
}

function getStepLabel(step: string): string {
  if (step.includes("analyz")) return "Analyzing scraper template";
  if (step.includes("refactor") || step.includes("code_fix")) {
    return "Refactoring code";
  }
  if (step.includes("preview") || step.includes("runner")) {
    return "Testing fix preview";
  }
  if (step.includes("approval")) return "Awaiting approval";
  if (step.includes("advance")) return "Applying fix";
  if (step.includes("done")) return "Done";
  return `Processing (${step})`;
}
