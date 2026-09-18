import { useEffect, useState } from "react";

const FULL = "Welcome to My Library";

type Props = {
  volumeCount?: number;
  showButton?: boolean;
  onRecommendClick?: () => void;
};

export function TypedTitle({ volumeCount, showButton = false, onRecommendClick }: Props) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (count >= FULL.length) return;
    const id = window.setTimeout(() => setCount((c) => c + 1), 95);
    return () => window.clearTimeout(id);
  }, [count]);

  const done = count >= FULL.length;

  return (
    <div className="flex flex-col items-center gap-2 pt-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.42em] text-foreground/60">Mahita's personal archive</p>
      <h1
        aria-label={FULL}
        className="px-6 text-center font-display text-[clamp(2.8rem,6vw,7rem)] font-light italic leading-[0.82] tracking-[-0.05em] text-foreground/80"
      >
        <span aria-hidden="true">{FULL.slice(0, count)}</span>
        <span
          aria-hidden="true"
          className={`ml-0.5 inline-block w-[0.08em] translate-y-[-0.01em] bg-foreground/70 ${done ? "animate-caret" : "opacity-90"}`}
          style={{ height: "0.82em" }}
        />
      </h1>
      {typeof volumeCount === "number" ? (
        <p
          className={`font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground/80 transition-opacity duration-700 ${done ? "opacity-100" : "opacity-0"}`}
        >
          {volumeCount} {volumeCount === 1 ? "volume" : "volumes"}
        </p>
      ) : null}
      {showButton ? (
        <button
          type="button"
          onClick={onRecommendClick}
          className="mt-2 rounded-full border border-foreground/25 bg-transparent px-5 py-2 font-mono text-[10px] uppercase tracking-[0.28em] text-foreground/70 transition-colors duration-200 hover:border-foreground/40 hover:text-foreground"
        >
          Recommend a book
        </button>
      ) : null}
    </div>
  );
}
