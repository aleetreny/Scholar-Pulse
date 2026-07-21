"use client";

import katex from "katex";
import { memo, useMemo } from "react";

type Segment =
  | { kind: "text"; value: string }
  | { kind: "math"; html: string; raw: string };

/**
 * Split on $...$ / $$...$$ spans and render the math with KaTeX.
 * Anything KaTeX cannot parse falls back to the raw TeX source.
 */
function segmentize(source: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", value: source.slice(cursor, match.index) });
    }
    const tex = match[1] ?? match[2] ?? "";
    try {
      const html = katex.renderToString(tex, {
        throwOnError: true,
        displayMode: false,
        output: "html",
      });
      segments.push({ kind: "math", html, raw: match[0] });
    } catch {
      segments.push({ kind: "text", value: match[0] });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) {
    segments.push({ kind: "text", value: source.slice(cursor) });
  }
  return segments;
}

export const TexText = memo(function TexText({ text }: { text: string }) {
  const segments = useMemo(() => segmentize(text), [text]);

  if (segments.length === 1 && segments[0].kind === "text") {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <span
            key={index}
            aria-label={segment.raw}
            dangerouslySetInnerHTML={{ __html: segment.html }}
          />
        ),
      )}
    </>
  );
});
