export type SnapshotIndexResponse = {
  snapshots: string[];
  defaultSnapshotId: string | null;
};

export type TaxonomyOption = {
  label: string;
  value: string;
  description?: string;
  count?: number;
};

export type ControlResponse = {
  taxonomyOptions: TaxonomyOption[];
  yearMin: number;
  yearMax: number;
  yearValue: [number, number];
  yearMarks: Record<string, string>;
  snapshotPill: string;
  statusChip: string;
  metrics: {
    corpus: string;
    sample: string;
    latest: string;
    taxonomy: string;
    years: string;
  };
};

export type DensityCell = {
  binX: number;
  binY: number;
  docCount: number;
  xCenter: number;
  yCenter: number;
};

export type PreviewPoint = {
  docId: string;
  x: number;
  y: number;
};

export type MapPoint = {
  docId: string;
  paperId: string;
  paperVersionId: string;
  title: string;
  abstractPreview: string;
  submittedAt: string;
  year: number;
  categories: string[];
  x: number;
  y: number;
  binX: number;
  binY: number;
};

export type MapResponse = {
  density: DensityCell[];
  sample: PreviewPoint[];
  detail: MapPoint[];
  scopeHeadline: string;
  scopeCaption: string;
  visibleMetric: string;
  modeLabel: string;
  modeClass: string;
  modeNote: string;
};

export type LatestPaper = {
  docId: string;
  paperId: string;
  paperVersionId: string;
  title: string;
  submittedAt: string;
  year: number;
  categories: string[];
  categoriesText: string;
  recencyScore: number;
  noveltyScore: number;
  score: number;
};

export type FilterQuery = {
  taxonomyTokens: string[];
  yearRange: [number, number] | null;
  search: string;
};

export type MapQuery = FilterQuery & {
  viewport: ViewportBounds | null;
};

export type WorkspaceResponse = {
  snapshotId: string;
  controls: ControlResponse;
  map: MapResponse;
  latest: LatestPaper[];
};

export type PaperDetail = {
  docId: string;
  paperId: string;
  paperVersionId: string;
  title: string;
  abstractPreview: string;
  submittedAt: string;
  year: number;
  categories: string[];
};

export type PaperNeighbor = {
  docId: string;
  paperId: string;
  title: string;
  cosineSimilarity: number;
};

export type PaperSheetResponse = {
  paper: PaperDetail;
  neighbors: PaperNeighbor[];
  similarityError: string | null;
};

export type ViewportBounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type WorkspaceQuery = MapQuery;