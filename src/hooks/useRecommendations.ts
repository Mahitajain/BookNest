import { useEffect, useState } from "react";
import type { Book } from "../data/books";
import { supabase } from "../lib/supabase";

function toBook(row: Record<string, unknown>): Book {
  return {
    id: String(row.id || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    title: String(row.title || "Untitled"),
    author: String(row.author || "Unknown Author"),
    genres: ["Recommendation"],
    cover: String(row.cover || ""),
    year: Number(row.year) || 0,
    blurb: String(row.note || ""),
    rating: 0,
    finished: row.recommender ? `Recommended by ${String(row.recommender)}` : "Recommended",
    recommender: String(row.recommender || "a visitor"),
    publisher: String(row.publisher || ""),
    binding: (row.binding as Book["binding"]) || "paperback",
    finish: (row.finish as Book["finish"]) || "matte",
    spine: String(row.spine || "#584f46"),
    band: typeof row.band === "string" ? row.band : undefined,
    ink: String(row.ink || "#faf7f0"),
    face: (row.face as Book["face"]) || "serif",
    caps: Boolean(row.caps),
    width: Number(row.width) || 30,
    height: Number(row.height) || 220,
    lean: Number(row.lean) || 0,
    depth: Number(row.depth) || 0,
    wear: Number(row.wear) || 0,
  };
}

export function useRecommendations() {
  const [recommendations, setRecommendations] = useState<Book[]>([]);
  const [justAdded, setJustAdded] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("recommendations")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);

        if (!error && data) {
          setRecommendations(data.map(toBook));
        }
      } catch {
        // Handle gracefully if Supabase table not created yet or network offline
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  async function recommend(input: {
    recommender: string;
    note?: string;
    book: Book;
  }): Promise<Book> {
    const recommenderClean = input.recommender.trim();
    if (!recommenderClean || recommenderClean.length > 60) {
      throw new Error("Name must be between 1 and 60 characters.");
    }
    const noteClean = (input.note || "").trim();
    if (noteClean.length > 500) {
      throw new Error("Note must be 500 characters or less.");
    }

    const payload = {
      recommender: recommenderClean,
      note: noteClean || null,
      title: input.book.title,
      author: input.book.author,
      cover: input.book.cover || "",
      year: input.book.year || 0,
      publisher: input.book.publisher || "",
      binding: input.book.binding,
      finish: input.book.finish,
      spine: input.book.spine,
      band: input.book.band || null,
      ink: input.book.ink,
      face: input.book.face,
      caps: input.book.caps || false,
      width: input.book.width,
      height: input.book.height,
      lean: input.book.lean,
      depth: input.book.depth,
      wear: input.book.wear,
    };

    let newBook: Book = {
      ...input.book,
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      blurb: noteClean,
      finished: `Recommended by ${recommenderClean}`,
      recommender: recommenderClean,
    };

    if (supabase) {
      const { data, error } = await supabase
        .from("recommendations")
        .insert([payload])
        .select();

      if (error) {
        throw new Error(error.message || "Failed to submit recommendation");
      }
      if (data && data[0]) {
        newBook = toBook(data[0]);
      }
    }

    setRecommendations((prev) => [newBook, ...prev]);
    setJustAdded(newBook.id);

    // Trigger justAdded animation for 1400ms
    setTimeout(() => {
      setJustAdded(undefined);
    }, 1400);

    return newBook;
  }

  return {
    recommendations,
    justAdded,
    loading,
    recommend,
  };
}
