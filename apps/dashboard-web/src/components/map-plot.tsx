"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { Data, Layout } from "plotly.js";
import type { PlotParams } from "react-plotly.js";

import type { MapResponse, ViewportBounds } from "@/lib/types";

const Plot = dynamic<PlotParams>(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => <div className="plot-loading">Rendering map surface...</div>,
});

type PlotlyClickEvent = {
  points?: Array<{
    customdata?: unknown;
  }>;
};

type PlotlyRelayoutEvent = Record<string, unknown>;

type MapPlotProps = {
  snapshotId: string;
  map: MapResponse;
  viewport: ViewportBounds | null;
  onSelectPaper: (docId: string) => void;
  onViewportChange: (bounds: ViewportBounds | null) => void;
};

function getNumericValue(source: PlotlyRelayoutEvent, key: string): number | null {
  const value = source[key];
  return typeof value === "number" ? value : null;
}

function getDocIdFromClickEvent(event: PlotlyClickEvent): string | null {
  for (const point of event.points ?? []) {
    const customdata = point.customdata;
    if (Array.isArray(customdata) && typeof customdata[0] === "string") {
      return customdata[0];
    }
  }

  return null;
}

function getPaddedBounds(map: MapResponse): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} | null {
  const xValues = [
    ...map.density.map((row) => row.xCenter),
    ...map.sample.map((row) => row.x),
    ...map.detail.map((row) => row.x),
  ];
  const yValues = [
    ...map.density.map((row) => row.yCenter),
    ...map.sample.map((row) => row.y),
    ...map.detail.map((row) => row.y),
  ];

  if (xValues.length === 0 || yValues.length === 0) {
    return null;
  }

  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const xPadding = Math.max((xMax - xMin) * 0.06, 0.8);
  const yPadding = Math.max((yMax - yMin) * 0.1, 0.8);

  return {
    xMin: xMin - xPadding,
    xMax: xMax + xPadding,
    yMin: yMin - yPadding,
    yMax: yMax + yPadding,
  };
}

export function MapPlot({
  snapshotId,
  map,
  viewport,
  onSelectPaper,
  onViewportChange,
}: MapPlotProps) {
  const bounds = useMemo(() => getPaddedBounds(map), [map]);
  const hasSelectablePaperPoints = map.detail.length > 0 || map.sample.length > 0;

  const plotData = useMemo<Data[]>(() => {
    const traces: Data[] = [];

    if (map.density.length > 0) {
      traces.push({
        x: map.density.map((row) => row.xCenter),
        y: map.density.map((row) => row.yCenter),
        type: "scattergl",
        mode: "markers",
        marker: {
          size: map.density.map((row) => Math.min(22, Math.max(9, Math.pow(row.docCount, 0.24) * 4.2))),
          symbol: "square",
          opacity: 0.54,
          color: map.density.map((row) => row.docCount),
          colorscale: [
            [0, "#dfe6ff"],
            [0.45, "#93adff"],
            [0.78, "#4d73f8"],
            [1, "#18307b"],
          ],
          showscale: false,
        },
        ...(hasSelectablePaperPoints
          ? { hoverinfo: "skip" }
          : {
              customdata: map.density.map((row) => [row.docCount]),
              hovertemplate: "Density cluster<br>%{customdata[0]:,.0f} papers<extra></extra>",
            }),
      } as Data);
    }

    if (map.sample.length > 0) {
      traces.push({
        x: map.sample.map((row) => row.x),
        y: map.sample.map((row) => row.y),
        type: "scattergl",
        mode: "markers",
        customdata: map.sample.map((row) => [row.docId]),
        hoverinfo: "none",
        marker: {
          size: 6,
          opacity: 0.28,
          color: "#7486a7",
        },
      } as Data);
    }

    if (map.detail.length > 0) {
      traces.push({
        x: map.detail.map((row) => row.x),
        y: map.detail.map((row) => row.y),
        type: "scattergl",
        mode: "markers",
        customdata: map.detail.map((row) => [row.docId, row.paperId, row.title]),
        marker: {
          size: 7,
          opacity: 0.95,
          color: "#2f6bff",
        },
        hovertemplate: "%{customdata[2]}<br>%{customdata[1]}<extra></extra>",
      } as Data);
    }

    return traces;
  }, [hasSelectablePaperPoints, map.detail, map.density, map.sample]);

  const layout = useMemo<Partial<Layout>>(
    () => ({
      margin: { l: 0, r: 0, t: 0, b: 0 },
      dragmode: "pan",
      showlegend: false,
      hovermode: "closest",
      uirevision: snapshotId,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(248, 246, 240, 0.92)",
      font: {
        family: "var(--font-display)",
        color: "#12203b",
      },
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.96)",
        bordercolor: "rgba(83,103,142,0.18)",
        font: {
          family: "var(--font-display)",
          size: 12,
        },
      },
      xaxis: {
        showgrid: false,
        zeroline: false,
        showticklabels: false,
        range: viewport
          ? [viewport.xMin, viewport.xMax]
          : bounds
            ? [bounds.xMin, bounds.xMax]
            : undefined,
      },
      yaxis: {
        showgrid: false,
        zeroline: false,
        showticklabels: false,
        range: viewport
          ? [viewport.yMin, viewport.yMax]
          : bounds
            ? [bounds.yMin, bounds.yMax]
            : undefined,
      },
    }),
    [bounds, snapshotId, viewport],
  );

  function handleClick(event: unknown) {
    const clickEvent = event as PlotlyClickEvent;
    const docId = getDocIdFromClickEvent(clickEvent);
    if (!docId) {
      return;
    }
    onSelectPaper(docId);
  }

  function handleRelayout(event: Record<string, unknown>) {
    if (event["xaxis.autorange"] === true || event["yaxis.autorange"] === true) {
      onViewportChange(null);
      return;
    }

    const xMin = getNumericValue(event, "xaxis.range[0]");
    const xMax = getNumericValue(event, "xaxis.range[1]");
    const yMin = getNumericValue(event, "yaxis.range[0]");
    const yMax = getNumericValue(event, "yaxis.range[1]");

    if (xMin === null || xMax === null || yMin === null || yMax === null) {
      return;
    }

    onViewportChange({ xMin, xMax, yMin, yMax });
  }

  return (
    <div className="map-shell">
      <Plot
        data={plotData}
        layout={layout}
        config={{
          displaylogo: false,
          responsive: true,
          scrollZoom: true,
          modeBarButtonsToRemove: ["lasso2d", "select2d", "toggleSpikelines"],
        }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        onClick={handleClick}
        onRelayout={handleRelayout}
      />
    </div>
  );
}