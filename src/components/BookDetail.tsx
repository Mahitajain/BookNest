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

function renderBlurbText(text: string) {
  if (!text) return null;

  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  const parts: Array<string | { type: "link"; label: string; url: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [fullMatch, label, url] = match;

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const cleanLabel = label.trim();
    const cleanUrl = url.trim();

    if (cleanLabel && cleanUrl) {
      parts.push({ type: "link", label: cleanLabel, url: cleanUrl });
    } else {
      parts.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.map((part, index) => {
    if (typeof part === "string") {
      return (
        <span key={`book-text-${index}`} className="break-words whitespace-pre-wrap">
          {part}
        </span>
      );
    }

    return (
      <a
        key={`book-link-${index}`}
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline break-words rounded-sm text-foreground/80 underline decoration-[rgba(120,110,125,0.45)] decoration-1 underline-offset-2 transition-colors duration-200 hover:text-foreground hover:decoration-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {part.label}
      </a>
    );
  });
}

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

  const font = faceFont[book.face];

  if (pose.narrow) {
    return (
      <div className="fixed inset-0 z-50 overflow-x-hidden overflow-y-auto bg-background text-foreground">
        <div
          className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center px-5 pb-10 pt-4 text-center sm:px-8 sm:pt-6"
          style={{
            opacity: out && !leaving ? 1 : 0,
            transform: out && !leaving ? "translateY(0)" : "translateY(14px)",
            transition: "opacity 700ms cubic-bezier(0.16, 1, 0.3, 1), transform 700ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <button
            type="button"
            onClick={retract}
            className="mb-5 min-h-11 self-start px-2 text-left font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mb-7"
          >
            ← Back to Shelf
          </button>

          <div className="w-[clamp(65vw,70vw,78vw)] max-w-[420px] shrink-0 overflow-hidden shadow-[20px_30px_60px_-24px_rgba(40,28,16,0.55)]">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={`Cover of ${book.title}`}
                onError={onCoverError}
                className="block aspect-[2/3] h-auto w-full object-cover"
              />
            ) : (
              <div
                className="flex aspect-[2/3] w-full flex-col justify-between p-5 text-left"
                style={{ color: book.ink, background: book.spine }}
              >
                <p className={`text-lg leading-tight ${font}`}>{book.title}</p>
                <p className="font-sans text-xs opacity-80">{book.author}</p>
              </div>
            )}
          </div>

          <div className="mt-7 w-full max-w-[650px] min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              {book.recommender ? `Recommended by ${book.recommender}` : book.finished ? `Finished ${book.finished}` : "On the shelf"}
            </p>
            <h2 className="mt-3 break-words font-display text-[clamp(1.8rem,8vw,2.7rem)] font-light leading-[1.12] text-foreground">
              {book.title}
            </h2>
            <p className="mt-2 break-words font-sans text-lg leading-relaxed text-foreground/75">{book.author}</p>

            {book.blurb ? (
              <div className="mx-auto mt-7 w-[min(90%,650px)] min-w-0 font-sans text-[15px] leading-[1.7] text-foreground/80 [&_a]:inline [&_a]:break-words [&_a]:rounded-sm [&_a]:text-foreground/80 [&_a]:underline [&_a]:decoration-[rgba(120,110,125,0.45)] [&_a]:decoration-1 [&_a]:underline-offset-2 [&_a]:transition-colors [&_a]:duration-200 hover:[&_a]:text-foreground hover:[&_a]:decoration-foreground/60 focus-visible:[&_a]:outline-none focus-visible:[&_a]:ring-2 focus-visible:[&_a]:ring-primary/40">
                <p className="overflow-wrap-anywhere break-words whitespace-pre-wrap">{renderBlurbText(book.blurb)}</p>
              </div>
            ) : null}

            <div className="mt-8 text-lg">
              <Stars rating={book.rating} />
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 pb-2">
              <button
                type="button"
                className="min-h-11 px-1 font-mono text-[11px] uppercase tracking-[0.18em] text-primary transition-colors hover:text-foreground"
                onClick={retract}
              >
                Shelve it
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
        <button
          type="button"
          onClick={retract}
          className="mb-5 min-h-11 px-0 text-left font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Back to Shelf
        </button>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          {book.recommender ? `Recommended by ${book.recommender}` : book.finished ? `Finished ${book.finished}` : "On the shelf"}
        </p>
        <h2 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.7rem)] font-light leading-[1.12] text-foreground">
          {book.title}
        </h2>
        <p className="mt-2 font-sans text-lg text-foreground/75">{book.author}</p>
        {book.blurb ? (
          <div className="mt-5 font-sans text-[15px] leading-relaxed text-foreground/80 [&_a]:inline [&_a]:break-words [&_a]:rounded-sm [&_a]:text-foreground/80 [&_a]:underline [&_a]:decoration-[rgba(120,110,125,0.45)] [&_a]:decoration-1 [&_a]:underline-offset-2 [&_a]:transition-colors [&_a]:duration-200 hover:[&_a]:text-foreground hover:[&_a]:decoration-foreground/60 focus-visible:[&_a]:outline-none focus-visible:[&_a]:ring-2 focus-visible:[&_a]:ring-primary/40">
            <p className="overflow-wrap-anywhere break-words whitespace-pre-wrap">{renderBlurbText(book.blurb)}</p>
          </div>
        ) : null}
        <div className="mt-5 text-lg">
          <Stars rating={book.rating} />
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
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
