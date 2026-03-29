"use client";

import { MapPlot } from "@/components/map-plot";
import type { MapResponse, ViewportBounds } from "@/lib/types";

type MapStageProps = {
  snapshotId: string;
  map: MapResponse;
  viewport: ViewportBounds | null;
  onSelectPaper: (docId: string) => void;
  onViewportChange: (bounds: ViewportBounds | null) => void;
};

export function MapStage({
  snapshotId,
  map,
  viewport,
  onSelectPaper,
  onViewportChange,
}: MapStageProps) {
  return (
    <section className="panel stage-card map-stage-card">
      <div className="stage-head">
        <div className="stage-title-group">
          <span className="eyebrow">Research map</span>
          <h2>Scholar Pulse map</h2>
        </div>
        <div className="stage-meta">
          <div className="view-pill neutral-pill">{map.visibleMetric} visible</div>
          <div className={`view-pill ${map.modeClass.replace("mode-chip ", "")}`}>{map.modeLabel}</div>
        </div>
      </div>

      <div className="map-canvas">
        <MapPlot
          snapshotId={snapshotId}
          map={map}
          viewport={viewport}
          onSelectPaper={onSelectPaper}
          onViewportChange={onViewportChange}
        />
      </div>
    </section>
  );
}