import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";

interface IngredientRow {
  name: string;
  quantity: string;
  unit: string;
}

export default function RecipeForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [servings, setServings] = useState("");
  const [prepTime, setPrepTime] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    { name: "", quantity: "", unit: "" },
  ]);
  const [steps, setSteps] = useState<string[]>([""]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    api.getRecipe(Number(id)).then((r) => {
      setTitle(r.title);
      setDescription(r.description ?? "");
      setServings(r.servings?.toString() ?? "");
      setPrepTime(r.prep_time?.toString() ?? "");
      setCookTime(r.cook_time?.toString() ?? "");
      setDifficulty(r.difficulty ?? "");
      setSourceUrl(r.source_url ?? "");
      setNotes(r.notes ?? "");
      setTagsInput(r.tags.map((t) => t.name).join(", "));
      setIngredients(
        r.ingredients.length
          ? r.ingredients.map((i) => ({
              name: i.name,
              quantity: i.quantity?.toString() ?? "",
              unit: i.unit ?? "",
            }))
          : [{ name: "", quantity: "", unit: "" }]
      );
      setSteps(r.steps.length ? r.steps.map((s) => s.text) : [""]);
    });
  }, [id, isEdit]);

  function updateIngredient(idx: number, field: keyof IngredientRow, value: string) {
    setIngredients((rows) =>
      rows.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
    );
  }

  function addIngredientRow() {
    setIngredients((rows) => [...rows, { name: "", quantity: "", unit: "" }]);
  }

  function removeIngredientRow(idx: number) {
    setIngredients((rows) => rows.filter((_, i) => i !== idx));
  }

  function updateStep(idx: number, value: string) {
    setSteps((rows) => rows.map((row, i) => (i === idx ? value : row)));
  }

  function addStep() {
    setSteps((rows) => [...rows, ""]);
  }

  function removeStep(idx: number) {
    setSteps((rows) => rows.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Le titre est obligatoire");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title,
        description: description || undefined,
        servings: servings ? Number(servings) : undefined,
        prep_time: prepTime ? Number(prepTime) : undefined,
        cook_time: cookTime ? Number(cookTime) : undefined,
        difficulty: difficulty || undefined,
        source_url: sourceUrl || undefined,
        notes: notes || undefined,
        ingredients: ingredients
          .filter((i) => i.name.trim())
          .map((i) => ({
            name: i.name,
            quantity: i.quantity ? Number(i.quantity) : undefined,
            unit: i.unit || undefined,
          })),
        steps: steps.filter((s) => s.trim()).map((text) => ({ text })),
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };

      const recipeId = isEdit
        ? (await api.updateRecipe(Number(id), payload), Number(id))
        : (await api.createRecipe(payload)).id;

      if (photoFile) {
        await api.uploadPhoto(recipeId, photoFile);
      }

      navigate(`/recettes/${recipeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 focus:border-sage focus:outline-none";
  const labelClass = "block text-sm font-medium text-ink/80";
  // Ingredient row inputs size themselves via flex-1 / w-20 / w-24, which
  // conflicts with the w-full baked into inputClass above (Tailwind's
  // generated stylesheet order — not the className string order — decides
  // which width utility wins, and w-full was winning). This variant omits
  // width so each row input's own sizing class applies correctly.
  const rowInputClass =
    "min-w-0 rounded-lg border border-line bg-white px-3 py-2 focus:border-sage focus:outline-none";

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <h1 className="font-display text-3xl text-sage-dark">
        {isEdit ? "Modifier la recette" : "Nouvelle recette"}
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
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
          rows={2}
        />
      </label>

      <label className={`${labelClass} mt-4`}>
        Photo
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
          className={`${inputClass} py-1.5`}
        />
      </label>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={labelClass}>
          Portions
          <input
            type="number"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Prép. (min)
          <input
            type="number"
            value={prepTime}
            onChange={(e) => setPrepTime(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Cuisson (min)
          <input
            type="number"
            value={cookTime}
            onChange={(e) => setCookTime(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Difficulté
          <input
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            placeholder="Facile"
            className={inputClass}
          />
        </label>
      </div>

      <label className={`${labelClass} mt-4`}>
        Tags (séparés par des virgules)
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="dîner, végétarien, rapide"
          className={inputClass}
        />
      </label>

      <section className="mt-6">
        <h2 className="font-display text-xl text-sage-dark">Ingrédients</h2>
        <div className="mt-2 space-y-2">
          {ingredients.map((row, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                value={row.name}
                onChange={(e) => updateIngredient(idx, "name", e.target.value)}
                placeholder="Nom"
                className={`${rowInputClass} flex-1`}
              />
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={row.quantity}
                onChange={(e) => updateIngredient(idx, "quantity", e.target.value)}
                placeholder="Qté"
                className={`${rowInputClass} w-20`}
              />
              <input
                value={row.unit}
                onChange={(e) => updateIngredient(idx, "unit", e.target.value)}
                placeholder="Unité"
                className={`${rowInputClass} w-24`}
              />
              <button
                type="button"
                onClick={() => removeIngredientRow(idx)}
                className="px-2 text-ink/40 hover:text-brick"
                aria-label="Retirer l'ingrédient"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addIngredientRow}
          className="mt-2 text-sm text-sage-dark hover:underline"
        >
          + Ajouter un ingrédient
        </button>
      </section>

      <section className="mt-6">
        <h2 className="font-display text-xl text-sage-dark">Préparation</h2>
        <div className="mt-2 space-y-2">
          {steps.map((step, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="mt-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-sage/15 font-mono text-xs text-sage-dark">
                {idx + 1}
              </span>
              <textarea
                value={step}
                onChange={(e) => updateStep(idx, e.target.value)}
                className={`${inputClass} mt-0 flex-1`}
                rows={2}
              />
              <button
                type="button"
                onClick={() => removeStep(idx)}
                className="px-2 text-ink/40 hover:text-brick"
                aria-label="Retirer l'étape"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addStep}
          className="mt-2 text-sm text-sage-dark hover:underline"
        >
          + Ajouter une étape
        </button>
      </section>

      <label className={`${labelClass} mt-6`}>
        Notes personnelles
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
          rows={3}
        />
      </label>

      <label className={`${labelClass} mt-4`}>
        URL source
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className={inputClass}
        />
      </label>

      <button
        type="submit"
        disabled={saving}
        className="mt-8 w-full rounded-lg bg-sage px-4 py-2.5 font-medium text-white hover:bg-sage-dark disabled:opacity-50"
      >
        {saving ? "Enregistrement…" : "Enregistrer la recette"}
      </button>
    </form>
  );
}
