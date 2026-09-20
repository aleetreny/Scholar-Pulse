import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("complete reader journey with upstream failures", async ({ browser }) => {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const root = "http://127.0.0.1:4175/Scholar-Pulse";
  let failSort = false,
    failPage = false;
  const works = Array.from({ length: 60 }, (_, i) => ({
    id: `https://openalex.org/W${1000 + i}`,
    doi: `https://doi.org/10.48550/arxiv.1503.${String(i).padStart(5, "0")}`,
    display_name: `Embedding study ${i}`,
    publication_date: `2015-03-${String((i % 28) + 1).padStart(2, "0")}`,
    cited_by_count: 12000 + i * 100,
    authorships: [
      { author: { display_name: "John Smith" } },
      { author: { display_name: "Jane Doe" } },
    ],
    abstract_inverted_index: { Embeddings: [0], research: [1] },
    referenced_works: ["https://openalex.org/W1002"],
  }));
  await context.route(
    "**/scholar-pulse-search.alejandrotreny100.workers.dev/**",
    async (route) => {
      const u = new URL(route.request().url());
      requests.push(u.href);
      let data = works;
      if (
        (failSort && u.searchParams.get("sort") === "cited_by_count:desc") ||
        (failPage && u.searchParams.get("page") === "2")
      )
        return route.fulfill({ status: 429, json: { error: "daily_budget" } });
      const filter = u.searchParams.get("filter") ?? "";
      if (filter.startsWith("openalex:"))
        data = works.filter((w) => w.id.endsWith(filter.slice(9)));
      else if (filter.startsWith("doi:"))
        data = works.filter((w) => w.doi.endsWith(filter.slice(4)));
      else if (filter.startsWith("cites:")) data = works.slice(1, 4);
      else if (u.searchParams.get("search") === "no-matching-paper") data = [];
      else if (u.searchParams.get("sort") === "cited_by_count:desc")
        data = [...works].reverse();
      else if (u.searchParams.get("sort") === "publication_date:desc")
        data = [...works].sort((a, b) =>
          b.publication_date.localeCompare(a.publication_date),
        );
      const start = (Number(u.searchParams.get("page") ?? 1) - 1) * 25;
      await route.fulfill({
        json: {
          meta: { count: data.length },
          results: data.slice(start, start + 25),
        },
      });
    },
  );
  await context.route("**/api.semanticscholar.org/**", (route) =>
    route.fulfill({ status: 429, json: { message: "Rate limit" } }),
  );
  await context.route("**/data/manifest.json", (route) =>
    route.fulfill({
      json: {
        generatedAt: "2026-09-20",
        categories: ["cs.AI"],
        freshness: { "cs.AI": "2026-09-20" },
      },
    }),
  );
  await context.route("**/data/feed/cs.AI.json", (route) =>
    route.fulfill({
      json: {
        category: "cs.AI",
        fetchedAt: "2026-09-20",
        papers: works
          .slice(0, 3)
          .map((w, i) => ({
            id: `1503.${String(i).padStart(5, "0")}`,
            versionedId: `1503.${String(i).padStart(5, "0")}v1`,
            title: w.display_name,
            abstract: "Embeddings research",
            authors: ["John Smith"],
            published: "2026-09-19",
            updated: "2026-09-19",
            primaryCategory: "cs.AI",
            categories: ["cs.AI"],
            doi: null,
            journalRef: null,
            comment: null,
            pdfUrl: "https://arxiv.org/pdf/1503.00000",
            absUrl: "https://arxiv.org/abs/1503.00000",
            pulse: {
              score: 90 - i,
              tier: "headline",
              lanes: [],
              reasons: [],
              newcomer: false,
              cohort: "cs.AI",
            },
          })),
      },
    }),
  );
  const check = (name) => console.log("PASS " + name);
  const ready = () =>
    page.locator(".paper-card").first().waitFor({ timeout: 30000 });
  await page.goto(root + "/search/?q=embeddings");
  await ready();
  assert.equal(await page.locator(".result-count").textContent(), "60 results");
  check("relevance loads index");
  failSort = true;
  await page.getByRole("button", { name: /^Most cited$/i }).click();
  await page.locator(".error-box").waitFor();
  assert.equal(await page.locator(".paper-card").count(), 0);
  assert.equal(await page.locator(".result-count").count(), 0);
  assert.ok(!(await page.locator("body").innerText()).includes("154 results"));
  check("failed sorting cannot replace the corpus");
  failSort = false;
  await page.getByRole("button", { name: /^Retry$/i }).click();
  await ready();
  assert.equal(await page.locator(".result-count").textContent(), "60 results");
  assert.equal(
    await page.locator(".paper-card h3").first().innerText(),
    "Embedding study 59",
  );
  check("sort retry preserves total and ranks by citations");
  failPage = true;
  await page.getByRole("button", { name: /Load more results/i }).click();
  await page.locator(".error-box").waitFor();
  assert.equal(await page.locator(".paper-card").count(), 20);
  check("page failure preserves results and exposes retry");
  failPage = false;
  await page.getByRole("button", { name: /^Retry$/i }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".paper-card").length === 40,
  );
  assert.equal(
    new Set(
      await page
        .locator(".paper-card")
        .evaluateAll((a) => a.map((x) => x.getAttribute("href"))),
    ).size,
    40,
  );
  check("page retry loads correct next page without duplicates");
  await page.getByRole("button", { name: /^Newest$/i }).click();
  await page.waitForURL("**sort=recent");
  await page.waitForFunction(
    () =>
      document.querySelector(".segmented button[data-active=true]")
        ?.textContent === "Newest",
  );
  await ready();
  assert.equal(await page.locator(".result-count").textContent(), "60 results");
  await page.goBack();
  await page.waitForURL("**sort=citations");
  await page.waitForFunction(
    () =>
      document.querySelector(".segmented button[data-active=true]")
        ?.textContent === "Most cited",
  );
  await ready();
  assert.equal(
    await page
      .getByRole("button", { name: /^Most cited$/i })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page.locator(".paper-card h3").first().innerText(),
    "Embedding study 59",
  );
  check("browser back restores applied ordering");
  await page.getByRole("combobox").selectOption("17");
  await page.waitForURL("**field=17**");
  await ready();
  assert.ok(page.url().includes("field=17"));
  await page.reload();
  await ready();
  assert.equal(await page.getByRole("combobox").inputValue(), "17");
  check("field filter and sorting survive reload");
  await page.locator(".paper-card button").first().click();
  await page.locator(".paper-card h3").first().click();
  await page.locator(".paper-page h1").waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".paper-page__stats")?.textContent.includes("18k"),
  );
  assert.ok(
    (await page.locator(".paper-page__stats").textContent()).includes("18k"),
  );
  check("search work citation identity survives details");
  assert.ok(page.url().includes("work=W1059"));
  const shared = await context.newPage();
  await shared.goto(page.url());
  await shared.locator(".paper-page h1").waitFor();
  assert.equal(await shared.locator(".paper-page h1").textContent(), "Embedding study 59");
  assert.match(await shared.locator(".paper-page__stats").textContent(), /18k/);
  await shared.close();
  check("shared link resolves the same work without session metadata");

  await page.getByRole("link", { name: "John Smith", exact: true }).click();
  await ready();
  assert.equal(
    await page.getByRole("searchbox").inputValue(),
    "author:John Smith",
  );
  assert.ok(
    requests.some((u) =>
      new URL(u).searchParams
        .get("filter")
        ?.includes('raw_author_name.search:"John Smith"'),
    ),
  );
  check("author navigation uses a byline phrase");
  assert.equal(await page.getByRole("button", {name:/^Most cited$/i}).getAttribute("aria-pressed"), "true");

  await page
    .locator(".masthead__nav")
    .getByRole("link", { name: /Library/i })
    .click();
  await page.locator(".library-entry").waitFor();
  await page.getByRole("button", { name: /Add note/i }).click();
  await page
    .getByRole("textbox", { name: "Personal note" })
    .fill("Keep this note without leaving the field.");
  await page.reload();
  await page.locator(".library-entry").waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Personal note" }).inputValue(),
    "Keep this note without leaving the field.",
  );
  check("notes persist on immediate reload");
  await page
    .locator(".status-select")
    .getByRole("button", { name: "Reading", exact: true })
    .click();
  await page
    .locator(".library-toolbar")
    .getByRole("button", { name: "Read", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Nothing with this status" })
    .waitFor();
  await page
    .locator(".library-toolbar")
    .getByRole("button", { name: "All", exact: true })
    .click();
  check("library reading states and filters");
  const dlPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const dl = await dlPromise;
  const backup = JSON.parse(await readFile(await dl.path(), "utf8"));
  assert.equal(
    backup.entries[0].note,
    "Keep this note without leaving the field.",
  );
  check("library JSON export keeps notes");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("heading", { name: "Your library is empty" }).waitFor();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await page.locator(".library-entry").waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Personal note" }).inputValue(),
    backup.entries[0].note,
  );
  check("library import restores notes and reading state");
  await page
    .locator(".masthead__nav")
    .getByRole("link", { name: /For you/i })
    .click();
  await page.getByRole("button", { name: /Artificial Intelligence/i }).click();
  await page.getByRole("button", { name: /Build my feed/i }).click();
  await ready();
  check("onboarding and ranked feed");
  await page
    .locator(".masthead__nav")
    .getByRole("link", { name: /Topics/i })
    .click();
  await page.getByRole("heading", { name: /Topics/i }).waitFor();
  check("topics page");
  await page.getByRole("button", { name: "Cambiar a español" }).click();
  assert.ok((await page.locator("h1").innerText()).length);
  await page.getByRole("button", { name: /tema oscuro/i }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  check("Spanish and dark theme");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(root + "/search/?q=embeddings&sort=citations");
  await ready();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  check("mobile layout no horizontal overflow");
  await page.getByRole("searchbox").fill("no-matching-paper");
  await page.getByRole("heading", {name:"Sin resultados",exact:true}).waitFor();
  await page.getByRole("button", {name:"Borrar búsqueda",exact:true}).click();
  await page.getByRole("heading", {name:"Explora una disciplina o busca un paper",exact:true}).waitFor();
  check("empty query and no-results states in Spanish");

  assert.deepEqual(errors, []);
  await context.close();
});

test("partial feed failures identify the missing discipline and recover", async ({
  page,
}) => {
  let unavailable = true;
  await page.addInitScript(() =>
    localStorage.setItem(
      "scholarpulse.topics.v1",
      JSON.stringify(["cs.AI", "cs.LG"]),
    ),
  );
  await page.route("**/data/manifest.json", (route) =>
    route.fulfill({
      json: { generatedAt: "2026-09-20", categories: ["cs.AI", "cs.LG"] },
    }),
  );
  await page.route("**/data/feed/*.json", (route) => {
    const category = route.request().url().includes("cs.LG")
      ? "cs.LG"
      : "cs.AI";
    if (category === "cs.LG" && unavailable)
      return route.fulfill({ status: 503, body: "Unavailable" });
    return route.fulfill({
      json: {
        category,
        fetchedAt: "2026-09-20",
        papers: [
          {
            id: category === "cs.AI" ? "2609.00001" : "2609.00002",
            versionedId: "2609.00001v1",
            title: category + " research",
            authors: ["Ada Lovelace"],
            abstract: "Research",
            published: "2026-09-19",
            updated: "2026-09-19",
            categories: [category],
            primaryCategory: category,
            pdfUrl: "https://arxiv.org/pdf/2609.00001",
            absUrl: "https://arxiv.org/abs/2609.00001",
          },
        ],
      },
    });
  });
  await page.goto("/Scholar-Pulse/");
  await page.locator(".error-box").waitFor();
  assert.match(
    await page.locator(".error-box").textContent(),
    /Machine Learning/,
  );
  assert.equal(await page.locator(".paper-card").count(), 1);
  unavailable = false;
  await page.locator(".error-box button").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".paper-card").length === 2,
  );
  assert.equal(await page.locator(".error-box").count(), 0);
});

test("feed detail preserves its citation source when live enrichment fails", async ({ browser }) => {
  // Both a positive count and a measured zero outrank another index's count.
  for (const [snapshotCount, otherCount] of [[1, 0], [0, 20]]) {
    const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem(
      "scholarpulse.topics.v1", JSON.stringify(["cs.CV"]),
    ));
    await page.route("**/data/manifest.json", route => route.fulfill({
      json: { generatedAt: "2026-09-20", categories: ["cs.CV"] },
    }));
    await page.route("**/data/feed/cs.CV.json", route => route.fulfill({
      json: { category: "cs.CV", fetchedAt: "2026-09-20", papers: [{
        id: "2609.19927", versionedId: "2609.19927v1",
        title: "DirtyMoCap: Robust Motion Capture from Unconstrained Markers",
        authors: ["Research author"], abstract: "Motion capture research",
        published: "2026-09-19", updated: "2026-09-19",
        categories: ["cs.CV"], primaryCategory: "cs.CV",
        absUrl: "https://arxiv.org/abs/2609.19927",
        pdfUrl: "https://arxiv.org/pdf/2609.19927",
        metrics: { citations: snapshotCount, references: 31, asOf: "2026-09-19T22:25:13.716Z" },
      }] },
    }));
    await page.route("**/api.semanticscholar.org/**", route =>
      route.fulfill({ status: 404, json: { message: "Not found" } }),
    );
    await page.route("**/scholar-pulse-search.alejandrotreny100.workers.dev/**", route =>
      route.fulfill({ json: { meta: { count: 1 }, results: [{
        id: "https://openalex.org/W7213586499",
        doi: "https://doi.org/10.48550/arxiv.2609.19927",
        display_name: "DirtyMoCap: Robust Motion Capture from Unconstrained Markers",
        cited_by_count: otherCount, referenced_works: [],
      }] } }),
    );
    await page.goto("http://127.0.0.1:4175/Scholar-Pulse/");
    const card = page.locator(".paper-card").first();
    await card.waitFor();
    assert.match(await card.innerText(), new RegExp(`${snapshotCount} citation`, "i"));
    await card.locator("h3").click();
    await page.getByRole("button", { name: /^Cited by/ }).waitFor();
    await page.locator(".notice").waitFor();
    const count = page.locator('.paper-page__stats [title*="Semantic Scholar"]');
    assert.match(await count.getAttribute("title"), new RegExp(`^${snapshotCount} · Semantic Scholar ·`));
    assert.match(await count.getAttribute("title"), /Sep 19, 2026/);
    assert.match(await count.innerText(), snapshotCount === 1 ? /1\s+citation/i : /Not cited yet/i);
    await context.close();
  }
});
