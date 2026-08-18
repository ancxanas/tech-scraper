import { bdFetch } from "./brightdata.ts";

interface UnlockResponse {
  status_code?: number;
  headers?: Record<string, string>;
  body?: string;
}

function getUnlockerZone(): string {
  const zone = Deno.env.get("UNLOCKER_ZONE");
  if (!zone) {
    throw new Error(
      "UNLOCKER_ZONE not set. Create a Web Unlocker zone at https://brightdata.com/cp/web_access/new",
    );
  }
  return zone;
}

export async function fetchPageHtml(url: string): Promise<string> {
  const zone = getUnlockerZone();
  const res = await bdFetch<UnlockResponse>("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
      country: "in",
    }),
  });

  if (res.status_code && res.status_code >= 400) {
    throw new Error(
      `Web Unlocker returned ${res.status_code} for ${url}`,
    );
  }

  return res.body || "";
}

export async function fetchPageMarkdown(url: string): Promise<string> {
  const zone = getUnlockerZone();
  const res = await bdFetch<UnlockResponse>("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
      country: "in",
      data_format: "markdown",
    }),
  });

  return res.body || "";
}

export async function takeScreenshot(url: string): Promise<string> {
  const zone = getUnlockerZone();
  const res = await bdFetch<UnlockResponse>("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
      country: "in",
      data_format: "screenshot",
    }),
  });

  return res.body || "";
}

export async function fetchWithUnlocker(
  url: string,
  options: { render?: boolean; markdown?: boolean } = {},
): Promise<string> {
  const zone = getUnlockerZone();
  const body: Record<string, unknown> = {
    zone,
    url,
    format: "raw",
    country: "in",
  };

  if (options.render) body.render = "true";
  if (options.markdown) body.data_format = "markdown";

  const res = await bdFetch<UnlockResponse>("/request", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return res.body || "";
}
