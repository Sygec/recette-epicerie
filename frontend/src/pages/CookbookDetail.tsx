import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, CookbookDetail as Cookbook } from "../lib/api";
import {
  COOKBOOK_RECIPE_SORT_KEY,
  COOKBOOK_RECIPE_SORTS,
  CookbookRecipeSort,
  isCookbookRecipeSort,
  sortCookbookRecipes,
} from "../lib/cookbookSort";

export default function CookbookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [book, setBook] = useState<Cookbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sort, setSort] = useState<CookbookRecipeSort>(() => {
    const remembered = localStorage.getItem(COOKBOOK_RECIPE_SORT_KEY);
    return isCookbookRecipeSort(remembered) ? remembered : "page";
  });

  useEffect(() => {
    if (!id) return;
    api
      .getCookbook(Number(id))
      .then(setBook)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Impossible de charger ce livre")
      )
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    localStorage.setItem(COOKBOOK_RECIPE_SORT_KEY, sort);
  }, [sort]);

  const sortedRecipes = useMemo(
    () => sortCookbookRecipes(book?.recipes ?? [], sort),
    [book, sort]
  );

  async function toggleVisibility() {
    if (!book) return;
    const next = !book.show_in_recipe_list;
    // Optimistic: the switch should feel instant, and it's one boolean to put
    // back if the request fails.
    setBook({ ...book, show_in_recipe_list: next ? 1 : 0 });
    setSavingVisibility(true);
    try {
      await api.setCookbookVisibility(book.id, next);
    } catch (err) {
      setBook({ ...book, show_in_recipe_list: next ? 0 : 1 });
      setError(err instanceof Error ? err.message : "Impossible d'enregistrer ce réglage");
    } finally {
      setSavingVisibility(false);
    }
  }

  async function handleDelete(recipes: "keep" | "delete") {
    if (!book) return;
    setDeleting(true);
    try {
      await api.deleteCookbook(book.id, recipes);
      navigate("/livres");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible");
      setDeleting(false);
    }
  }

  if (loading) return <p className="mt-10 text-center text-ink/40">Chargement…</p>;
  if (!book) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <p className="text-brick">{error ?? "Livre introuvable"}</p>
        <Link to="/livres" className="mt-3 inline-block text-sage-dark underline">
          Retour aux livres
        </Link>
      </div>
    );
  }

  const meta = [book.publisher, book.year?.toString(), book.page_count && `${book.page_count} pages`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      {error && <p className="mb-3 text-sm text-brick">{error}</p>}

      <div className="flex gap-4">
        <div className="h-44 w-28 flex-shrink-0 overflow-hidden rounded-card border border-line bg-sage/10">
          {book.cover_url ? (
            <img src={book.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl">📚</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl leading-tight text-sage-dark">{book.title}</h1>
          {book.author && <p className="mt-0.5 text-sm text-ink/60">{book.author}</p>}
          {meta && <p className="mt-1 text-xs text-ink/50">{meta}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to={`/livres/${book.id}/modifier`}
              className="rounded-lg border border-sage px-3 py-1.5 text-sm font-medium
                         text-sage-dark hover:bg-sage/10"
            >
              Modifier
            </Link>
            <Link
              to={`/livres/${book.id}/analyser`}
              className="rounded-lg border border-sage bg-sage px-3 py-1.5 text-sm
                         font-medium text-white hover:bg-sage-dark"
            >
              Analyser le PDF
            </Link>
          </div>
        </div>
      </div>

      {book.description && (
        <p className="mt-4 whitespace-pre-line text-sm text-ink/70">{book.description}</p>
      )}
      {book.notes && (
        <p className="mt-3 rounded-card border border-line bg-white/50 p-3 text-sm text-ink/70">
          {book.notes}
        </p>
      )}

      <button
        type="button"
        onClick={toggleVisibility}
        disabled={savingVisibility}
        className={`mt-5 w-full rounded-card border px-3 py-2.5 text-left text-sm transition-colors ${
          book.show_in_recipe_list
            ? "border-sage bg-sage/10 text-sage-dark"
            : "border-line bg-white/50 text-ink/70"
        } disabled:opacity-60`}
      >
        <span className="font-medium">
          {book.show_in_recipe_list ? "✓ " : ""}
          Afficher ses recettes dans « Mes recettes »
        </span>
        <span className="mt-0.5 block text-xs text-ink/50">
          {book.show_in_recipe_list
            ? "Ses recettes apparaissent avec les vôtres."
            : "Ses recettes restent ici, et restent trouvables par la recherche."}
        </span>
      </button>

      <div className="mt-8 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl text-sage-dark">
          Recettes {book.recipes.length > 0 && `(${book.recipes.length})`}
        </h2>
        {book.recipes.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-ink/50">
            Trier
            <select
              value={sort}
              onChange={(e) => {
                if (isCookbookRecipeSort(e.target.value)) setSort(e.target.value);
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
        )}
      </div>

      {sortedRecipes.length === 0 ? (
        <p className="mt-4 rounded-card border border-line bg-white/50 p-4 text-sm text-ink/60">
          Aucune recette de ce livre pour l'instant. « Analyser le PDF » en
          dresse la liste à partir de sa table des matières ; vous pouvez aussi
          rattacher une recette à ce livre en la créant normalement.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sortedRecipes.map((r) => (
            <li key={r.id}>
              <Link
                to={`/recettes/${r.id}`}
                className="flex overflow-hidden rounded-card border border-line
                           bg-white/60 transition-shadow hover:shadow-md"
              >
                <div className="h-20 w-20 flex-shrink-0 bg-sage/10">
                  {/* Imported recipes rarely have their own photo, so the
                      book's cover stands in — it's a better cue than a
                      generic placeholder that this came from this book. */}
                  {r.photo_url || book.cover_url ? (
                    <img
                      src={r.photo_url ?? book.cover_url!}
                      alt=""
                      className={`h-full w-full object-cover ${r.photo_url ? "" : "opacity-40"}`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl">
                      🍽️
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col justify-center px-3 py-2">
                  <h3 className="font-display text-base leading-tight">{r.title}</h3>
                  <p className="mt-0.5 text-xs text-ink/50">
                    {[r.cookbook_page && `p. ${r.cookbook_page}`, r.difficulty]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 border-t border-line pt-4">
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-sm font-medium text-brick hover:underline"
          >
            Supprimer ce livre
          </button>
        ) : (
          <div className="rounded-card border border-brick/40 bg-brick/5 p-4">
            <p className="text-sm text-ink/80">
              Supprimer « {book.title} »
              {book.recipes.length > 0 && (
                <>
                  {" "}— que faire de ses {book.recipes.length} recette
                  {book.recipes.length > 1 ? "s" : ""} ?
                </>
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => handleDelete("keep")}
                className="rounded-lg border border-sage px-3 py-2 text-sm font-medium
                           text-sage-dark hover:bg-sage/10 disabled:opacity-50"
              >
                {book.recipes.length > 0 ? "Garder les recettes" : "Supprimer"}
              </button>
              {book.recipes.length > 0 && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => handleDelete("delete")}
                  className="rounded-lg bg-brick px-3 py-2 text-sm font-medium text-white
                             hover:bg-brick-dark disabled:opacity-50"
                >
                  Supprimer aussi les recettes
                </button>
              )}
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
                className="rounded-lg border border-line px-3 py-2 text-sm text-ink/70"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
