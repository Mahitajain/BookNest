import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Book } from "../data/books";
import { useResolvedCover } from "../hooks/useResolvedCover";
import {
  COVER_W,
  bookDepthOf,
  faceFont,
  finishSheen,
  finishTexture,
  type SpineRect,
} from "./bookFaces";
import {
  BOOK_CONFIG,
  inkFor,
  inkShadowFor,
  leanOf,
  SPINE_AMBIENT,
  SPINE_CURVATURE,
  SPINE_EDGES,
  spineHeightOf,
  spineTextBudget,
  spineWidthOf,
  truncateForSpine,
} from "./bookGeometry";

const SPINE_PALETTE_CACHE = new Map<string, { spine: string; band?: string; ink: string }>();

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  if (value.length !== 6) return 0.5;
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function pickAccentColor(data: Uint8ClampedArray, width: number, height: number): string {
  let best: { r: number; g: number; b: number; score: number } | null = null;
  const edgeStart = Math.max(0, Math.floor(width * 0.12));
  const edgeEnd = Math.max(edgeStart + 1, Math.floor(width * 0.76));

  for (let y = 0; y < height; y += 2) {
    for (let x = edgeStart; x < edgeEnd; x += 2) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (a < 128) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const score = sat * 1.8 + (1 - Math.abs(lum - 0.55)) * 0.65;
      if (!best || score > best.score) {
        best = { r, g, b, score };
      }
    }
  }

  if (!best) {
    return "#7c5f48";
  }
  return rgbToHex(best.r, best.g, best.b);
}

async function sampleSpinePaletteFromCover(book: Book, url: string): Promise<{ spine: string; band?: string; ink: string }> {
  const key = `${book.id}:${url}`;
  const cached = SPINE_PALETTE_CACHE.get(key);
  if (cached) return cached;

  const fallback = {
    spine: book.spine || "#2f2a27",
    band: book.band || "#7c5f48",
    ink: book.ink || (luminance(book.spine || "#2f2a27") > 0.52 ? "#1d1a17" : "#f7f1ea"),
  };

  if (typeof window === "undefined" || !url.startsWith("http")) {
    SPINE_PALETTE_CACHE.set(key, fallback);
    return fallback;
  }

  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image failed"));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      SPINE_PALETTE_CACHE.set(key, fallback);
      return fallback;
    }

    const width = Math.min(120, Math.max(40, img.naturalWidth || 120));
    const height = Math.max(1, img.naturalHeight || 160);
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);

    const data = ctx.getImageData(0, 0, width, height).data;
    const sampleWidth = Math.max(3, Math.floor(width * 0.08));
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < sampleWidth; x += 2) {
        const idx = (y * width + x) * 4;
        const a = data[idx + 3];
        if (a < 128) continue;
        r += data[idx];
        g += data[idx + 1];
        b += data[idx + 2];
        total += 1;
      }
    }

    const nextSpine = total > 0 ? rgbToHex(Math.round(r / total), Math.round(g / total), Math.round(b / total)) : fallback.spine;
    const accent = pickAccentColor(data, width, height);
    const nextInk = luminance(nextSpine) > 0.52 ? "#1d1a17" : "#f7f1ea";
    const result = {
      spine: nextSpine,
      band: accent,
      ink: nextInk,
    };
    SPINE_PALETTE_CACHE.set(key, result);
    return result;
  } catch {
    SPINE_PALETTE_CACHE.set(key, fallback);
    return fallback;
  }
}

type Props = {
  book: Book;
  index: number;
  rotateY?: number;
  justAdded?: boolean;
  onOpen: (index: number, rect: SpineRect) => void;
};

function bindingLabel(binding: Book["binding"]) {
  if (binding === "hardcover") return "Hardcover";
  if (binding === "mass") return "Mass market";
  return "Paperback";
}

export function BookSpine({ book, index, rotateY = 0, justAdded, onOpen }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const spineRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [card, setCard] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    bottom: number;
    width: number;
  } | null>(null);
  const [cardSize, setCardSize] = useState({ width: 220, height: 90 });
  const leaveTimer = useRef<number | null>(null);

  const { coverUrl, onCoverError } = useResolvedCover(book, { size: "M" });
  const [derivedPalette, setDerivedPalette] = useState<{ spine: string; band?: string; ink: string }>({
    spine: book.spine,
    band: book.band,
    ink: book.ink,
  });

  useEffect(() => {
    if (!coverUrl) return;

    let cancelled = false;
    sampleSpinePaletteFromCover(book, coverUrl).then((next) => {
      if (!cancelled) setDerivedPalette(next);
    });
    return () => {
      cancelled = true;
    };
  }, [book, coverUrl]);

  const palette = useMemo(
    () => ({
      spine: coverUrl ? derivedPalette.spine || book.spine : book.spine,
      band: coverUrl ? derivedPalette.band || book.band : book.band,
      ink: coverUrl ? derivedPalette.ink || book.ink : book.ink,
    }),
    [book.band, book.ink, book.spine, coverUrl, derivedPalette.band, derivedPalette.ink, derivedPalette.spine],
  );

  const spineWidth = spineWidthOf(book);
  const spineHeight = spineHeightOf(book);
  const lean = leanOf(book);
  const visualDepth = Math.max(26, Math.min(COVER_W, Math.round(bookDepthOf(book) * 1.6)));
  const ink = inkFor({ ...book, spine: palette.spine, band: palette.band, ink: palette.ink });
  const inkShadow = inkShadowFor(ink);
  const font = faceFont[book.face];

  const dense = spineWidth < 30;
  const titleSize = dense ? 9.5 : spineWidth < 42 ? 11 : 12;
  const title = truncateForSpine(book.title, spineTextBudget(spineHeight, titleSize));
  const showAuthor = spineWidth >= 40;
  const author = truncateForSpine(book.author, spineTextBudget(spineHeight, 9) - 4);

  const updateAnchor = () => {
    const target = spineRef.current || btnRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width });
  };

  const showHover = () => {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setHovered(true);
    setCard(true);
    requestAnimationFrame(updateAnchor);
  };

  const hideHover = () => {
    setHovered(false);
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setCard(false), 90);
  };

  useEffect(() => {
    return () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    };
  }, []);

  /**
   * The label follows the spine while the shelf scrolls. Previously this ran a
   * permanent rAF loop per hovered book; passive scroll + resize listeners give
   * the same result without burning a frame budget when nothing moves.
   */
  useEffect(() => {
    if (!card) return;
    const scroller = btnRef.current?.closest("[data-shelf-scroller]");
    updateAnchor();
    window.addEventListener("scroll", updateAnchor, { passive: true });
    window.addEventListener("resize", updateAnchor);
    scroller?.addEventListener("scroll", updateAnchor, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateAnchor);
      window.removeEventListener("resize", updateAnchor);
      scroller?.removeEventListener("scroll", updateAnchor);
    };
  }, [card]);

  useLayoutEffect(() => {
    if (!card || !cardRef.current) return;
    const measure = () => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect) setCardSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [card]);

  const padding = 16;
  const gap = 12;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const targetCenterX = anchor ? anchor.left + anchor.width / 2 : 0;
  const clampedCenterX = Math.max(
    cardSize.width / 2 + padding,
    Math.min(viewportWidth - cardSize.width / 2 - padding, targetCenterX),
  );
  const aboveTop = anchor ? anchor.top - gap - cardSize.height : 0;
  const placeBelow = aboveTop < padding;
  const desiredTop = anchor ? (placeBelow ? anchor.bottom + gap : aboveTop) : 0;
  const clampedTop = Math.max(
    padding,
    Math.min(viewportHeight - cardSize.height - padding, desiredTop),
  );

  const pull = hovered ? BOOK_CONFIG.hoverPull : 0;
  const lift = hovered ? BOOK_CONFIG.hoverLift : 0;
  const scale = hovered ? BOOK_CONFIG.hoverScale : 1;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`${book.title} by ${book.author}${book.year ? `, ${book.year}` : ""}`}
        onMouseEnter={showHover}
        onMouseLeave={hideHover}
        onFocus={showHover}
        onBlur={hideHover}
        onClick={() => {
          const rect = (spineRef.current || btnRef.current)?.getBoundingClientRect();
          if (!rect) return;
          onOpen(index, {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          });
        }}
        className={`book-spine relative h-full shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${justAdded ? "animate-shelve-in" : ""}`}
        style={{
          width: spineWidth,
          position: "relative",
          zIndex: hovered ? 60 : index + 10,
          transformStyle: "preserve-3d",
          ["--spine-w" as string]: `${spineWidth}px`,
          ["--ry" as string]: `${rotateY}deg`,
        }}
      >
        {/*
          Layer 1 — proximity. Driven entirely by CSS custom properties that the
          shelf's spring writes each frame. No transition here: the spring is
          already the smoothing, and stacking a transition on top would lag it.
        */}
        <span
          className="book-spine__field absolute inset-0 block"
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* Layer 2 — hover pull-out and resting lean. */}
          <span
            ref={spineRef}
            className="book-spine__body absolute inset-0 block"
            style={{
              transformStyle: "preserve-3d",
              willChange: hovered ? "transform" : "auto",
              transform: `rotateY(calc(var(--ry) + ${hovered ? BOOK_CONFIG.hoverRotate : 0}deg)) rotateZ(${hovered ? 0 : lean}deg) translateZ(${pull}px) translateY(${lift}px) scale(${scale})`,
              transition: "transform 620ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* ---- SPINE FACE ---- */}
            <span
              className="absolute inset-0 overflow-hidden"
              style={{
                borderRadius: "1px 2px 2px 1px",
                background: palette.spine,
                boxShadow: SPINE_EDGES,
              }}
            >
              {/*
                The spine is a vertical slice of the real cover. Centre-cropping a
                portrait cover into a 24-66px column yields the volume's actual
                palette, which is why a blue cover gets a blue spine without any
                per-frame pixel sampling.
              */}
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onError={onCoverError}
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  style={{
                    objectPosition: "50% 50%",
                    transform: "scale(1.08)",
                    filter: "blur(2.5px) saturate(1.22) contrast(1.04)",
                  }}
                />
              ) : null}

              {/* Convex curvature: dark edge -> highlight -> dark edge. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: SPINE_CURVATURE }}
              />
              {/* Shared vertical light: head lit, foot in the shelf's shadow. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: SPINE_AMBIENT }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 mix-blend-overlay"
                style={{ backgroundImage: finishTexture(book.finish) }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 mix-blend-soft-light"
                style={{ backgroundImage: finishSheen(book.finish) }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  opacity: Math.min(book.wear * 0.5, 0.14),
                  backgroundImage: finishTexture("matte"),
                }}
              />

              {palette.band ? (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-[14%] top-[6.5%] h-[2px]"
                    style={{ background: palette.band, opacity: 0.62 }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-[14%] bottom-[8.5%] h-[2px]"
                    style={{ background: palette.band, opacity: 0.62 }}
                  />
                </>
              ) : null}

              {/* Title — one column, clipped, never wrapped into unreadable ribbons. */}
              <span
                className={`book-spine__title absolute ${font} ${book.caps ? "uppercase" : ""}`}
                style={{
                  color: ink,
                  textShadow: inkShadow,
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  fontSize: titleSize,
                  letterSpacing: book.caps ? "0.14em" : "0.03em",
                  left: showAuthor ? "14%" : "50%",
                  translate: showAuthor ? "0" : "-50%",
                  top: "10%",
                  maxHeight: "72%",
                }}
              >
                {title}
              </span>

              {showAuthor ? (
                <span
                  className="book-spine__title absolute font-sans"
                  style={{
                    color: ink,
                    textShadow: inkShadow,
                    writingMode: "vertical-rl",
                    transform: "rotate(180deg)",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    opacity: 0.78,
                    right: "16%",
                    top: "12%",
                    maxHeight: "62%",
                  }}
                >
                  {author}
                </span>
              ) : null}

              {book.publisher && spineWidth >= 32 ? (
                <span
                  className="absolute inset-x-0 bottom-[3%] truncate px-[8%] text-center font-mono uppercase"
                  style={{
                    color: ink,
                    fontSize: 6.5,
                    letterSpacing: "0.12em",
                    opacity: 0.6,
                    textShadow: inkShadow,
                  }}
                >
                  {book.publisher.split(/[\s,]/)[0]}
                </span>
              ) : null}
            </span>

            {/*
              ---- FORE-EDGE / PAGE BLOCK ----
              The page block is the BACK face of the volume, sitting one full
              cover-width behind the spine. Head on it is completely occluded by
              the spine; it only ever reads as depth through the perspective.

              It used to live at `left: 100%` rotated 72deg, i.e. 18deg short of
              perpendicular — that slot belongs to the front cover, and the
              18deg of slack is what projected a cream strip beside every book.
            */}
            <span
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                transform: `translate3d(${hovered ? -2 : -1}px, 0, -${visualDepth}px)`,
                background:
                  "repeating-linear-gradient(90deg, #e8e0d1 0 1px, #d3c8b6 1px 2px, #ece5d8 2px 3px)",
                boxShadow: "inset 0 0 12px -4px rgba(40,28,18,0.5)",
                borderLeft: "1px solid rgba(32,22,18,0.18)",
              }}
            />

            {/*
              ---- FRONT COVER ----
              The side face at x = spine width, extending backward. At exactly
              90deg it is edge-on and invisible from the front; the shelf curve
              and the hover rotation are what bring a sliver of it into view.
            */}
            <span
              className="absolute top-0 left-full overflow-hidden transition-[opacity,transform] duration-500 ease-out"
              style={{
                width: visualDepth,
                height: "100%",
                transform: `translateZ(${hovered ? 10 : 2}px) rotateY(${hovered ? 86 : 82}deg)`,
                transformOrigin: "left center",
                backfaceVisibility: "hidden",
                borderRadius: "0 2px 2px 0",
                background: palette.spine,
                opacity: hovered ? 1 : 0.82,
                boxShadow:
                  "inset 0 0 0 1px rgba(0,0,0,0.14), 0 0 0 1px rgba(255,255,255,0.08), 6px 0 18px -16px rgba(17,10,7,0.5)",
              }}
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onError={onCoverError}
                  className="h-full w-full object-cover"
                />
              ) : (
                /* Deterministic fallback: never a random book, never a blank box. */
                <span
                  className="flex h-full w-full flex-col justify-between p-5"
                  style={{
                    color: ink,
                    background: `linear-gradient(160deg, ${palette.spine}, rgba(0,0,0,0.22)), ${palette.spine}`,
                  }}
                >
                  <span className="font-display text-[19px] italic leading-tight">
                    {book.title.replace(/\s*\([^)]*\)\s*$/, "")}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-80">
                    {book.author}
                  </span>
                </span>
              )}
            </span>

            {/*
              ---- HEAD OF THE BOOK ----
              A cover edge, not a page surface. 5px at 82deg projects under a
              pixel of itself, so it reads as board thickness rather than paper.
            */}
            <span
              aria-hidden="true"
              className="absolute left-0 top-0 origin-top"
              style={{
                width: "100%",
                height: 5,
                transform: "rotateX(82deg)",
                borderRadius: "1px 1px 0 0",
                background: `linear-gradient(180deg, color-mix(in srgb, ${palette.spine} 78%, black), ${palette.spine})`,
                boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
                borderTop: "1px solid rgba(255,255,255,0.18)",
              }}
            />

            {book.binding === "hardcover" ? (
              <span
                aria-hidden="true"
                className="absolute left-[10%] right-[10%] top-0 h-[3px]"
                style={{
                  background: `linear-gradient(90deg, ${palette.band || ink}, ${palette.spine})`,
                  transform: "translateZ(1px)",
                  opacity: 0.75,
                }}
              />
            ) : null}
          </span>
        </span>

        {/* Contact shadow: local and soft, where the book meets the plank. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-3px] bottom-[-4px] h-[8px]"
          style={{
            background:
              "radial-gradient(ellipse 52% 100% at 50% 0%, rgba(42,30,18,0.34), transparent 76%)",
            filter: "blur(2px)",
          }}
        />
      </button>

      {card && anchor
        ? createPortal(
            <aside
              onMouseEnter={showHover}
              onMouseLeave={hideHover}
              ref={cardRef}
              className="pointer-events-auto overflow-hidden rounded-[4px] border border-[#d9d0c6] bg-[#f5f0ea]/95 px-4 py-3 text-left shadow-[0_18px_35px_-18px_rgba(28,23,18,0.42)] backdrop-blur-[1px] transition-all duration-200 ease-out"
              style={{
                position: "fixed",
                zIndex: 100,
                width: "min(64vw, 248px)",
                maxWidth: 248,
                left: clampedCenterX,
                top: clampedTop,
                transform: "translateX(-50%)",
                opacity: hovered ? 1 : 0,
                boxShadow: "0 10px 24px -14px rgba(20, 20, 20, 0.42)",
              }}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-neutral-500">
                    {book.year || "—"} · {bindingLabel(book.binding).toLowerCase()}
                  </p>
                </div>

                <h3 className="max-w-full font-display text-[21px] italic leading-[0.95] text-[#2f2a28]">
                  {book.title}
                </h3>

                <p className="font-sans text-[14px] leading-snug text-neutral-700">
                  {book.author}
                </p>

                <div className="flex flex-wrap gap-x-2 gap-y-1 pt-1 text-[12px] text-neutral-600">
                  {book.genres?.length ? (
                    <span className="font-sans uppercase tracking-[0.12em] text-neutral-500">
                      {book.genres.join(" / ")}
                    </span>
                  ) : null}
                  {book.publisher ? <span>· {book.publisher}</span> : null}
                </div>
              </div>
            </aside>,
            document.body,
          )
        : null}
    </>
  );
}
