declare module "react-plotly.js" {
  import type { CSSProperties, ComponentType } from "react";
  import type { Config, Data, Layout } from "plotly.js";

  export type PlotParams = {
    data: Data[];
    layout?: Partial<Layout>;
    config?: Partial<Config>;
    frames?: object[];
    style?: CSSProperties;
    className?: string;
    useResizeHandler?: boolean;
    onClick?: (event: unknown) => void;
    onRelayout?: (event: Record<string, unknown>) => void;
  };

  const Plot: ComponentType<PlotParams>;
  export default Plot;
}