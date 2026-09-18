import type { Book } from "../data/books";

/**
 * Single source of truth for every tunable physical dimension on the shelf.
 * Nothing in the render path should hard-code a magic number that lives here.
 */
export const BOOK_CONFIG = {
  /** Rendered spine width range, in px. */
  minWidth: 24,
  maxWidth: 66,

  /** Rendered height range, in px. Source heights are clamped into this band. */
  minHeight: 196,
  maxHeight: 258,

  /** Physical thickness of the volume (the face you see when it rotates). */
  minDepth: 18,
  maxDepth: 34,

  /** Most books stay upright; a small deterministic minority lean. */
  maxLean: 1.1,
  maxLeanOutlier: 2.4,
  leanOutlierRate: 0.14,

  /** Cursor proximity field. */
  interactionRadius: 190,
  /** Max lateral displacement of a neighbour, px. */
  neighborPush: 7,
  /** Max forward displacement from proximity alone (before hover), px. */
  proximityDepth: 10,

  /**
   * How far the row's edge books turn away from the viewer. Small on purpose:
   * past ~10deg the front cover swings into view and the shelf stops reading
   * as a row of spines.
   */
  shelfCurve: 9,

  /** Hover pull-out. Kept deliberately small — a book, not a drawer. */
  hoverPull: 34,
  /** Degrees of turn on hover — enough to catch the cover edge, no more. */
  hoverRotate: 4,
  hoverLift: -5,
  hoverScale: 1.025,

  /** Books touch; a 1px overlap creates the seam. */
  seamOverlap: 1,

  /** Shelf parallax, degrees. */
  parallaxY: 1.1,
  parallaxX: 0.5,

  /** Spring used for proximity motion. Overdamped: fast, no bounce. */
  spring: { stiffness: 190, damping: 26, mass: 0.8 },
} as const;

/** Stable FNV-1a hash so every physical property is deterministic per book. */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 0..1 drawn from a hash, with a salt so properties decorrelate. */
export function unitOf(hash: number, salt: number): number {
  return ((hash >>> salt) & 0xffff) / 0xffff;
}

export function rangeOf(hash: number, salt: number, min: number, max: number): number {
  return min + unitOf(hash, salt) * (max - min);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Rendered spine width: source width scaled into the physical band, with stable jitter. */
export function spineWidthOf(book: Book): number {
  const h = hashId(book.id);
  const scaled = book.width * 1.34 + unitOf(h, 3) * 4 - 2;
  return clamp(scaled, BOOK_CONFIG.minWidth, BOOK_CONFIG.maxWidth);
}

/** Rendered height, clamped so a bad source record can't break the baseline. */
export function spineHeightOf(book: Book): number {
  return clamp(book.height, BOOK_CONFIG.minHeight, BOOK_CONFIG.maxHeight);
}

/**
 * Physical thickness. The source `depth` field is a small signed value
 * (-5..5) that was never a real thickness, so we derive one instead:
 * wider spines belong to thicker volumes, plus deterministic variation.
 */
export function bookDepthOf(book: Book): number {
  const h = hashId(book.id);
  const fromWidth =
    BOOK_CONFIG.minDepth +
    ((spineWidthOf(book) - BOOK_CONFIG.minWidth) /
      (BOOK_CONFIG.maxWidth - BOOK_CONFIG.minWidth)) *
      (BOOK_CONFIG.maxDepth - BOOK_CONFIG.minDepth) *
      0.7;
  return clamp(fromWidth + unitOf(h, 7) * 8 - 4, BOOK_CONFIG.minDepth, BOOK_CONFIG.maxDepth);
}

/**
 * Lean. Source data carries leans up to ±5deg, which reads as a collapsed
 * shelf rather than a real one. Most books stand upright; a deterministic
 * minority tilt, and the sign follows the source so the silhouette is familiar.
 */
export function leanOf(book: Book): number {
  const h = hashId(book.id);
  const outlier = unitOf(h, 11) < BOOK_CONFIG.leanOutlierRate;
  const limit = outlier ? BOOK_CONFIG.maxLeanOutlier : BOOK_CONFIG.maxLean;
  // Squared so the distribution clusters near upright: a handful of books
  // tilt, the rest read as vertical.
  const u = unitOf(h, 5);
  const magnitude = u * u * limit;
  // The source `lean` field is negative for nearly every record, which tips the
  // whole shelf one way. Take the sign from the hash instead.
  const sign = unitOf(h, 13) > 0.5 ? 1 : -1;
  return Number((magnitude * sign).toFixed(2));
}

/**
 * Convex spine shading. One shared light source, slightly left of centre:
 * dark edge -> base -> highlight -> base -> dark edge. This — not
 * border-radius — is what reads as a curved spine.
 */
export const SPINE_CURVATURE =
  "linear-gradient(90deg," +
  "rgba(0,0,0,0.46) 0%," +
  "rgba(0,0,0,0.22) 5%," +
  "rgba(0,0,0,0.05) 15%," +
  "rgba(255,255,255,0.07) 32%," +
  "rgba(255,255,255,0.15) 44%," +
  "rgba(255,255,255,0.05) 60%," +
  "rgba(0,0,0,0.10) 78%," +
  "rgba(0,0,0,0.30) 93%," +
  "rgba(0,0,0,0.50) 100%)";

/** Vertical falloff: shelf shadow near the foot, ambient light near the head. */
export const SPINE_AMBIENT =
  "linear-gradient(180deg," +
  "rgba(255,255,255,0.10) 0%," +
  "rgba(255,255,255,0.02) 12%," +
  "rgba(0,0,0,0) 62%," +
  "rgba(0,0,0,0.16) 88%," +
  "rgba(0,0,0,0.30) 100%)";

/** Bevelled vertical edges + the dark seam that separates touching books. */
export const SPINE_EDGES =
  "inset 1px 0 0 rgba(255,255,255,0.16)," +
  "inset -1px 0 0 rgba(0,0,0,0.30)," +
  "inset 3px 0 5px -3px rgba(0,0,0,0.55)," +
  "inset -3px 0 5px -3px rgba(0,0,0,0.60)," +
  "inset 0 1px 0 rgba(255,255,255,0.14)";

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rrggbb / #rgb colour. Returns 0..1. */
export function luminanceOf(hex: string): number {
  let value = hex.replace("#", "").trim();
  if (value.length === 3) value = value.split("").map((c) => c + c).join("");
  if (value.length !== 6) return 0.5;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if (Number.isNaN(r + g + b)) return 0.5;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * The spine background is now the real cover art, so the ink colour recorded
 * in the data can end up low-contrast. Keep it when it reads, otherwise fall
 * back to the high-contrast pole.
 */
export function inkFor(book: Book): string {
  const spineLum = luminanceOf(book.spine);
  const inkLum = luminanceOf(book.ink);
  const contrast =
    (Math.max(spineLum, inkLum) + 0.05) / (Math.min(spineLum, inkLum) + 0.05);
  if (contrast >= 3.4) return book.ink;
  return spineLum > 0.34 ? "#1c1814" : "#f6f2e9";
}

/** Text shadow tuned to the ink polarity so titles survive busy cover art. */
export function inkShadowFor(ink: string): string {
  return luminanceOf(ink) > 0.4
    ? "0 1px 2px rgba(0,0,0,0.55), 0 0 6px rgba(0,0,0,0.35)"
    : "0 1px 1px rgba(255,255,255,0.35)";
}

/**
 * Spine text budget: how many characters fit before we must truncate.
 * Roughly (height available) / (font advance), tuned against the reference.
 */
export function spineTextBudget(height: number, fontSize: number): number {
  return Math.max(8, Math.floor((height * 0.7) / (fontSize * 0.62)));
}

export function truncateForSpine(text: string, budget: number): string {
  const clean = text.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (clean.length <= budget) return clean;
  return `${clean.slice(0, Math.max(1, budget - 1)).trimEnd()}…`;
}
