// npm run verify -- --local [--outcomes citations.json] [--output report.json]
// Only mature cohorts trigger network work. v1 and v2 are never pooled.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditBuild, DAY, summariseAudits } from "./evaluation.mjs";
import { validPredictions } from "./state.mjs";

const base = (process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse").replace(/\/$/, "");
const s2 = process.env.S2_BASE ?? "https://api.semanticscholar.org/graph/v1";
const key = process.env.S2_API_KEY ?? "";
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/data");
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const minAge = Number(arg("--min-age", 90));
if (!Number.isFinite(minAge) || minAge < 90) throw new Error("--min-age must be at least 90 days");
const now = Date.now();
let log;
if (process.argv.includes("--local")) log = JSON.parse(await readFile(path.join(dataDir, "predictions.json"), "utf8"));
else {
  const response = await fetch(`${base}/data/predictions.json`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Prediction log: HTTP ${response.status}`);
  log = await response.json();
}
if (!validPredictions(log) || !log.builds.length) throw new Error("No valid prediction history");
const builds = [...log.builds].sort((a, b) => a.rankedAt.localeCompare(b.rankedAt));
const mature = builds.filter((build) => now - Date.parse(build.rankedAt) >= minAge * DAY);
const ids = [...new Set(mature.flatMap((build) => Object.values(build.cohorts).flat().map(([id]) => id)))];
const citations = new Map();
const outcomesFile = arg("--outcomes", null);
if (outcomesFile) {
  const outcomes = JSON.parse(await readFile(outcomesFile, "utf8"));
  for (const [id, count] of Object.entries(outcomes)) if (Number.isFinite(count) && count >= 0) citations.set(id, count);
} else {
  console.log(`${mature.length}/${builds.length} mature builds; querying ${ids.length} distinct outcomes`);
  for (let i = 0; i < ids.length; i += 400) {
    const batch = ids.slice(i, i + 400);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${s2}/paper/batch?fields=citationCount`, {
          method: "POST", signal: AbortSignal.timeout(60_000),
          headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
          body: JSON.stringify({ ids: batch.map((id) => `ARXIV:${id}`) }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const results = await response.json();
        if (!Array.isArray(results) || results.length !== batch.length) throw new Error("Malformed S2 batch");
        results.forEach((work, j) => {
          if (Number.isFinite(work?.citationCount) && work.citationCount >= 0) citations.set(batch[j], work.citationCount);
        });
        break;
      } catch (error) {
        if (attempt === 2) console.warn(`Unobserved batch: ${error.message}`);
        else await new Promise((resolve) => setTimeout(resolve, [5000, 15000][attempt]));
      }
    }
    if (i + 400 < ids.length) await new Promise((resolve) => setTimeout(resolve, key ? 1100 : 3200));
  }
}
const audits = builds.map((build) => auditBuild(build, citations, { now, minAge }));
const nextEligibleAt = builds.filter((build) => now - Date.parse(build.rankedAt) < minAge * DAY)
  .map((build) => new Date(Date.parse(build.rankedAt) + minAge * DAY).toISOString()).sort()[0] ?? null;
const report = { evaluatedAt: new Date(now).toISOString(), minAgeDays: minAge, nextEligibleAt,
  note: "Within-field diagnostics. Repeated papers and overlapping builds are dependent; these averages are not independent replications.",
  versions: summariseAudits(audits), audits };
await mkdir(dataDir, { recursive: true });
const output = arg("--output", path.join(dataDir, "ranking-audit.json"));
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, audits: undefined }, null, 2));
if (!mature.length) console.log(`No verdict yet. First eligible cohort: ${nextEligibleAt}`);
console.log(`Report: ${output}`);
