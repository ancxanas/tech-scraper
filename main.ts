import { cli } from "./src/cli.ts";

async function loadEnv() {
  try {
    const envPath = new URL("./.env", import.meta.url).pathname;
    const content = await Deno.readTextFile(envPath);
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!Deno.env.has(key)) {
        Deno.env.set(key, val);
      }
    }
  } catch {
    // .env file not found — that's fine, expect env var to be set
  }
}

await loadEnv();
cli.parse(Deno.args);
