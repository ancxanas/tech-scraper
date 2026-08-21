const envPath = new URL("./.env", import.meta.url).pathname;
try {
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
  // ignored
}

const { cli } = await import("./src/cli.ts");
cli.parse(Deno.args);
