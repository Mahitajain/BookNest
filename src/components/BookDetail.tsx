import { useEffect, useMemo, useState } from "react";
import type { Book } from "../data/books";
import { useResolvedCover } from "../hooks/useResolvedCover";
import { COVER_W, faceFont, type SpineRect } from "./bookFaces";

type Props = {
  book: Book;
  books: Book[];
  rect: SpineRect;
  onClose: () => void;
  onChange: (index: number) => void;
};

function Stars({ rating }: { rating: number }) {
  if (!rating) {
    return <span className="font-mono uppercase tracking-[0.16em] text-muted-foreground">Unrated</span>;
  }
  return (
    <span aria-label={`${rating} of 5`} className="tracking-[0.18em] text-primary">
      {"★".repeat(rating)}
      <span className="text-foreground/25">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export function BookDetail({ book, books, rect, onClose, onChange }: Props) {
  const [out, setOut] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  // The detail view wants the large edition of whatever the resolver settled on.
  const { coverUrl, onCoverError } = useResolvedCover(book, { size: "L" });

  useEffect(() => {
    const id = requestAnimationFrame(() => setOut(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const retract = () => {
    setLeaving(true);
    setOut(false);
    window.setTimeout(onClose, 620);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setLeaving(true);
        setOut(false);
        window.setTimeout(onClose, 620);
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const i = books.findIndex((b) => b.id === book.id);
        if (i < 0) return;
        const next =
          e.key === "ArrowLeft"
            ? (i - 1 + books.length) % books.length
            : (i + 1) % books.length;
        onChange(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book.id, books, onChange, onClose]);

  const pose = useMemo(() => {
    const narrow = vp.w < 720;
    const coverH = Math.min(vp.h * (narrow ? 0.42 : 0.6), 480);
    const scale = coverH / rect.height;
    const coverW = COVER_W * scale;
    const targetX = narrow ? (vp.w - coverW) / 2 : Math.max(32, vp.w * 0.18 - coverW * 0.15);
    const targetY = narrow ? vp.h * 0.12 : (vp.h - coverH) / 2;
    return {
      narrow,
      scale,
      coverW,
      coverH,
      dx: targetX - rect.left,
      dy: targetY - rect.top,
    };
  }, [rect, vp]);

  const i = books.findIndex((b) => b.id === book.id);
  const font = faceFont[book.face];

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close book"
        onClick={retract}
        className="absolute inset-0 border-0 bg-background/70 backdrop-blur-xl transition-opacity duration-[700ms]"
        style={{ opacity: out && !leaving ? 1 : 0 }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          transformStyle: "preserve-3d",
          transform: out
            ? `translate3d(${pose.dx}px, ${pose.dy}px, 0) scale(${pose.scale}) rotateY(-90deg)`
            : "translate3d(0,0,0) scale(1) rotateY(-26deg)",
          transition: "transform 900ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ background: book.spine }}
        />
        <div
          className="absolute top-0 left-full origin-left overflow-hidden shadow-[20px_30px_60px_-24px_rgba(40,28,16,0.55)]"
          style={{
            width: COVER_W,
            height: "100%",
            transform: "rotateY(90deg)",
            transformOrigin: "left center",
            background: book.spine,
          }}
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={`Cover of ${book.title}`}
              onError={onCoverError}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full flex-col justify-between p-5" style={{ color: book.ink }}>
              <p className={`text-lg leading-tight ${font}`}>{book.title}</p>
              <p className="font-sans text-xs opacity-80">{book.author}</p>
            </div>
          )}
        </div>
      </div>

      <aside
        className={`absolute z-10 max-w-[min(420px,calc(100%-2rem))] px-6 ${pose.narrow ? "inset-x-0 bottom-6 mx-auto text-center" : "right-[8%] top-1/2 w-[380px] -translate-y-1/2 text-left"}`}
        style={{
          opacity: out && !leaving ? 1 : 0,
          transform: out && !leaving ? "translateY(0)" : "translateY(14px)",
          transition: "opacity 700ms cubic-bezier(0.16, 1, 0.3, 1) 260ms, transform 700ms cubic-bezier(0.16, 1, 0.3, 1) 260ms",
        }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          {book.recommender ? `Recommended by ${book.recommender}` : book.finished ? `Finished ${book.finished}` : "On the shelf"}
        </p>
        <h2 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.7rem)] font-light leading-[1.12] text-foreground">
          {book.title}
        </h2>
        <p className="mt-2 font-sans text-lg text-foreground/75">{book.author}</p>
        {book.blurb ? (
          <p className="mt-5 font-sans text-[15px] leading-relaxed text-foreground/80">
            {book.blurb}
          </p>
        ) : null}
        <div className="mt-5 text-lg">
          <Stars rating={book.rating} />
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <button
            type="button"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/70 hover:text-foreground"
            onClick={() => onChange((i - 1 + books.length) % books.length)}
          >
            Previous
          </button>
          <span className="text-foreground/30">/</span>
          <button
            type="button"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/70 hover:text-foreground"
            onClick={() => onChange((i + 1) % books.length)}
          >
            Next
          </button>
          <span className="text-foreground/30">/</span>
          <button
            type="button"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary hover:text-foreground"
            onClick={retract}
          >
            Shelve it
          </button>
        </div>
      </aside>
    </div>
  );
}
