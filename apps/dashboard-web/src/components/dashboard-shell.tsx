"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

import { ControlRail } from "@/components/control-rail";
import { MapStage } from "@/components/map-stage";
import { PaperRail } from "@/components/paper-rail";
import {
  fetchControls,
  fetchLatest,
  fetchMap,
  fetchPaperSheet,
  fetchSnapshots,
} from "@/lib/api";
import type {
  ControlResponse,
  LatestPaper,
  MapResponse,
  PaperSheetResponse,
  ViewportBounds,
} from "@/lib/types";

const FALLBACK_YEAR_RANGE: [number, number] = [1991, 2026];
const VIEWPORT_DEBOUNCE_MS = 180;

function viewportEquals(
  left: ViewportBounds | null,
  right: ViewportBounds | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return (
    left.xMin === right.xMin
    && left.xMax === right.xMax
    && left.yMin === right.yMin
    && left.yMax === right.yMax
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function DashboardShell() {
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [controls, setControls] = useState<ControlResponse | null>(null);
  const [map, setMap] = useState<MapResponse | null>(null);
  const [latestPapers, setLatestPapers] = useState<LatestPaper[]>([]);
  const [paperSheet, setPaperSheet] = useState<PaperSheetResponse | null>(null);
  const [taxonomyTokens, setTaxonomyTokens] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);
  const [pendingViewport, setPendingViewport] = useState<ViewportBounds | null>(null);
  const [viewport, setViewport] = useState<ViewportBounds | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [latestLoading, setLatestLoading] = useState(false);
  const [paperLoading, setPaperLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  function primeMapRefresh() {
    setMapLoading(true);
    setError(null);
  }

  function primeFilterRefresh() {
    setMapLoading(true);
    setLatestLoading(true);
    setError(null);
  }

  useEffect(() => {
    let active = true;

    fetchSnapshots()
      .then((response) => {
        if (!active) {
          return;
        }
        const defaultSnapshotId = response.defaultSnapshotId ?? response.snapshots[0] ?? null;
        if (defaultSnapshotId) {
          setMapLoading(true);
          setLatestLoading(true);
          setSnapshotId(defaultSnapshotId);
          return;
        }
        setError("No published snapshot is available.");
      })
      .catch((fetchError: unknown) => {
        if (!active) {
          return;
        }
        const message = fetchError instanceof Error ? fetchError.message : "Unable to load snapshots.";
        setError(message);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!snapshotId) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    fetchControls(snapshotId, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setControls(response);
      })
      .catch((fetchError: unknown) => {
        if (!active || isAbortError(fetchError)) {
          return;
        }
        const message = fetchError instanceof Error ? fetchError.message : "Unable to load controls.";
        setError(message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [snapshotId]);

  useEffect(() => {
    if (!snapshotId) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    fetchMap(snapshotId, {
      taxonomyTokens,
      yearRange,
      search: deferredSearch,
      viewport,
    }, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setMap(response);
      })
      .catch((fetchError: unknown) => {
        if (!active || isAbortError(fetchError)) {
          return;
        }
        const message = fetchError instanceof Error ? fetchError.message : "Unable to refresh map.";
        setError(message);
      })
      .finally(() => {
        if (active && !controller.signal.aborted) {
          setMapLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [deferredSearch, snapshotId, taxonomyTokens, viewport, yearRange]);

  useEffect(() => {
    if (!snapshotId) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    fetchLatest(snapshotId, {
      taxonomyTokens,
      yearRange,
      search: deferredSearch,
    }, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setLatestPapers(response);
      })
      .catch((fetchError: unknown) => {
        if (!active || isAbortError(fetchError)) {
          return;
        }
        const message = fetchError instanceof Error ? fetchError.message : "Unable to refresh shortlist.";
        setError(message);
      })
      .finally(() => {
        if (active && !controller.signal.aborted) {
          setLatestLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [deferredSearch, snapshotId, taxonomyTokens, yearRange]);

  useEffect(() => {
    if (viewportEquals(pendingViewport, viewport)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      primeMapRefresh();
      startTransition(() => {
        setViewport(pendingViewport);
      });
    }, VIEWPORT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pendingViewport, viewport]);

  const activeViewport = pendingViewport ?? viewport;

  const effectiveYearRange = useMemo<[number, number]>(
    () => yearRange ?? controls?.yearValue ?? FALLBACK_YEAR_RANGE,
    [controls?.yearValue, yearRange],
  );

  function handleToggleTaxonomy(token: string) {
    primeFilterRefresh();
    startTransition(() => {
      setTaxonomyTokens((current) =>
        current.includes(token)
          ? current.filter((value) => value !== token)
          : [...current, token],
      );
      setPendingViewport(null);
      setViewport(null);
    });
  }

  function handleClearTaxonomy() {
    primeFilterRefresh();
    startTransition(() => {
      setTaxonomyTokens([]);
      setPendingViewport(null);
      setViewport(null);
    });
  }

  function handleYearRangeChange(nextRange: [number, number]) {
    primeFilterRefresh();
    startTransition(() => {
      setYearRange(nextRange);
      setPendingViewport(null);
      setViewport(null);
    });
  }

  function handleViewportChange(nextBounds: ViewportBounds | null) {
    if (viewportEquals(nextBounds, pendingViewport)) {
      return;
    }

    setError(null);
    setPendingViewport(nextBounds);
  }

  function handleSearchChange(nextSearch: string) {
    primeFilterRefresh();
    setSearch(nextSearch);
  }

  function handleSelectPaper(docId: string) {
    if (!snapshotId) {
      return;
    }

    setPaperLoading(true);
    fetchPaperSheet(snapshotId, docId)
      .then((response) => {
        setPaperSheet(response);
      })
      .catch((fetchError: unknown) => {
        const message = fetchError instanceof Error ? fetchError.message : "Unable to load paper sheet.";
        setError(message);
      })
      .finally(() => {
        setPaperLoading(false);
      });
  }

  return (
    <div className="studio-shell">
      <div className="studio-grid">
        <main className="map-column">
          {error ? <div className="error-banner">{error}</div> : null}

          {map && snapshotId ? (
            <MapStage
              snapshotId={snapshotId}
              map={map}
              viewport={activeViewport}
              onSelectPaper={handleSelectPaper}
              onViewportChange={handleViewportChange}
            />
          ) : (
            <section className="panel empty-stage">
              <span className="eyebrow">Scholar Pulse</span>
              <h2>Loading the published research map.</h2>
              <p>
                The interface will populate as soon as the API returns the corpus,
                filters, and visible paper layers.
              </p>
            </section>
          )}
        </main>

        <div className="sidebar-stack">
          <ControlRail
            controls={controls}
            taxonomyTokens={taxonomyTokens}
            search={search}
            yearRange={effectiveYearRange}
            isBusy={mapLoading}
            onToggleTaxonomy={handleToggleTaxonomy}
            onClearTaxonomy={handleClearTaxonomy}
            onSearchChange={handleSearchChange}
            onYearRangeChange={handleYearRangeChange}
          />

          <PaperRail
            paperSheet={paperSheet}
            latestPapers={latestPapers}
            isLoading={paperLoading}
            isLatestLoading={latestLoading}
            onSelectPaper={handleSelectPaper}
          />
        </div>
      </div>
    </div>
  );
}