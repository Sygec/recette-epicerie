import { useState } from "react";
import { api, Category } from "../lib/api";

interface Props {
  categories: Category[];
  onCategoriesChanged: () => void;
}

// Category CRUD, moved here from a permanently-visible "+ Catégorie" form
// on the grocery list page — creating a category is occasional, not a
// per-shopping-trip action. Mirrors StoreManager's shape (list + rename +
// delete + add form) minus aisle ordering, which doesn't apply here. Only
// custom categories can be deleted — the seeded aisle list is the backbone
// the rest of the app assumes exists, same rule the backend enforces.
export default function CategoryManager({ categories, onCategoriesChanged }: Props) {
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setError(null);
    setAddingCategory(true);
    try {
      await api.createCategory(newCategoryName.trim());
      setNewCategoryName("");
      onCategoriesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer la catégorie");
    } finally {
      setAddingCategory(false);
    }
  }

  function startEditingCategory(cat: Category) {
    setEditingCategoryId(cat.id);
    setEditingCategoryName(cat.name);
  }

  async function saveEditingCategory() {
    const id = editingCategoryId;
    const name = editingCategoryName.trim();
    setEditingCategoryId(null);
    if (id == null || !name) return;
    setError(null);
    try {
      await api.renameCategory(id, name);
      onCategoriesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de renommer la catégorie");
    }
  }

  async function handleDeleteCategory(id: number) {
    if (
      !confirm(
        "Supprimer cette catégorie ? Les articles seront déplacés vers « Autres / Non classé »."
      )
    )
      return;
    setError(null);
    try {
      await api.deleteCategory(id);
      onCategoriesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer la catégorie");
    }
  }

  return (
    <div className="mt-6 rounded-card border border-line bg-white/60 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-sage-dark/70">
        Catégories
      </h3>

      {error && <p className="mt-2 text-sm text-brick">{error}</p>}

      <ul className="mt-2 space-y-1">
        {categories
          .slice()
          .sort((a, b) => a.default_sort_order - b.default_sort_order)
          .map((cat) => (
            <li key={cat.id} className="flex items-center gap-2 py-1">
              {editingCategoryId === cat.id ? (
                <input
                  autoFocus
                  value={editingCategoryName}
                  onChange={(e) => setEditingCategoryName(e.target.value)}
                  onBlur={saveEditingCategory}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditingCategoryId(null);
                  }}
                  className="flex-1 rounded border border-sage bg-white px-1.5 py-0.5 text-sm focus:outline-none"
                />
              ) : (
                <span className="flex-1 text-sm">{cat.name}</span>
              )}
              {editingCategoryId !== cat.id && (
                <button
                  type="button"
                  onClick={() => startEditingCategory(cat)}
                  className="text-xs font-medium text-sage-dark hover:underline"
                >
                  Renommer
                </button>
              )}
              {!!cat.is_custom && (
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(cat.id)}
                  className="text-xs font-medium text-brick hover:underline"
                >
                  Supprimer
                </button>
              )}
            </li>
          ))}
      </ul>

      <form onSubmit={handleAddCategory} className="mt-2 flex gap-2">
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="Nouvelle catégorie…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-white/60 px-3 py-1.5 text-sm focus:border-sage focus:outline-none"
        />
        <button
          type="submit"
          disabled={addingCategory || !newCategoryName.trim()}
          className="rounded-lg border border-sage px-3 py-1.5 text-sm font-medium text-sage-dark hover:bg-sage/10 disabled:opacity-50"
        >
          + Catégorie
        </button>
      </form>
    </div>
  );
}
