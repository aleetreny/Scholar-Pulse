/**
 * Prefix for fetching this site's own static assets (feed snapshots).
 * GitHub Pages serves project sites under "/<repo>/", injected at build
 * time via next.config `env`.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
