/* eslint-disable react-hooks/set-state-in-effect */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { Book } from "../data/books";
import { useShelfInteraction } from "../hooks/useShelfInteraction";
import { spineHeightOf, spineWidthOf, BOOK_CONFIG, type SpineRect } from "./bookFaces";
import { BookDetail } from "./BookDetail";
import { BookSpine } from "./BookSpine";

type Props = {
  books: Book[];
  justAdded?: string;
  compact?: boolean;
};

/** A row narrower than this fraction of the viewport is centred instead of looped. */
const LOOP_MIN_FRACTION = 0.5;

export function Shelf({ books, justAdded, compact }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [angles, setAngles] = useState<number[]>([]);
  const [overflowing, setOverflowing] = useState(true);
  const [open, setOpen] = useState<{ index: number; rect: SpineRect } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [vp, setVp] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 0));
  const drag = useRef<{ x: number; sl: number; moved: boolean } | null>(null);

  const { measure } = useShelfInteraction({ scrollerRef, rowRef, sceneRef });

  /**
   * Tight packing: every book contributes its real rendered width minus the
   * seam overlap, so the row measurement matches what the browser lays out.
   */
  const totalWidth = useMemo(
    () =>
      books.reduce(
        (sum, book) => sum + spineWidthOf(book) - BOOK_CONFIG.seamOverlap,
        0,
      ),
    [books],
  );

  const loop = vp > 0 && totalWidth >= vp * LOOP_MIN_FRACTION;
  const copies = loop ? 3 : 1;
  const looped = useMemo(
    () => (copies === 1 ? books : [...books, ...books, ...books]),
    [books, copies],
  );

  const applyCurve = useCallback(() => {
    const scroller = scrollerRef.current;
    const row = rowRef.current;
    if (!scroller || !row) return;
    const kids = [...row.querySelectorAll<HTMLElement>("[data-spine]")];
    const mid = scroller.clientWidth / 2;
    const half = Math.max(scroller.clientWidth / 2, 1);
    const scrollLeft = scroller.scrollLeft;
    const next: number[] = [];
    // offsetLeft is layout-stable, so the whole curve costs no per-book reflow.
    for (const el of kids) {
      const cx = el.offsetLeft + el.offsetWidth / 2 - scrollLeft;
      const t = Math.max(-1, Math.min(1, (cx - mid) / half));
      next.push(Math.sign(t) * BOOK_CONFIG.shelfCurve * Math.abs(t) ** 1.35);
    }
    setAngles((current) => {
      if (
        current.length === next.length &&
        next.every((value, index) => Math.abs(value - (current[index] ?? 0)) < 0.05)
      ) {
        return current;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setOverflowing(loop);
  }, [loop]);

  useLayoutEffect(() => {
    measure();
  }, [measure, looped.length, vp]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const sync = () => {
      if (copies === 3) {
        const seg = scroller.scrollWidth / 3;
        if (scroller.scrollLeft < seg * 0.5) scroller.scrollLeft += seg;
        else if (scroller.scrollLeft > seg * 1.5) scroller.scrollLeft -= seg;
      }
      applyCurve();
    };
    if (copies === 3) {
      const firstW = spineWidthOf(books[0]) - BOOK_CONFIG.seamOverlap;
      scroller.scrollLeft = scroller.scrollWidth / 3 - firstW;
    }
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      scroller.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [applyCurve, books, copies, looped.length]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      setVp((current) => (current === scroller.clientWidth ? current : scroller.clientWidth));
      setOverflowing(loop || scroller.scrollWidth > scroller.clientWidth + 8);
      measure();
      applyCurve();
    });
    observer.observe(scroller);
    if (rowRef.current) observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [applyCurve, loop, measure, totalWidth]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      scroller.scrollLeft += e.deltaY;
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      e.preventDefault();
      scroller.scrollBy({ left: e.key === "ArrowLeft" ? -320 : 320, behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!justAdded) return;
    const scroller = scrollerRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[data-book-id="${CSS.escape(justAdded)}"]`,
    );
    target?.scrollIntoView({ inline: "center", block: "nearest" });
    setFlashId(justAdded);
    const timer = window.setTimeout(() => setFlashId(null), 1100);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  const skipClick = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, sl: scrollerRef.current?.scrollLeft ?? 0, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !scrollerRef.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    scrollerRef.current.scrollLeft = drag.current.sl - dx;
  };
  const endDrag = () => {
    if (drag.current?.moved) skipClick.current = true;
    drag.current = null;
    window.setTimeout(() => {
      skipClick.current = false;
    }, 0);
  };

  const openAt = (i: number, rect: SpineRect) => {
    if (skipClick.current) return;
    setOpen({ index: i % books.length, rect });
  };

  if (!books.length) {
    return (
      <div className="px-6 py-20 text-center">
        <p className="font-display text-2xl italic text-foreground/70">No volumes found.</p>
        <p className="mt-2 font-sans text-sm text-muted-foreground">
          Try clearing your search query or genre filter.
        </p>
      </div>
    );
  }

  return (
    <section className={compact ? "pb-2" : "pb-1"}>
      <div ref={sceneRef} className="bookshelf-scene relative">
        <div
          ref={scrollerRef}
          data-shelf-scroller
          className={`shelf-scroller no-scrollbar overflow-x-auto overflow-y-visible pt-[18px] pb-1 transition-[opacity,transform] duration-300 ease-out ${overflowing ? "" : "flex"}`}
          style={{ opacity: books.length ? 1 : 0.72, transform: "translateY(0)" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <div
            ref={rowRef}
            className={`relative flex items-end ${overflowing ? "w-max" : "mx-auto justify-center"}`}
            style={{ transformStyle: "preserve-3d" }}
          >
            {looped.map((book, i) => (
              <div
                key={`${book.id}-${i}`}
                data-spine
                data-book-id={book.id}
                className="book-slot relative shrink-0"
                style={{
                  transformStyle: "preserve-3d",
                  width: spineWidthOf(book),
                  height: spineHeightOf(book),
                  marginRight: -BOOK_CONFIG.seamOverlap,
                }}
              >
                <BookSpine
                  book={book}
                  index={i}
                  rotateY={angles[i] ?? 0}
                  justAdded={flashId === book.id}
                  onOpen={openAt}
                />
              </div>
            ))}
          </div>
        </div>

        {/* The plank: thick wooden shelf with a visible front edge and subtle side supports. */}
        <div aria-hidden="true" className="pointer-events-none relative z-[5] mt-[-2px]">
          <div
            className="relative h-[18px] w-full overflow-hidden rounded-b-[4px]"
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02) 12%, transparent 14%), linear-gradient(180deg, #d9ba8a 0%, #b9824f 28%, #8b5531 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.38), inset 0 -1px 0 rgba(42,27,18,0.32), 0 10px 18px -12px rgba(52,35,22,0.7)",
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-[8px]"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0.08))",
              }}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-[10px]"
              style={{
                background: "linear-gradient(180deg, rgba(74,46,28,0.18), rgba(47,29,17,0.38))",
              }}
            />
            <div
              className="absolute left-3 top-[7px] h-[18px] w-[18px] rounded-[8px_8px_10px_10px] border border-[#7e4d2a]/50 bg-[linear-gradient(135deg,#a15e32,#7a4322)] shadow-[inset_2px_2px_0_rgba(255,255,255,0.18)]"
              style={{ transform: "skewX(-12deg)" }}
            />
            <div
              className="absolute right-3 top-[7px] h-[18px] w-[18px] rounded-[8px_8px_10px_10px] border border-[#7e4d2a]/50 bg-[linear-gradient(135deg,#a15e32,#7a4322)] shadow-[inset_2px_2px_0_rgba(255,255,255,0.18)]"
              style={{ transform: "skewX(12deg)" }}
            />
          </div>
          <div className="mx-3 h-5 bg-[radial-gradient(ellipse_54%_100%_at_50%_0%,rgba(62,46,34,0.18),transparent_74%)] blur-[3px]" />
        </div>
      </div>

      {open ? (
        <BookDetail
          book={books[open.index]}
          books={books}
          rect={open.rect}
          onClose={() => setOpen(null)}
          onChange={(next) => setOpen((cur) => (cur ? { ...cur, index: next } : cur))}
        />
      ) : null}
    </section>
  );
}
