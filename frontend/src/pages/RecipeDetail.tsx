import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, RecipeDetail as RecipeDetailType } from "../lib/api";
import AddToListReview, { ReviewIngredient } from "../components/AddToListReview";

// Only http(s) URLs are safe to render as a clickable href — anything else
// (notably a javascript: URL) would execute in-page on click, with access to
// the session token in localStorage since the frontend and API share an
// origin. source_url is free-text the user typed into the recipe form, so it
// must be checked at render time regardless of what the form itself allows.
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Rounds to 2 decimals and drops trailing zeros (1.50 -> 1.5, 2.00 -> 2),
// matching how the unscaled quantity already renders via plain interpolation.
function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<RecipeDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [desiredServings, setDesiredServings] = useState<number | null>(null);
  const [showAddToList, setShowAddToList] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .getRecipe(Number(id))
      .then((r) => {
        setRecipe(r);
        setDesiredServings(r.servings ?? null);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  // recipe.servings is optional (Phase 1 field) — without it there's no base
  // to scale from, so the stepper is hidden and this stays 1 (see JSX below).
  const scaleFactor =
    recipe?.servings && desiredServings ? desiredServings / recipe.servings : 1;

  async function toggleFavorite() {
    if (!recipe) return;
    const next = !recipe.is_favorite;
    setActionError(null);
    setRecipe({ ...recipe, is_favorite: next });
    try {
      await api.setFavorite(recipe.id, next);
    } catch (err) {
      setRecipe((r) => (r ? { ...r, is_favorite: !next } : r));
      setActionError(
        err instanceof Error ? err.message : "Impossible de mettre à jour le favori"
      );
    }
  }

  async function handleDelete() {
    if (!recipe) return;
    if (!confirm(`Supprimer « ${recipe.title} » ?`)) return;
    setActionError(null);
    try {
      await api.deleteRecipe(recipe.id);
      navigate("/");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Impossible de supprimer la recette"
      );
    }
  }

  const reviewIngredients: ReviewIngredient[] = recipe
    ? recipe.ingredients.map((ing) => ({
        id: ing.id,
        name: ing.name,
        quantity: ing.quantity != null ? roundQuantity(ing.quantity * scaleFactor) : null,
        unit: ing.unit,
      }))
    : [];

  if (error) return <p className="p-6 text-brick">{error}</p>;
  if (!recipe) return <p className="p-6 text-ink/40">Chargement…</p>;

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <div className="h-56 w-full bg-sage/10 sm:rounded-b-card">
        {recipe.photo_url ? (
          <img
            src={recipe.photo_url}
            alt=""
            className="h-full w-full object-cover sm:rounded-b-card"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl">
            🍽️
          </div>
        )}
      </div>

      <div className="px-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-3xl leading-tight">{recipe.title}</h1>
          <button
            onClick={toggleFavorite}
            aria-label="Basculer favori"
            className={`text-2xl ${recipe.is_favorite ? "text-mustard" : "text-ink/20"}`}
          >
            ★
          </button>
        </div>

        {recipe.description && (
          <p className="mt-2 text-ink/70">{recipe.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink/60">
          {recipe.servings && desiredServings && (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDesiredServings((s) => Math.max(1, (s ?? 1) - 1))}
                aria-label="Réduire les portions"
                className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-ink/70 hover:border-sage hover:text-sage-dark"
              >
                −
              </button>
              <span className="font-mono">{desiredServings} portions</span>
              <button
                type="button"
                onClick={() => setDesiredServings((s) => (s ?? 1) + 1)}
                aria-label="Augmenter les portions"
                className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-ink/70 hover:border-sage hover:text-sage-dark"
              >
                +
              </button>
            </span>
          )}
          {recipe.prep_time && <span>{recipe.prep_time} min prép.</span>}
          {recipe.cook_time && <span>{recipe.cook_time} min cuisson</span>}
          {recipe.difficulty && <span>{recipe.difficulty}</span>}
        </div>

        {recipe.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {recipe.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-full border border-sage/40 bg-sage/10 px-2.5 py-0.5 text-xs text-sage-dark"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}

        {actionError && <p className="mt-3 text-sm text-brick">{actionError}</p>}

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => setShowAddToList(true)}
            className="flex-1 rounded-lg bg-sage px-4 py-2.5 font-medium text-white hover:bg-sage-dark"
          >
            Ajouter à la liste de courses
          </button>
          <Link
            to={`/recettes/${recipe.id}/modifier`}
            className="rounded-lg border border-line px-4 py-2.5 font-medium hover:border-ink/30"
          >
            Modifier
          </Link>
        </div>

        {showAddToList && (
          <AddToListReview
            ingredients={reviewIngredients}
            recipeId={recipe.id}
            onClose={() => setShowAddToList(false)}
            onAdded={() => {
              setShowAddToList(false);
              navigate("/courses");
            }}
          />
        )}

        <section className="mt-8">
          <h2 className="font-display text-xl text-sage-dark">Ingrédients</h2>
          <ul className="mt-2 divide-y divide-line">
            {recipe.ingredients.map((ing) => (
              <li key={ing.id} className="flex justify-between py-2 text-sm">
                <span>{ing.name}</span>
                <span className="font-mono text-ink/60">
                  {ing.quantity != null ? roundQuantity(ing.quantity * scaleFactor) : ""}{" "}
                  {ing.unit ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="font-display text-xl text-sage-dark">Préparation</h2>
          <ol className="mt-2 space-y-4">
            {recipe.steps.map((step) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-sage/15 font-mono text-xs text-sage-dark">
                  {step.step_number}
                </span>
                <p className="text-sm leading-relaxed">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {recipe.notes && (
          <section className="mt-8">
            <h2 className="font-display text-xl text-sage-dark">Notes</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink/70">
              {recipe.notes}
            </p>
          </section>
        )}

        {recipe.source_url && (
          <p className="mt-8 text-xs text-ink/40">
            Source :{" "}
            {isHttpUrl(recipe.source_url) ? (
              <a
                href={recipe.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {recipe.source_url}
              </a>
            ) : (
              recipe.source_url
            )}
          </p>
        )}

        <button
          onClick={handleDelete}
          className="mt-8 text-sm text-brick hover:underline"
        >
          Supprimer cette recette
        </button>
      </div>
    </div>
  );
}
