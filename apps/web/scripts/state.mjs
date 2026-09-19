import { readFile, writeFile, rename } from "node:fs/promises";

/** A failed read must never turn a production history into an empty history. */
export async function loadState(file, url, validate, { allowEmpty = false, empty, timeout = 180_000 } = {}) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (!validate(value)) throw new Error(`Invalid state: ${file}`);
    return value;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let failure;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (response.status === 404 && allowEmpty) return structuredClone(empty);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      if (!validate(value)) throw new Error("Invalid remote state");
      return value;
    } catch (error) {
      failure = error;
    }
  }
  throw new Error(`Cannot preserve ${url}: ${failure?.message}. Refusing to reset history.`);
}

export async function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, file);
}

export const validMemory = (value) => value?.version === 1 && value.authors && value.terms && value.volume;
export const validPredictions = (value) => [1, 2].includes(value?.version) && Array.isArray(value.builds);
