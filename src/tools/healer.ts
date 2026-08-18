import { bdFetch, pollUntil } from "../lib/brightdata.ts";

interface HealProgress {
  step?: string;
  status?: string;
  preview_result?: unknown[];
  diff_summary?: string;
  view_url?: string;
  prompt?: string;
  completed_steps?: string[];
}

export async function triggerHeal(
  collectorId: string,
  prompt: string,
): Promise<void> {
  await bdFetch(`/dca/collectors/${collectorId}/refactor_template`, {
    method: "POST",
    body: JSON.stringify({ prompt, custom_input: [] }),
  });
}

export async function pollHealProgress(
  collectorId: string,
): Promise<HealProgress> {
  return await pollUntil<HealProgress>(
    async () => {
      try {
        const res = await bdFetch<HealProgress>(
          `/dca/collectors/${collectorId}/refactor_template/progress`,
        );
        const step = res.step || "";
        const status = res.status || "";

        if (
          status === "done" || status === "completed" || status === "success"
        ) {
          return res;
        }

        if (
          step === "user_approval" ||
          status === "pending_answer" ||
          status === "awaiting_approval"
        ) {
          return res;
        }

        if (
          status === "failed" || status === "error" || status === "cancelled"
        ) {
          throw new Error(`Heal failed: ${status} at step ${step}`);
        }

        return null;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Heal failed")) {
          throw err;
        }
        return null;
      }
    },
    5000,
    120,
    "Self-healing",
  );
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

export async function runHealFlow(
  collectorId: string,
  prompt: string,
  autoApprove: boolean,
): Promise<{ success: boolean; preview?: unknown[] }> {
  console.log("  [1/4] Triggering AI self-healing...");
  await triggerHeal(collectorId, prompt);

  console.log("  [2/4] Analyzing scraper template...");

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
        console.log(`  [${stepNum}/4] ${getStepLabel(step)}...`);
        lastStep = step;
      }

      if (status === "failed" || status === "error") {
        console.error(`  Heal failed at step: ${step}`);
        return { success: false };
      }

      if (
        step === "user_approval" ||
        status === "pending_answer" ||
        status === "awaiting_approval"
      ) {
        console.log("  [3/4] Fix ready — awaiting approval");

        if (progress.preview_result) {
          console.log("\n  Preview of fixed scraper output:");
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
                  return `${k}: ${val.slice(0, 40)}`;
                })
                .join(", ");
              console.log(`    ${fields}`);
            }
          }
          console.log();
        }

        if (progress.diff_summary) {
          console.log(`  Diff: ${progress.diff_summary}`);
        }

        if (autoApprove) {
          console.log("  Auto-approving fix...");
          await approveHeal(collectorId, true);
        } else {
          console.log("  Approving fix...");
          await approveHeal(collectorId, true);
        }

        console.log("  [4/4] Applying fix...");
        break;
      }

      if (status === "done" || status === "completed" || status === "success") {
        console.log("  [4/4] Fix applied successfully");
        return { success: true, preview: progress.preview_result };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("rate limit")) {
        console.log("    Rate limited, waiting 10s...");
        await new Promise((r) => setTimeout(r, 10000));
        continue;
      }
      throw err;
    }
  }

  return { success: true };
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
