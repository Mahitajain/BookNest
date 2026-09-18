import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

type BookItem = {
  id: string;
  title: string;
  author: string;
  year: number;
  genres?: string[];
  blurb?: string;
};

function getBooksList(): BookItem[] {
  try {
    const booksPath = join(import.meta.dirname, "src", "data", "books.ts");
    const content = readFileSync(booksPath, "utf-8");
    const jsonMatch = content.match(/export const books: Book\[\] = (\[[\s\S]*?\]);/);
    if (jsonMatch && jsonMatch[1]) {
      // Evaluate or parse array
      return Function(`"use strict"; return (${jsonMatch[1]})`)() as BookItem[];
    }
  } catch {
    // fallback empty
  }
  return [];
}

function searchApiPlugin(): Plugin {
  return {
    name: "search-api-plugin",
    configureServer(server) {
      server.middlewares.use("/api/search", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method Not Allowed" }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const { query } = JSON.parse(body || "{}");
            if (!query || typeof query !== "string") {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ids: [] }));
              return;
            }

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ fallback: true }));
              return;
            }

            const books = getBooksList();
            const catalogLines = books.map((b: BookItem) => {
              const blurbTruncated = (b.blurb || "").replace(/\s+/g, " ").slice(0, 160);
              const genresStr = (b.genres || []).join(", ");
              return `${b.id} :: ${b.title} :: ${b.author} :: ${b.year} :: ${genresStr} :: ${blurbTruncated}`;
            });

            const catalogText = catalogLines.join("\n");

            const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a library catalog search engine. Given a list of books in the format 'id :: title :: author :: year :: genres :: blurb', match the user's natural-language query to the catalog. Return ONLY a JSON object with a single key 'ids' containing an array of at most 20 matching book IDs, best matches first. Example: {\"ids\":[\"id1\",\"id2\"]}. If no books match, return {\"ids\":[]}. Do not include markdown formatting or extra text.",
                  },
                  {
                    role: "user",
                    content: `Search query: ${query}\n\nCatalog:\n${catalogText}`,
                  },
                ],
                response_format: { type: "json_object" },
              }),
            });

            if (!aiRes.ok) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ fallback: true }));
              return;
            }

            const aiData = (await aiRes.json()) as {
              choices?: { message?: { content?: string } }[];
            };
            const content = aiData.choices?.[0]?.message?.content || "{}";
            const parsed = JSON.parse(content);
            const returnedIds: string[] = Array.isArray(parsed.ids) ? parsed.ids : [];

            const validSet = new Set(books.map((b: BookItem) => b.id));
            const validIds = returnedIds.filter((id) => validSet.has(id)).slice(0, 20);

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ids: validIds }));
          } catch {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ fallback: true }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), searchApiPlugin()],
});
