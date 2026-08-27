import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Cookbook, CookbookEntry, ParsedToc, PdfPageText } from "../lib/api";
import { extractPdfPages, looksScanned } from "../lib/pdfPages";
import {
  COOKBOOK_RECIPE_SORT_KEY,
  COOKBOOK_RECIPE_SORTS,
  CookbookRecipeSort,
  isCookbookRecipeSort,
} from "../lib/cookbookSort";

// The front of the book, where the contents are printed. Generous: some books
// open with a long introduction before the table.
const FRONT_MATTER_PAGES = 40;
// Enough of each page to recognise a recipe title, and little enough that a
// 400-page book is a small request rather than megabytes of prose.
const HEADING_LINES = 3;

type Phase = "idle" | "reading" | "parsing" | "done" | "error";

export default function CookbookImport() {
  const { id } = useParams();
  const cookbookId = Number(id);

  const [book, setBook] = useState<Cookbook | null>(null);
  const [entries, setEntries] = useState<CookbookEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ page: 0, total: 0 });
  const [result, setResult] = useState<ParsedToc | null>(null);
  const [saved, setSaved] = useState<{ added: number; unchanged: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<CookbookRecipeSort>(() => {
    const remembered = localStorage.getItem(COOKBOOK_RECIPE_SORT_KEY);
    return isCookbookRecipeSort(remembered) ? remembered : "page";
  });

  // Cancelling has to stop the read, not just hide it: a big book keeps the
  // main thread busy for a while.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (!Number.isFinite(cookbookId)) return;
    api.getCookbook(cookbookId).then(setBook).catch(() => {});
    refreshEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cookbookId]);

  async function refreshEntries() {
    try {
      const data = await api.getCookbookEntries(cookbookId);
      setEntries(data.entries);
    } catch {
      // An empty index is the normal starting state, not an error worth
      // showing before the user has even picked a file.
    }
  }

  async function handleFile(file: File) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setPhase("reading");
    setError(null);
    setResult(null);
    setSaved(null);
    setProgress({ page: 0, total: 0 });

    const pages: PdfPageText[] = [];
    try {
      await extractPdfPages(
        file,
        (page, total) => {
          pages.push(page);
          setProgress({ page: page.page, total });
        },
        { signal: controller.signal }
      );
      if (controller.signal.aborted) {
        setPhase("idle");
        return;
      }

      if (looksScanned(pages)) {
        setPhase("error");
        setError(
          "Ce PDF ne contient pas de texte — il s'agit probablement de pages numérisées. L'import automatique n'est pas possible pour ce livre."
        );
        return;
      }

      setPhase("parsing");
      const parsed = await api.parseCookbookToc(cookbookId, {
        pages: pages.slice(0, FRONT_MATTER_PAGES),
        headings: pages.map((p) => ({
          page: p.page,
          lines: p.lines.slice(0, HEADING_LINES),
        })),
      });
      setResult(parsed);

      if (parsed.entries.length) {
        const stored = await api.saveCookbookIndex(
          cookbookId,
          parsed.entries.map((e) => ({
            title: e.title,
            page_number: e.page_number,
            chapter: e.chapter ?? null,
          }))
        );
        setSaved(stored);
        await refreshEntries();
        // Remember which file this book expects, so picking the wrong one
        // next time is obvious.
        if (book) {
          await api
            .updateCookbook(cookbookId, {
              title: book.title,
              author: book.author,
              publisher: book.publisher,
              year: book.year,
              isbn: book.isbn,
              page_count: book.page_count ?? pages.length,
              description: book.description,
              notes: book.notes,
              source_file_name: file.name,
              source_file_size: file.size,
              show_in_recipe_list: !!book.show_in_recipe_list,
            })
            .catch(() => {});
        }
      }
      setPhase("done");
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase("error");
      setError(err instanceof Error ? err.message : "Lecture impossible");
    }
  }

  const sorted = [...entries].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title, "fr");
    if (a.page_number == null || b.page_number == null) return 0;
    return a.page_number - b.page_number || a.title.localeCompare(b.title, "fr");
  });

  const importedCount = entries.filter((e) => e.recipe_id !== null).length;
  const duplicateCount = entries.filter((e) => e.duplicate_of).length;
  const busy = phase === "reading" || phase === "parsing";

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      <Link to={`/livres/${cookbookId}`} className="text-sm text-sage-dark hover:underline">
        ← {book?.title ?? "Retour au livre"}
      </Link>
      <h1 className="mt-2 font-display text-3xl text-sage-dark">
        Analyser le livre
      </h1>
      <p className="mt-2 text-sm text-ink/60">
        Choisissez le fichier PDF de ce livre. Il est lu directement sur votre
        appareil — le fichier lui-même n'est jamais envoyé, seulement le texte
        de sa table des matières.
      </p>
      {/* The flip side of never uploading the file: it has to be on whatever
          device you're holding. Easy to miss on a phone, where the book is
          usually still sitting on a computer. */}
      <p className="mt-1.5 text-xs text-ink/50">
        Le fichier doit donc se trouver sur cet appareil. Sur téléphone, placez-le
        d'abord dans Fichiers / Drive, ou faites l'analyse depuis un ordinateur :
        l'index est ensuite disponible partout.
      </p>

      <div className="mt-4 rounded-card border border-line bg-white/50 p-4">
        {/* No accept filter on purpose. A PDF downloaded on a phone often
            carries application/octet-stream rather than application/pdf, and an
            accept list then greys it out in the picker with no way to override —
            the file simply cannot be chosen. The magic bytes are checked when the
            file is read (assertPdfBytes), which is a stronger test than the
            picker's guess anyway. */}
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so picking the same file twice still fires.
            e.target.value = "";
            if (file) handleFile(file);
          }}
          className="w-full rounded-lg border border-line bg-white px-3 py-1.5
                     focus:border-sage focus:outline-none"
        />
        {book?.source_file_name && (
          <p className="mt-1.5 text-xs text-ink/50">
            Dernier fichier utilisé : {book.source_file_name}
          </p>
        )}

        {busy && (
          <div className="mt-3">
            <p className="text-sm text-ink/70">
              {phase === "reading"
                ? `Lecture de la page ${progress.page}${progress.total ? ` / ${progress.total}` : ""}…`
                : "Analyse de la table des matières…"}
            </p>
            {progress.total > 0 && (
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sage/15">
                <div
                  className="h-full bg-sage transition-[width]"
                  style={{ width: `${(progress.page / progress.total) * 100}%` }}
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                abort.current?.abort();
                setPhase("idle");
              }}
              className="mt-2 text-xs font-medium text-brick hover:underline"
            >
              Annuler
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-brick">{error}</p>}

        {result?.warning && !error && (
          <p className="mt-3 text-sm text-mustard-dark">{result.warning}</p>
        )}

        {saved && result && (
          <div className="mt-3 text-sm text-ink/70">
            <p>
              <span className="font-medium text-sage-dark">
                {result.entries.length} recettes trouvées
              </span>{" "}
              dans la table des matières
              {result.toc_pages.length > 0 &&
                ` (pages ${result.toc_pages.join(", ")} du PDF)`}
              .
            </p>
            <p className="mt-0.5 text-xs text-ink/50">
              {saved.added} ajoutée{saved.added > 1 ? "s" : ""} à l'index
              {saved.unchanged > 0 && `, ${saved.unchanged} déjà connue${saved.unchanged > 1 ? "s" : ""}`}.
              {result.page_offset !== null && result.page_offset !== 0 &&
                ` La numérotation du livre est décalée de ${result.page_offset} page(s) par rapport au PDF.`}
            </p>
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <>
          <div className="mt-8 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl text-sage-dark">
              Index ({entries.length})
            </h2>
            <label className="flex items-center gap-1.5 text-xs text-ink/50">
              Trier
              <select
                value={sort}
                onChange={(e) => {
                  if (isCookbookRecipeSort(e.target.value)) {
                    setSort(e.target.value);
                    localStorage.setItem(COOKBOOK_RECIPE_SORT_KEY, e.target.value);
                  }
                }}
                className="rounded-full border border-line bg-white px-2.5 py-1 text-sm
                           text-ink focus:border-sage focus:outline-none"
              >
                {COOKBOOK_RECIPE_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="mt-1 text-xs text-ink/50">
            {importedCount} importée{importedCount > 1 ? "s" : ""} sur {entries.length}
            {duplicateCount > 0 && ` · ${duplicateCount} déjà dans vos recettes`}
          </p>

          {/* Importing these is the next step and isn't built yet; the index
              stands on its own as a record of what the book contains. */}
          <p className="mt-3 rounded-card border border-line bg-white/50 p-3 text-xs text-ink/60">
            L'import des recettes elles-mêmes arrive bientôt. Cet index est
            conservé : relancer l'analyse plus tard ne le recréera pas.
          </p>

          <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-white/60">
            {sorted.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-3 px-3 py-2">
                <span className="w-10 flex-shrink-0 text-right text-xs text-ink/40">
                  {entry.page_number ?? "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`text-sm ${entry.recipe_id ? "text-ink/40 line-through" : "text-ink"}`}
                  >
                    {entry.title}
                  </span>
                  {entry.chapter && (
                    <span className="ml-2 text-xs text-ink/35">{entry.chapter}</span>
                  )}
                  {entry.duplicate_of && !entry.recipe_id && (
                    <span className="mt-0.5 block text-xs text-mustard-dark">
                      Déjà dans « {entry.duplicate_of.other_cookbook} »
                    </span>
                  )}
                </span>
                {entry.recipe_id && (
                  <Link
                    to={`/recettes/${entry.recipe_id}`}
                    className="flex-shrink-0 text-xs font-medium text-sage-dark hover:underline"
                  >
                    ✓ importée
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
