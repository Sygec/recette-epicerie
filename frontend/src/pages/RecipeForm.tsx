import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Cookbook, ImportedRecipe } from "../lib/api";

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
  // Which book this recipe comes from. Mostly set by the cookbook importer,
  // but offered here so a recipe typed out of a paper cookbook can be filed
  // under it — otherwise a book with no file would be a shelf you can't put
  // anything on.
  const [cookbookId, setCookbookId] = useState("");
  const [cookbookPage, setCookbookPage] = useState("");
  const [cookbooks, setCookbooks] = useState<Cookbook[]>([]);
  const [tagsInput, setTagsInput] = useState("");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    { name: "", quantity: "", unit: "" },
  ]);
  const [steps, setSteps] = useState<string[]>([""]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  // The photo already on the recipe. Shown so editing doesn't look like the
  // recipe has no image — it isn't part of the submitted payload, the upload
  // endpoints own it.
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Empty shelf is the normal case for most people, so failure here is
    // silent: it just means the selector has nothing to offer.
    api.getCookbooks().then(setCookbooks).catch(() => {});
  }, []);

  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [importedImageUrl, setImportedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    api.getRecipe(Number(id)).then((r) => {
      setTitle(r.title);
      setExistingPhotoUrl(r.photo_url);
      setDescription(r.description ?? "");
      setServings(r.servings?.toString() ?? "");
      setPrepTime(r.prep_time?.toString() ?? "");
      setCookTime(r.cook_time?.toString() ?? "");
      setDifficulty(r.difficulty ?? "");
      setSourceUrl(r.source_url ?? "");
      setNotes(r.notes ?? "");
      setCookbookId(r.cookbook_id?.toString() ?? "");
      setCookbookPage(r.cookbook_page?.toString() ?? "");
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

  // Shared by both importers so a URL and a PDF fill the form identically.
  // Empty arrays collapse to one blank row rather than nothing, so the form is
  // never left with no ingredient or step to type into.
  function applyImported(imported: ImportedRecipe) {
    setTitle(imported.title);
    setDescription(imported.description ?? "");
    setServings(imported.servings?.toString() ?? "");
    setPrepTime(imported.prep_time?.toString() ?? "");
    setCookTime(imported.cook_time?.toString() ?? "");
    setTagsInput(imported.tags.join(", "));
    setIngredients(
      imported.ingredients.length
        ? imported.ingredients.map((i) => ({
            name: i.name,
            quantity: i.quantity?.toString() ?? "",
            unit: i.unit ?? "",
          }))
        : [{ name: "", quantity: "", unit: "" }]
    );
    setSteps(imported.steps.length ? imported.steps : [""]);
    // Only the PDF importer reports one, and the URL path overwrites it with
    // the address that was actually fetched.
    setSourceUrl(imported.source_url ?? "");
    setImportedImageUrl(imported.image_url ?? null);
    setImportWarning(imported.warning ?? null);
  }

  async function handleImport() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError(null);
    setImportWarning(null);
    try {
      const imported = await api.importRecipe(importUrl.trim());
      applyImported(imported);
      setSourceUrl(importUrl.trim());
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Impossible d'importer cette recette"
      );
    } finally {
      setImporting(false);
    }
  }

  // The PDF is read here rather than uploaded: extraction happens in the
  // browser and only the text is sent. Nothing extra is set afterwards — a PDF
  // has no image, and any source URL it prints comes back in the parse.
  async function handleImportPdf(file: File) {
    setImporting(true);
    setImportError(null);
    setImportWarning(null);
    try {
      const { extractPdfText } = await import("../lib/pdfText");
      const text = await extractPdfText(file);
      applyImported(await api.importRecipeText(text));
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Impossible d'importer ce PDF"
      );
    } finally {
      setImporting(false);
    }
  }

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
        // Sent explicitly rather than omitted: the server treats an absent
        // key as "leave alone", so omitting them would make clearing the
        // selector do nothing.
        cookbook_id: cookbookId ? Number(cookbookId) : null,
        cookbook_page: cookbookId && cookbookPage ? Number(cookbookPage) : null,
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
      } else if (importedImageUrl) {
        await api.setPhotoFromUrl(recipeId, importedImageUrl);
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

      {!isEdit && (
        <div className="mt-6 rounded-card border border-line bg-white/50 p-4">
          <p className={labelClass}>Importer depuis une URL</p>
          <div className="mt-1 flex gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://exemple.com/recette"
              className={`${rowInputClass} flex-1`}
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || !importUrl.trim()}
              className="rounded-lg border border-sage px-4 py-2 font-medium text-sage-dark hover:bg-sage/10 disabled:opacity-50"
            >
              {importing ? "Import…" : "Importer"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink/50">
            Fonctionne mieux sur les sites de recettes ; vous pourrez toujours modifier le résultat avant d'enregistrer.
          </p>

          <p className={`${labelClass} mt-4`}>…ou depuis un PDF</p>
          {/* No accept filter — see the note in pages/CookbookImport.tsx: a
              phone-downloaded PDF often reports application/octet-stream and an
              accept list makes it unselectable. assertPdfBytes checks the real
              bytes instead. */}
          <input
            type="file"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset the input so picking the same file twice still fires.
              e.target.value = "";
              if (file) handleImportPdf(file);
            }}
            className={`${rowInputClass} mt-1 w-full py-1.5`}
          />
          <p className="mt-1.5 text-xs text-ink/50">
            Une recette enregistrée ou imprimée en PDF. Les pages numérisées ne
            contiennent pas de texte et ne peuvent pas être lues.
          </p>
          {importError && <p className="mt-2 text-sm text-brick">{importError}</p>}
          {importWarning && (
            <p className="mt-2 text-sm text-mustard-dark">{importWarning}</p>
          )}
          {importedImageUrl && !photoFile && (
            <img
              src={importedImageUrl}
              alt=""
              className="mt-3 h-32 w-full rounded-lg object-cover"
            />
          )}
        </div>
      )}

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
      {existingPhotoUrl && !photoFile && !importedImageUrl && (
        <div className="mt-2">
          <img
            src={existingPhotoUrl}
            alt=""
            className="h-32 w-full rounded-lg object-cover"
          />
          <p className="mt-1 text-xs text-ink/50">
            Photo actuelle — conservée si vous n'en choisissez pas une autre.
          </p>
        </div>
      )}

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

      {/* Only shown once there's a shelf to file into — an empty selector is
          just a question nobody can answer. */}
      {cookbooks.length > 0 && (
        <div className="mt-4 flex gap-3">
          <label className={`${labelClass} flex-1`}>
            Livre
            <select
              value={cookbookId}
              onChange={(e) => setCookbookId(e.target.value)}
              className={inputClass}
            >
              <option value="">Aucun</option>
              {cookbooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} w-24`}>
            Page
            <input
              type="number"
              inputMode="numeric"
              value={cookbookPage}
              onChange={(e) => setCookbookPage(e.target.value)}
              disabled={!cookbookId}
              className={`${inputClass} disabled:opacity-50`}
            />
          </label>
        </div>
      )}

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
