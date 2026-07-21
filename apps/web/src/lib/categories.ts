export type CategoryGroup = {
  label: string;
  categories: { id: string; label: string }[];
};

/**
 * Curated slice of the arXiv taxonomy: the categories researchers follow most,
 * grouped by discipline. Ids match arXiv category codes exactly.
 */
export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    label: "Computer Science",
    categories: [
      { id: "cs.AI", label: "Artificial Intelligence" },
      { id: "cs.LG", label: "Machine Learning" },
      { id: "cs.CL", label: "Computation & Language (NLP)" },
      { id: "cs.CV", label: "Computer Vision" },
      { id: "cs.RO", label: "Robotics" },
      { id: "cs.CR", label: "Cryptography & Security" },
      { id: "cs.DC", label: "Distributed Computing" },
      { id: "cs.DS", label: "Data Structures & Algorithms" },
      { id: "cs.DB", label: "Databases" },
      { id: "cs.SE", label: "Software Engineering" },
      { id: "cs.HC", label: "Human-Computer Interaction" },
      { id: "cs.IR", label: "Information Retrieval" },
      { id: "cs.NE", label: "Neural & Evolutionary Computing" },
      { id: "cs.GT", label: "CS & Game Theory" },
      { id: "cs.SI", label: "Social & Information Networks" },
      { id: "cs.IT", label: "Information Theory" },
    ],
  },
  {
    label: "Statistics",
    categories: [
      { id: "stat.ML", label: "Machine Learning (Stats)" },
      { id: "stat.ME", label: "Methodology" },
      { id: "stat.TH", label: "Statistics Theory" },
      { id: "stat.AP", label: "Applied Statistics" },
      { id: "stat.CO", label: "Computation" },
    ],
  },
  {
    label: "Mathematics",
    categories: [
      { id: "math.PR", label: "Probability" },
      { id: "math.OC", label: "Optimization & Control" },
      { id: "math.NA", label: "Numerical Analysis" },
      { id: "math.ST", label: "Statistics Theory (Math)" },
      { id: "math.CO", label: "Combinatorics" },
      { id: "math.AG", label: "Algebraic Geometry" },
      { id: "math.NT", label: "Number Theory" },
      { id: "math.AP", label: "Analysis of PDEs" },
      { id: "math.DG", label: "Differential Geometry" },
      { id: "math.LO", label: "Logic" },
    ],
  },
  {
    label: "Physics",
    categories: [
      { id: "quant-ph", label: "Quantum Physics" },
      { id: "cond-mat.str-el", label: "Strongly Correlated Electrons" },
      { id: "cond-mat.mtrl-sci", label: "Materials Science" },
      { id: "cond-mat.stat-mech", label: "Statistical Mechanics" },
      { id: "hep-th", label: "High Energy Physics — Theory" },
      { id: "hep-ph", label: "High Energy Physics — Phenomenology" },
      { id: "hep-ex", label: "High Energy Physics — Experiment" },
      { id: "gr-qc", label: "General Relativity & Quantum Cosmology" },
      { id: "astro-ph.GA", label: "Astrophysics of Galaxies" },
      { id: "astro-ph.CO", label: "Cosmology" },
      { id: "astro-ph.HE", label: "High Energy Astrophysics" },
      { id: "astro-ph.EP", label: "Earth & Planetary Astrophysics" },
      { id: "physics.optics", label: "Optics" },
      { id: "physics.bio-ph", label: "Biological Physics" },
      { id: "physics.chem-ph", label: "Chemical Physics" },
      { id: "physics.ao-ph", label: "Atmospheric & Oceanic Physics" },
      { id: "nucl-th", label: "Nuclear Theory" },
      { id: "math-ph", label: "Mathematical Physics" },
    ],
  },
  {
    label: "Electrical Engineering & Systems",
    categories: [
      { id: "eess.SP", label: "Signal Processing" },
      { id: "eess.IV", label: "Image & Video Processing" },
      { id: "eess.AS", label: "Audio & Speech Processing" },
      { id: "eess.SY", label: "Systems & Control" },
    ],
  },
  {
    label: "Quantitative Biology",
    categories: [
      { id: "q-bio.NC", label: "Neurons & Cognition" },
      { id: "q-bio.QM", label: "Quantitative Methods" },
      { id: "q-bio.GN", label: "Genomics" },
      { id: "q-bio.BM", label: "Biomolecules" },
      { id: "q-bio.PE", label: "Populations & Evolution" },
    ],
  },
  {
    label: "Economics & Finance",
    categories: [
      { id: "econ.EM", label: "Econometrics" },
      { id: "econ.TH", label: "Economic Theory" },
      { id: "econ.GN", label: "General Economics" },
      { id: "q-fin.ST", label: "Statistical Finance" },
      { id: "q-fin.PM", label: "Portfolio Management" },
      { id: "q-fin.RM", label: "Risk Management" },
    ],
  },
];

const LABEL_BY_ID = new Map<string, string>(
  CATEGORY_GROUPS.flatMap((group) =>
    group.categories.map(({ id, label }) => [id, label] as const),
  ),
);

/** Human label for a category id; falls back to the raw id for codes outside the curated set. */
export function categoryLabel(id: string): string {
  return LABEL_BY_ID.get(id) ?? id;
}

export function isKnownCategory(id: string): boolean {
  return LABEL_BY_ID.has(id);
}

/** Valid arXiv category token, e.g. "cs.LG", "quant-ph", "cond-mat.str-el". */
const CATEGORY_TOKEN = /^[a-z-]+(\.[A-Za-z-]+)?$/;

export function sanitizeCategoryTokens(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token.length > 0 && token.length <= 32 && CATEGORY_TOKEN.test(token)),
    ),
  );
}
