import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RANKING_MODEL } from "./model.generated.ts";
import {
  type Enrichment,
  calibrate,
  interleave,
  orderByPulse,
  percentileRank,
  scoreCohort,
} from "./score.ts";
import {
  EMPTY_MEMORY,
  SIGNAL_NAMES,
  burstScores,
  extractSignals,
  foldIntoMemory,
  monthIndex,
  tokenize,
} from "./signals.ts";
import type { Paper } from "@/lib/types";

function paper(overrides: Partial<Paper> & { id: string }): Paper {
  return {
    versionedId: `${overrides.id}v1`,
    title: "A study of things",
    abstract: "We study things and report what we found about the things.",
    authors: ["Ada Lovelace"],
    published: "2026-03-04T00:00:00Z",
    updated: "2026-03-04T00:00:00Z",
    primaryCategory: "cs.LG",
    categories: ["cs.LG"],
    doi: null,
    journalRef: null,
    comment: null,
    pdfUrl: "",
    absUrl: "",
    ...overrides,
  };
}

/** A cohort large enough for percentiles to mean something. */
function cohort(n: number, make: (i: number) => Partial<Paper> = () => ({})): Paper[] {
  return Array.from({ length: n }, (_, i) =>
    paper({ id: `2603.${String(i).padStart(5, "0")}`, ...make(i) }),
  );
}

describe("percentileRank", () => {
  it("orders values and stays strictly inside (0, 1)", () => {
    const ranks = percentileRank([10, 30, 20]);
    assert.ok(ranks[0] < ranks[2] && ranks[2] < ranks[1]);
    assert.ok(ranks.every((value) => value > 0 && value < 1));
  });

  it("averages ties, so a lane of all-equal values carries no opinion", () => {
    const ranks = percentileRank([5, 5, 5, 5]);
    assert.deepEqual(new Set(ranks).size, 1);
  });

  it("puts a lone non-zero value on top of a field of zeros", () => {
    const ranks = percentileRank([0, 0, 0, 0, 7]);
    assert.equal(Math.max(...ranks), ranks[4]);
    assert.equal(new Set(ranks.slice(0, 4)).size, 1);
  });

  it("returns an empty array for an empty cohort", () => {
    assert.deepEqual(percentileRank([]), []);
  });
});

describe("calibration", () => {
  it("never decreases as the percentile rises", () => {
    let previous = -1;
    for (let x = 0; x <= 1.0001; x += 0.02) {
      const value = calibrate(x);
      assert.ok(value >= previous - 1e-9, `dropped at ${x}`);
      previous = value;
    }
  });

  it("clamps outside [0, 1] instead of extrapolating", () => {
    assert.equal(calibrate(-5), calibrate(0));
    assert.equal(calibrate(5), calibrate(1));
  });

  it("reports a probability, not a score", () => {
    for (const x of [0, 0.25, 0.5, 0.9, 1]) {
      const value = calibrate(x);
      assert.ok(value >= 0 && value <= 1, `${value} out of range at ${x}`);
    }
    assert.ok(calibrate(0.99) > calibrate(0.5));
  });
});

describe("the shipped model", () => {
  it("only weights signals the extractor actually produces", () => {
    for (const name of Object.keys(RANKING_MODEL.weights)) {
      assert.ok(
        (SIGNAL_NAMES as readonly string[]).includes(name),
        `${name} is weighted but never computed`,
      );
    }
  });

  it("carries the validation numbers the interface quotes", () => {
    assert.ok(RANKING_MODEL.validation.auc > 0.5);
    assert.ok(RANKING_MODEL.validation.aucLow < RANKING_MODEL.validation.auc);
    assert.ok(RANKING_MODEL.validation.aucHigh > RANKING_MODEL.validation.auc);
  });

  it("has a calibration curve that starts and ends at the edges", () => {
    const first = RANKING_MODEL.calibration[0];
    const last = RANKING_MODEL.calibration[RANKING_MODEL.calibration.length - 1];
    assert.equal(first[0], 0);
    assert.equal(last[0], 1);
  });
});

describe("corpus memory", () => {
  it("records authors, their recency and their collaborators", () => {
    const memory = foldIntoMemory(EMPTY_MEMORY, [
      paper({ id: "a", authors: ["Ada", "Grace"], published: "2026-01-15T00:00:00Z" }),
      paper({ id: "b", authors: ["Ada", "Alan"], published: "2026-02-15T00:00:00Z" }),
    ]);
    assert.equal(memory.authors.Ada.n, 2);
    assert.equal(memory.authors.Ada.deg, 2, "Ada collaborated with Grace and Alan");
    assert.equal(memory.authors.Grace.deg, 1);
    assert.equal(memory.authors.Ada.last, monthIndex("2026-02-15T00:00:00Z"));
  });

  it("accumulates across builds rather than replacing", () => {
    const first = foldIntoMemory(EMPTY_MEMORY, [paper({ id: "a", authors: ["Ada"] })]);
    const second = foldIntoMemory(first, [paper({ id: "b", authors: ["Ada"] })]);
    assert.equal(second.authors.Ada.n, 2);
    assert.equal(first.authors.Ada.n, 1, "the input memory must not be mutated");
  });

  it("forgets authors and months beyond the two-year horizon", () => {
    const old = foldIntoMemory(EMPTY_MEMORY, [
      paper({ id: "old", authors: ["Rip"], published: "2020-01-01T00:00:00Z" }),
    ]);
    const fresh = foldIntoMemory(old, [
      paper({ id: "new", authors: ["Ada"], published: "2026-03-01T00:00:00Z" }),
    ]);
    assert.ok(!("Rip" in fresh.authors), "a name unseen for six years should be dropped");
    assert.ok("Ada" in fresh.authors);
  });

  it("tokenizes titles without stopwords", () => {
    const tokens = tokenize("A Study of the Transformer Model");
    assert.ok(tokens.includes("transformer"));
    assert.ok(!tokens.includes("the"));
    assert.ok(!tokens.includes("model"), "generic paper-speak is a stopword");
  });
});

describe("burst detection", () => {
  it("says nothing at all until there is a baseline to compare against", () => {
    assert.equal(burstScores(EMPTY_MEMORY, monthIndex("2026-03-01T00:00:00Z")).size, 0);
  });

  it("scores a term that took off higher than one that faded", () => {
    let memory = EMPTY_MEMORY;
    // Two years of "diffusion", then six months where "agents" takes over.
    for (let month = 0; month < 18; month += 1) {
      const when = new Date(Date.UTC(2024, month, 10)).toISOString();
      memory = foldIntoMemory(
        memory,
        cohort(10, (i) => ({
          id: `old-${month}-${i}`,
          title: "Diffusion transport analysis",
          published: when,
        })),
      );
    }
    for (let month = 18; month < 24; month += 1) {
      const when = new Date(Date.UTC(2024, month, 10)).toISOString();
      memory = foldIntoMemory(
        memory,
        cohort(10, (i) => ({
          id: `new-${month}-${i}`,
          title: "Agents planning benchmark",
          published: when,
        })),
      );
    }
    const bursts = burstScores(memory, monthIndex("2026-01-10T00:00:00Z"));
    assert.ok(bursts.get("agents")! > bursts.get("diffusion")!);
  });
});

describe("signal extraction", () => {
  const now = monthIndex("2026-03-04T00:00:00Z");

  it("flags a paper whose authors are all unknown", () => {
    const signals = extractSignals(
      paper({ id: "x", authors: ["Nobody Yet", "Also Nobody"] }),
      EMPTY_MEMORY,
      new Map(),
      now,
    );
    assert.equal(signals.author_new_frac, 1);
    assert.equal(signals.author_reach, 0);
  });

  it("treats no history as maximally stale, not as freshly published", () => {
    const signals = extractSignals(paper({ id: "x" }), EMPTY_MEMORY, new Map(), now);
    assert.ok(signals.author_recency >= 24);
  });

  it("credits a known author's collaborative reach", () => {
    const memory = foldIntoMemory(EMPTY_MEMORY, [
      paper({ id: "a", authors: ["Ada", "Grace", "Alan"], published: "2026-02-01T00:00:00Z" }),
    ]);
    const known = extractSignals(
      paper({ id: "x", authors: ["Ada"] }),
      memory,
      new Map(),
      now,
    );
    const unknown = extractSignals(
      paper({ id: "y", authors: ["Stranger"] }),
      memory,
      new Map(),
      now,
    );
    assert.ok(known.author_reach > unknown.author_reach);
    assert.equal(known.author_new_frac, 0);
  });

  it("reads the surface shape of the title and abstract", () => {
    const signals = extractSignals(
      paper({ id: "x", title: "BERT: Pre-training Deep Transformers", abstract: "one two three" }),
      EMPTY_MEMORY,
      new Map(),
      now,
    );
    assert.equal(signals.has_named_system, 1);
    assert.equal(signals.title_has_colon, 1);
    assert.equal(signals.abstract_words, 3);
    assert.equal(signals.title_words, 4);
  });
});

describe("scoreCohort", () => {
  const now = monthIndex("2026-03-04T00:00:00Z");

  it("returns one pulse per paper, scored 0-100", () => {
    const papers = cohort(40, (i) => ({ title: `Title number ${i}` }));
    const pulses = scoreCohort(papers, EMPTY_MEMORY, now);
    assert.equal(pulses.length, papers.length);
    for (const pulse of pulses) {
      assert.ok(pulse.score >= 0 && pulse.score <= 100);
      assert.ok(["headline", "notable", "rest"].includes(pulse.tier));
    }
  });

  it("is deterministic", () => {
    const papers = cohort(30, (i) => ({ title: `Study ${i} of gradient flow` }));
    const a = scoreCohort(papers, EMPTY_MEMORY, now);
    const b = scoreCohort(papers, EMPTY_MEMORY, now);
    assert.deepEqual(a, b);
  });

  it("keeps tiers consistent with scores", () => {
    const papers = cohort(60, (i) => ({
      title: `Paper ${i}`,
      authors: Array.from({ length: (i % 7) + 1 }, (_, k) => `Author ${i}-${k}`),
    }));
    for (const pulse of scoreCohort(papers, EMPTY_MEMORY, now)) {
      if (pulse.tier === "headline") {
        assert.ok(pulse.score >= 95);
      } else if (pulse.tier === "notable") {
        assert.ok(pulse.score >= 80 && pulse.score < 95);
      }
    }
  });

  it("uses only the signals lane when nothing is enriched", () => {
    const pulses = scoreCohort(cohort(30), EMPTY_MEMORY, now);
    assert.deepEqual(pulses[0].lanes, ["signals"]);
  });

  it("picks up the reception lane once citations vary", () => {
    const papers = cohort(30, (i) => ({ title: `Paper ${i}` }));
    const enrichment = new Map<string, Enrichment>(
      papers.map((item, i) => [item.id, { citations: i, references: 10 + i }]),
    );
    const pulses = scoreCohort(papers, EMPTY_MEMORY, now, enrichment);
    assert.deepEqual(pulses[0].lanes, ["signals", "references", "reception"]);
  });

  it("ignores a lane where every paper reads the same", () => {
    const papers = cohort(30, (i) => ({ title: `Paper ${i}` }));
    const enrichment = new Map<string, Enrichment>(
      papers.map((item) => [item.id, { citations: 0 }]),
    );
    const pulses = scoreCohort(papers, EMPTY_MEMORY, now, enrichment);
    assert.deepEqual(pulses[0].lanes, ["signals"], "all-zero citations say nothing");
  });

  it("lets citations move a paper up once they exist", () => {
    const papers = cohort(30, (i) => ({ title: `Paper ${i}` }));
    const enrichment = new Map<string, Enrichment>(
      papers.map((item, i) => [item.id, { citations: i === 29 ? 40 : 0 }]),
    );
    const plain = scoreCohort(papers, EMPTY_MEMORY, now);
    const cited = scoreCohort(papers, EMPTY_MEMORY, now, enrichment);
    assert.ok(cited[29].score > plain[29].score);
  });

  it("ranks papers with no author history against each other, not against the rest", () => {
    const memory = foldIntoMemory(
      EMPTY_MEMORY,
      cohort(30, (i) => ({
        id: `hist-${i}`,
        authors: [`Known ${i}`, `Known ${(i + 1) % 30}`],
        published: "2026-01-10T00:00:00Z",
      })),
    );
    const papers = [
      ...cohort(25, (i) => ({
        id: `known-${i}`,
        authors: [`Known ${i}`],
        title: `An established investigation of subject ${i}`,
      })),
      ...cohort(8, (i) => ({
        id: `new-${i}`,
        authors: Array.from({ length: i + 1 }, (_, k) => `Stranger ${i}-${k}`),
        title: i === 0 ? "Terse: a result" : `A rather longer newcomer paper about ${i}`,
      })),
    ];
    const pulses = scoreCohort(papers, memory, now);
    const newcomers = pulses.filter((pulse) => pulse.newcomer);
    assert.equal(newcomers.length, 8);
    // Judged against each other they spread across the range; pooled with the
    // rest they would all sit at the bottom, because on author signals they are
    // identical and uniformly the worst.
    assert.ok(Math.max(...newcomers.map((pulse) => pulse.score)) > 60);
    assert.ok(Math.min(...newcomers.map((pulse) => pulse.score)) < 40);
  });

  it("explains itself with contributions that point the right way", () => {
    const papers = cohort(40, (i) => ({
      title: i === 0 ? "Sharp: a short title" : `A considerably longer title about topic ${i}`,
      authors: Array.from({ length: i === 0 ? 8 : 2 }, (_, k) => `Person ${i}-${k}`),
    }));
    const pulses = scoreCohort(papers, EMPTY_MEMORY, now);
    for (const reason of pulses[0].reasons) {
      assert.ok(reason.contribution > 0, "a listed reason must have helped");
      assert.ok((SIGNAL_NAMES as readonly string[]).includes(reason.signal));
    }
    assert.ok(pulses[0].reasons.length <= 3);
  });

  it("survives degenerate cohorts", () => {
    assert.deepEqual(scoreCohort([], EMPTY_MEMORY, now), []);
    assert.equal(scoreCohort([paper({ id: "solo" })], EMPTY_MEMORY, now).length, 1);
  });
});

describe("newcomer interleaving", () => {
  type Row = { id: number; newcomer: boolean; rank: number };
  const rows: Row[] = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: i, newcomer: false, rank: 100 - i })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, newcomer: true, rank: 50 - i })),
  ];

  it("reserves roughly the quota for newcomers at the top of the board", () => {
    const ordered = interleave(rows, (row) => row.newcomer, (row) => row.rank, 0.3);
    const topTen = ordered.slice(0, 10).filter((row) => row.newcomer).length;
    assert.ok(topTen >= 2 && topTen <= 4, `got ${topTen} newcomers in the top ten`);
  });

  it("never reorders within a lane", () => {
    const ordered = interleave(rows, (row) => row.newcomer, (row) => row.rank, 0.3);
    const established = ordered.filter((row) => !row.newcomer).map((row) => row.id);
    assert.deepEqual(established, [...established].sort((a, b) => a - b));
  });

  it("keeps every paper exactly once", () => {
    const ordered = interleave(rows, (row) => row.newcomer, (row) => row.rank, 0.3);
    assert.equal(ordered.length, rows.length);
    assert.equal(new Set(ordered.map((row) => row.id)).size, rows.length);
  });

  it("falls back cleanly when one lane is empty", () => {
    const onlyEstablished = rows.filter((row) => !row.newcomer);
    const ordered = interleave(onlyEstablished, (row) => row.newcomer, (row) => row.rank);
    assert.equal(ordered.length, onlyEstablished.length);
    assert.equal(ordered[0].rank, 100);
  });
});

describe("display order", () => {
  const now = monthIndex("2026-03-04T00:00:00Z");

  function board() {
    const memory = foldIntoMemory(
      EMPTY_MEMORY,
      cohort(40, (i) => ({
        id: `hist-${i}`,
        authors: [`Known ${i}`, `Known ${(i + 3) % 40}`],
        published: "2026-01-10T00:00:00Z",
      })),
    );
    const papers = [
      ...cohort(60, (i) => ({
        id: `known-${i}`,
        authors: [`Known ${i % 40}`],
        title: `Established work on subject ${i} with a longer descriptive title`,
      })),
      ...cohort(30, (i) => ({
        id: `new-${i}`,
        authors: Array.from({ length: (i % 6) + 1 }, (_, k) => `Stranger ${i}-${k}`),
        title: i % 3 === 0 ? `Terse: result ${i}` : `A longer newcomer paper about topic ${i}`,
      })),
    ];
    const pulses = scoreCohort(papers, memory, now);
    return papers.map((paper, i) => ({ paper, pulse: pulses[i] }));
  }

  it("never shows the same band twice", () => {
    const ordered = orderByPulse(board(), (row) => row.pulse);
    const bands = ordered
      .map((row) => row.pulse.tier)
      .filter((tier, i, all) => tier !== all[i - 1]);
    assert.equal(
      new Set(bands).size,
      bands.length,
      `bands oscillate: ${bands.join(" | ")}`,
    );
  });

  it("puts the bands in descending order", () => {
    const order = ["headline", "notable", "rest"];
    const ordered = orderByPulse(board(), (row) => row.pulse);
    const seen = ordered.map((row) => order.indexOf(row.pulse.tier));
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  });

  it("still reserves room for newcomers inside a band", () => {
    const ordered = orderByPulse(board(), (row) => row.pulse);
    const head = ordered.filter((row) => row.pulse.tier !== "rest");
    const share = head.filter((row) => row.pulse.newcomer).length / head.length;
    assert.ok(share > 0.1, `newcomers squeezed out of the head: ${share.toFixed(2)}`);
  });

  it("keeps every paper, and sends unscored ones to the end", () => {
    const rows = [...board(), { paper: paper({ id: "unscored" }), pulse: undefined }];
    const ordered = orderByPulse(rows, (row) => row.pulse);
    assert.equal(ordered.length, rows.length);
    assert.equal(ordered[ordered.length - 1].paper.id, "unscored");
  });
});
