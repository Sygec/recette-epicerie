import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, RecipeDetail as RecipeDetailType } from "../lib/api";

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<RecipeDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getRecipe(Number(id))
      .then(setRecipe)
      .catch((err) => setError(err.message));
  }, [id]);

  async function toggleFavorite() {
    if (!recipe) return;
    const next = !recipe.is_favorite;
    setRecipe({ ...recipe, is_favorite: next });
    await api.setFavorite(recipe.id, next);
  }

  async function handleDelete() {
    if (!recipe) return;
    if (!confirm(`Supprimer « ${recipe.title} » ?`)) return;
    await api.deleteRecipe(recipe.id);
    navigate("/");
  }

  async function addAllToGroceryList() {
    if (!recipe) return;
    for (const ing of recipe.ingredients) {
      await api.addGroceryItem({
        name: ing.name,
        quantity: ing.quantity ?? undefined,
        unit: ing.unit ?? undefined,
      });
    }
    navigate("/courses");
  }

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

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/60">
          {recipe.servings && <span>{recipe.servings} portions</span>}
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

        <div className="mt-6 flex gap-2">
          <button
            onClick={addAllToGroceryList}
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

        <section className="mt-8">
          <h2 className="font-display text-xl text-sage-dark">Ingrédients</h2>
          <ul className="mt-2 divide-y divide-line">
            {recipe.ingredients.map((ing) => (
              <li key={ing.id} className="flex justify-between py-2 text-sm">
                <span>{ing.name}</span>
                <span className="font-mono text-ink/60">
                  {ing.quantity ?? ""} {ing.unit ?? ""}
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
            <a href={recipe.source_url} className="underline">
              {recipe.source_url}
            </a>
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
