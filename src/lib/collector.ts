import { bdFetch, pollUntil } from "./brightdata.ts";

interface TriggerBatchResponse {
  collection_id?: string;
  snapshot_id?: string;
  start_eta?: string;
}

export interface CollectorInput {
  url?: string;
  keyword?: string;
  country?: string;
}

export async function runCollector(
  collectorId: string,
  inputs: CollectorInput[],
): Promise<Record<string, unknown>[]> {
  const body = inputs.map((input) => {
    if (input.url) return { url: input.url };
    if (input.keyword && input.country) {
      return { keyword: input.keyword, country: input.country };
    }
    return { url: "" };
  });

  const triggerRes = await bdFetch<TriggerBatchResponse>(
    `/dca/trigger?collector=${collectorId}&queue_next=1`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  const collectionId = triggerRes.collection_id || triggerRes.snapshot_id;

  if (!collectionId) {
    throw new Error("No collection_id or snapshot_id in trigger response");
  }

  let pollAttempt = 0;
  let consecutiveErrors = 0;
  const MAX_POLL_ERRORS = 3;
  const items = await pollUntil<Record<string, unknown>[]>(
    async () => {
      pollAttempt++;
      try {
        const data = await bdFetch<Record<string, unknown>[]>(
          `/dca/dataset?id=${collectionId}`,
        );
        consecutiveErrors = 0;
        if (Array.isArray(data) && data.length > 0) return data;
        if (
          data && typeof data === "object" && !Array.isArray(data)
        ) {
          const obj = data as Record<string, unknown>;
          if (obj.error || obj.status === "failed" || obj.status === "error") {
            throw new Error(
              `DCA collector error: ${JSON.stringify(data).slice(0, 200)}`,
            );
          }
          const wrapped = obj.products || obj.data || obj.results;
          if (Array.isArray(wrapped) && wrapped.length > 0) return wrapped;
        }
        if (pollAttempt <= 5) {
          let preview: string;
          if (Array.isArray(data)) {
            preview = `array(${data.length})`;
          } else if (data === null) {
            preview = "null";
          } else if (typeof data === "object") {
            const obj = data as Record<string, unknown>;
            const parts: string[] = [];
            for (const [k, v] of Object.entries(obj).slice(0, 5)) {
              const val = typeof v === "string"
                ? `"${v.slice(0, 60)}"`
                : Array.isArray(v)
                ? `array(${v.length})`
                : typeof v === "object" && v !== null
                ? `{...}`
                : String(v);
              parts.push(`${k}: ${val}`);
            }
            preview = `{${parts.join(", ")}}`;
          } else {
            preview = String(data);
          }
          console.error(
            `    ${
              collectorId.slice(0, 15)
            }: poll #${pollAttempt} → ${preview}`,
          );
        } else if (pollAttempt % 5 === 0) {
          console.error(
            `    ${
              collectorId.slice(0, 15)
            }: poll #${pollAttempt}... collecting`,
          );
        }
        return null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("DCA collector error")) throw err;
        consecutiveErrors++;
        console.error(
          `    ${
            collectorId.slice(0, 15)
          }: poll #${pollAttempt} error (${consecutiveErrors}/${MAX_POLL_ERRORS}): ${
            msg.slice(0, 120)
          }`,
        );
        if (consecutiveErrors >= MAX_POLL_ERRORS) {
          throw new Error(
            `${
              collectorId.slice(0, 15)
            }: ${consecutiveErrors} consecutive errors — ${msg.slice(0, 100)}`,
          );
        }
        return null;
      }
    },
    10000,
    48,
    `Scraper ${collectorId.slice(0, 15)}`,
  );

  return items;
}
