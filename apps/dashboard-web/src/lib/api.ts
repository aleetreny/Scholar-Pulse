import type {
  ControlResponse,
  FilterQuery,
  LatestPaper,
  MapQuery,
  MapResponse,
  PaperSheetResponse,
  SnapshotIndexResponse,
  WorkspaceQuery,
  WorkspaceResponse,
} from "@/lib/types";

const API_BASE = (
  process.env.NEXT_PUBLIC_DASHBOARD_API_URL ?? "http://127.0.0.1:8051/api"
).replace(/\/$/, "");

type ApiFetchOptions = {
  signal?: AbortSignal;
};

function buildQuery(query: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    search.set(key, String(value));
  });
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function fetchSnapshots(): Promise<SnapshotIndexResponse> {
  return apiFetch<SnapshotIndexResponse>("/snapshots");
}

export function fetchControls(
  snapshotId: string,
  options: ApiFetchOptions = {},
): Promise<ControlResponse> {
  return apiFetch<ControlResponse>(`/snapshots/${snapshotId}/controls`, options);
}


export function fetchMap(
  snapshotId: string,
  query: MapQuery,
  options: ApiFetchOptions = {},
): Promise<MapResponse> {
  const params = buildQuery({
    taxonomy: query.taxonomyTokens.join(","),
    year_min: query.yearRange?.[0],
    year_max: query.yearRange?.[1],
    search: query.search.trim(),
    x_min: query.viewport?.xMin,
    x_max: query.viewport?.xMax,
    y_min: query.viewport?.yMin,
    y_max: query.viewport?.yMax,
  });
  return apiFetch<MapResponse>(`/snapshots/${snapshotId}/map${params}`, options);
}


export function fetchLatest(
  snapshotId: string,
  query: FilterQuery,
  options: ApiFetchOptions = {},
): Promise<LatestPaper[]> {
  const params = buildQuery({
    taxonomy: query.taxonomyTokens.join(","),
    year_min: query.yearRange?.[0],
    year_max: query.yearRange?.[1],
    search: query.search.trim(),
  });
  return apiFetch<LatestPaper[]>(`/snapshots/${snapshotId}/latest${params}`, options);
}

export function fetchWorkspace(
  snapshotId: string,
  query: WorkspaceQuery,
  options: ApiFetchOptions = {},
): Promise<WorkspaceResponse> {
  const params = buildQuery({
    taxonomy: query.taxonomyTokens.join(","),
    year_min: query.yearRange?.[0],
    year_max: query.yearRange?.[1],
    search: query.search.trim(),
    x_min: query.viewport?.xMin,
    x_max: query.viewport?.xMax,
    y_min: query.viewport?.yMin,
    y_max: query.viewport?.yMax,
  });
  return apiFetch<WorkspaceResponse>(`/snapshots/${snapshotId}/workspace${params}`, options);
}

export function fetchPaperSheet(
  snapshotId: string,
  docId: string,
): Promise<PaperSheetResponse> {
  return apiFetch<PaperSheetResponse>(`/snapshots/${snapshotId}/papers/${docId}`);
}