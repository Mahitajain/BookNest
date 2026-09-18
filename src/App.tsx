import { useState } from "react";
import { books, type Book } from "./data/books";
import { LibraryFilter } from "./components/LibraryFilter";
import { RecommendBookDialog } from "./components/RecommendBookDialog";
import { Shelf } from "./components/Shelf";
import { TypedTitle } from "./components/TypedTitle";
import { useRecommendations } from "./hooks/useRecommendations";

export default function App() {
  const [displayedBooks, setDisplayedBooks] = useState<Book[]>(books);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { recommendations, justAdded, recommend } = useRecommendations();

  return (
    <div className="flex min-h-svh flex-col overflow-x-hidden bg-background text-foreground">
      <TypedTitle volumeCount={books.length} showButton onRecommendClick={() => setIsDialogOpen(true)} />

      <div className="relative z-10 mt-4">
        <LibraryFilter books={books} onFilterChange={setDisplayedBooks} />
      </div>

      <main className="relative z-[1] mt-1">
        <Shelf books={displayedBooks} />

        {recommendations.length > 0 ? (
          <section className="mt-12 border-t border-border/60 pb-10 pt-8">
            <div className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-4 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Visitor contributions
              </p>
              <h2 className="mt-1 font-display text-xl italic text-foreground/85">
                Recommended to me
              </h2>
            </div>
            <Shelf books={recommendations} justAdded={justAdded} compact />
          </section>
        ) : null}
      </main>

      <RecommendBookDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onRecommend={recommend}
      />
    </div>
  );
}
