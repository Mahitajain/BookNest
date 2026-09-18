import type { Book } from "../data/books";

export type SpineRect = { left: number; top: number; width: number; height: number };

/** Width of the front cover face, in px. Matches the -M Open Library cover. */
export const COVER_W = 178;

// Geometry now lives in one place. Re-exported so existing imports keep working.
export {
  BOOK_CONFIG,
  spineWidthOf,
  spineHeightOf,
  bookDepthOf,
  leanOf,
  inkFor,
  inkShadowFor,
  hashId,
  unitOf,
  clamp,
  SPINE_CURVATURE,
  SPINE_AMBIENT,
  SPINE_EDGES,
  spineTextBudget,
  truncateForSpine,
} from "./bookGeometry";

export const faceFont = {
  serif: "font-display",
  sans: "font-sans",
  mono: "font-mono",
} as const;

/**
 * Finish sheen. Applied *over* the convex gradient, so these stay subtle —
 * they modulate the shared light source rather than replacing it.
 */
export function finishSheen(finish: Book["finish"]): string {
  if (finish === "gloss") {
    return "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.16) 38%, rgba(255,255,255,0.02) 56%, rgba(0,0,0,0.10) 100%)";
  }
  if (finish === "cloth") {
    return "linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 42%, rgba(0,0,0,0.08) 100%)";
  }
  return "linear-gradient(90deg, rgba(255,255,255,0.04) 0%, transparent 46%, rgba(0,0,0,0.06) 100%)";
}

export function finishTexture(finish: Book["finish"]): string {
  if (finish === "cloth") {
    return "repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px), repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0 1px, transparent 1px 2px)";
  }
  if (finish === "gloss") {
    return "linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%, rgba(0,0,0,0.04))";
  }
  return "repeating-linear-gradient(180deg, rgba(255,255,255,0.015) 0 2px, transparent 2px 5px)";
}
