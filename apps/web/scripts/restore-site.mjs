// Restore production data before an upstream refresh. Deployment is the durable
// store: a temporary network failure must leave the previous site intact.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadState, validMemory, validPredictions, writeJson } from "./state.mjs";

const base = (process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse").replace(/\/$/, "");
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/data");
await mkdir(path.join(dir, "feed"), { recursive: true });
const manifest = await loadState(path.join(dir, "manifest.json"), `${base}/data/manifest.json`,
  (value) => Array.isArray(value?.categories) && value.categories.length > 0);
for (const [name, validate] of [["memory", validMemory], ["predictions", validPredictions]]) {
  const file = path.join(dir, `${name}.json`);
  await writeJson(file, await loadState(file, `${base}/data/${name}.json`, validate));
  console.log(`restored ${name}`);
}
for (const category of manifest.categories) {
  if (!/^[a-z-]+(?:\.[A-Za-z-]+)?$/.test(category)) throw new Error("Invalid snapshot category");
  const file = path.join(dir, "feed", `${category}.json`);
  await writeJson(file, await loadState(file, `${base}/data/feed/${category}.json`,
    (value) => value?.category === category && Array.isArray(value.papers) && Number.isFinite(Date.parse(value.fetchedAt))));
}
await writeJson(path.join(dir, "manifest.json"), manifest);
console.log(`restored ${manifest.categories.length} categories; histories preserved`);
