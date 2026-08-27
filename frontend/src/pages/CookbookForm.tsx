import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, CookbookPayload } from "../lib/api";

/**
 * Create and edit in one component, discriminated by whether there's an :id —
 * the same arrangement as RecipeForm. App.tsx keys the route on the param so
 * this remounts cleanly when navigating between books.
 */
export default function CookbookForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publisher, setPublisher] = useState("");
  // Numbers are held as strings and coerced on submit, so a half-typed year
  // doesn't fight the input. Same approach as RecipeForm.
  const [year, setYear] = useState("");
  const [isbn, setIsbn] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [showInRecipeList, setShowInRecipeList] = useState(false);

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [currentCover, setCurrentCover] = useState<string | null>(null);
  // A cover found by the lookup: a remote URL that only gets copied into R2
  // once the book is actually saved.
  const [foundCoverUrl, setFoundCoverUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getCookbook(Number(id))
      .then((book) => {
        setTitle(book.title);
        setAuthor(book.author ?? "");
        setPublisher(book.publisher ?? "");
        setYear(book.year?.toString() ?? "");
        setIsbn(book.isbn ?? "");
        setPageCount(book.page_count?.toString() ?? "");
        setDescription(book.description ?? "");
        setNotes(book.notes ?? "");
        setShowInRecipeList(!!book.show_in_recipe_list);
        setCurrentCover(book.cover_url);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Impossible de charger ce livre")
      )
      .finally(() => setLoading(false));
  }, [id]);

  async function handleLookup() {
    if (!title.trim() && !isbn.trim()) return;
    setLooking(true);
    setLookupError(null);
    setLookupNote(null);
    try {
      const found = await api.lookupCookbook({
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        isbn: isbn.trim() || undefined,
      });
      // Only fill what's still empty: a value already typed is a correction,
      // and overwriting it would be infuriating.
      setTitle((v) => v || found.title);
      setAuthor((v) => v || found.author || "");
      setPublisher((v) => v || found.publisher || "");
      setYear((v) => v || found.year?.toString() || "");
      setIsbn((v) => v || found.isbn || "");
      setPageCount((v) => v || found.page_count?.toString() || "");
      setDescription((v) => v || found.description || "");
      if (found.cover_url && !coverFile) setFoundCoverUrl(found.cover_url);
      setLookupNote(
        `Trouvé sur ${found.source === "openlibrary" ? "Open Library" : "Google Books"} — vérifiez et corrigez au besoin.`
      );
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Recherche impossible");
    } finally {
      setLooking(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);

    // Numbers come out of text inputs; an empty field means "not recorded",
    // not zero.
    const optionalNumber = (raw: string) => {
      const value = Number(raw);
      return raw.trim() && Number.isFinite(value) ? value : null;
    };

    const payload: CookbookPayload = {
      title: title.trim(),
      author: author.trim() || null,
      publisher: publisher.trim() || null,
      year: optionalNumber(year),
      isbn: isbn.trim() || null,
      page_count: optionalNumber(pageCount),
      description: description.trim() || null,
      notes: notes.trim() || null,
      show_in_recipe_list: showInRecipeList,
    };

    try {
      // Save first to get an id, then attach the cover — the cover endpoints
      // are keyed by book id. Same order as RecipeForm's photo handling.
      const bookId = isEdit
        ? (await api.updateCookbook(Number(id), payload), Number(id))
        : (await api.createCookbook(payload)).id;

      if (coverFile) {
        await api.uploadCookbookCover(bookId, coverFile);
      } else if (foundCoverUrl) {
        // Copy it into R2 so the catalogue doesn't depend on someone else's
        // CDN staying up.
        await api.setCookbookCoverFromUrl(bookId, foundCoverUrl);
      }

      navigate(`/livres/${bookId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 focus:border-sage focus:outline-none";
  const labelClass = "block text-sm font-medium text-ink/80";
  const rowInputClass =
    "min-w-0 rounded-lg border border-line bg-white px-3 py-2 focus:border-sage focus:outline-none";

  if (loading) {
    return <p className="mt-10 text-center text-ink/40">Chargement…</p>;
  }

  const previewCover = foundCoverUrl ?? currentCover;

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <h1 className="font-display text-3xl text-sage-dark">
        {isEdit ? "Modifier le livre" : "Nouveau livre"}
      </h1>

      {error && <p className="mt-3 text-sm text-brick">{error}</p>}

      <label className={`${labelClass} mt-6`}>
        Titre *
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          required
        />
      </label>

      <label className={`${labelClass} mt-4`}>
        Auteur
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className={inputClass}
        />
      </label>

      {/* Offered on edit too, unlike the recipe URL import: a book added
          before you knew its ISBN is exactly the one worth looking up later. */}
      <div className="mt-3 rounded-card border border-line bg-white/50 p-4">
        <p className={labelClass}>Compléter automatiquement</p>
        <p className="mt-1 text-xs text-ink/50">
          Cherche le titre (et l'ISBN si vous l'avez) dans Open Library puis Google
          Books. Ne remplace jamais ce que vous avez déjà saisi.
        </p>
        <button
          type="button"
          onClick={handleLookup}
          disabled={looking || (!title.trim() && !isbn.trim())}
          className="mt-2 rounded-lg border border-sage px-4 py-2 font-medium
                     text-sage-dark hover:bg-sage/10 disabled:opacity-50"
        >
          {looking ? "Recherche…" : "Rechercher"}
        </button>
        {lookupError && <p className="mt-2 text-sm text-brick">{lookupError}</p>}
        {lookupNote && <p className="mt-2 text-sm text-sage-dark">{lookupNote}</p>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Éditeur
          <input
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Année
          <input
            type="number"
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          ISBN
          <input
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Pages
          <input
            type="number"
            inputMode="numeric"
            value={pageCount}
            onChange={(e) => setPageCount(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <label className={`${labelClass} mt-4`}>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </label>

      <label className={`${labelClass} mt-4`}>
        Notes personnelles
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </label>

      <p className={`${labelClass} mt-4`}>Couverture</p>
      {previewCover && !coverFile && (
        <img
          src={previewCover}
          alt=""
          className="mt-1 h-40 w-28 rounded-lg border border-line object-cover"
        />
      )}
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
        className={`${rowInputClass} mt-1 w-full py-1.5`}
      />

      <label className="mt-5 flex items-start gap-2 text-sm text-ink/80">
        <input
          type="checkbox"
          checked={showInRecipeList}
          onChange={(e) => setShowInRecipeList(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Afficher ses recettes dans « Mes recettes »
          <span className="mt-0.5 block text-xs text-ink/50">
            Désactivé, le livre reste consultable ici et ses recettes restent
            trouvables par la recherche — elles n'encombrent simplement pas la
            liste principale.
          </span>
        </span>
      </label>

      <div className="mt-6 flex gap-3">
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="flex-1 rounded-lg bg-sage py-3 font-medium text-white
                     hover:bg-sage-dark disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg border border-line px-4 py-3 font-medium text-ink/70"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
