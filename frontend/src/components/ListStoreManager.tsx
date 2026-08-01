import { useState } from "react";
import { api, Category, GroceryList as GroceryListType, Store } from "../lib/api";
import StoreManager from "./StoreManager";
import CategoryManager from "./CategoryManager";

interface Props {
  lists: GroceryListType[];
  stores: Store[];
  categories: Category[];
  onListsChanged: (selectId?: number) => void;
  onStoresChanged: () => void;
  onCategoriesChanged: () => void;
  onDeleteList: (id: number) => void;
  onClose: () => void;
}

// Everything about lists, stores, and categories that isn't "which list am
// I looking at right now" — creating/renaming/deleting a list, assigning
// its store, store CRUD/aisle ordering, and category CRUD — folded into
// one modal instead of living inline on the grocery list page, which was
// getting crowded with controls used only occasionally.
export default function ListStoreManager({
  lists,
  stores,
  categories,
  onListsChanged,
  onStoresChanged,
  onCategoriesChanged,
  onDeleteList,
  onClose,
}: Props) {
  const [newListName, setNewListName] = useState("");
  const [newListStoreId, setNewListStoreId] = useState("");
  const [addingList, setAddingList] = useState(false);
  const [editingListId, setEditingListId] = useState<number | null>(null);
  const [editingListName, setEditingListName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAddList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    setError(null);
    setAddingList(true);
    try {
      const storeId = newListStoreId ? Number(newListStoreId) : null;
      const { id } = await api.createGroceryList(newListName.trim(), storeId);
      setNewListName("");
      setNewListStoreId("");
      onListsChanged(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer la liste");
    } finally {
      setAddingList(false);
    }
  }

  function startEditingList(list: GroceryListType) {
    setEditingListId(list.id);
    setEditingListName(list.name);
  }

  async function saveEditingList() {
    const id = editingListId;
    const name = editingListName.trim();
    setEditingListId(null);
    if (id == null || !name) return;
    setError(null);
    try {
      await api.updateGroceryList(id, { name });
      onListsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de renommer la liste");
    }
  }

  async function handleChangeListStore(id: number, storeId: string) {
    setError(null);
    try {
      await api.updateGroceryList(id, { store_id: storeId ? Number(storeId) : null });
      onListsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'associer le magasin");
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-card bg-paper p-5 sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-sage-dark">Listes et magasins</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-ink/40 hover:text-ink">
            ✕
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-brick">{error}</p>}

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-sage-dark/70">
          Listes
        </h3>
        <ul className="mt-2 space-y-2">
          {lists.map((list) => (
            <li key={list.id} className="flex flex-wrap items-center gap-2">
              {editingListId === list.id ? (
                <input
                  autoFocus
                  value={editingListName}
                  onChange={(e) => setEditingListName(e.target.value)}
                  onBlur={saveEditingList}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditingListId(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-sage bg-white px-1.5 py-1 text-sm focus:outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">{list.name}</span>
              )}
              <select
                value={list.store_id ?? ""}
                onChange={(e) => handleChangeListStore(list.id, e.target.value)}
                aria-label={`Magasin pour ${list.name}`}
                className="rounded-lg border border-line bg-white/60 px-2 py-1 text-xs focus:border-sage focus:outline-none"
              >
                <option value="">Aucun magasin</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {editingListId !== list.id && (
                <button
                  type="button"
                  onClick={() => startEditingList(list)}
                  className="text-xs font-medium text-sage-dark hover:underline"
                >
                  Renommer
                </button>
              )}
              <button
                type="button"
                onClick={() => onDeleteList(list.id)}
                className="text-xs font-medium text-brick hover:underline"
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAddList} className="mt-3 flex flex-wrap gap-2">
          <input
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="Nouvelle liste…"
            className="min-w-0 flex-1 rounded-lg border border-line bg-white/60 px-3 py-1.5 text-sm focus:border-sage focus:outline-none"
          />
          <select
            value={newListStoreId}
            onChange={(e) => setNewListStoreId(e.target.value)}
            aria-label="Magasin de la nouvelle liste"
            className="rounded-lg border border-line bg-white/60 px-2 py-1.5 text-sm text-ink/70 focus:border-sage focus:outline-none"
          >
            <option value="">Aucun magasin</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={addingList || !newListName.trim()}
            className="rounded-lg border border-sage px-3 py-1.5 text-sm font-medium text-sage-dark hover:bg-sage/10 disabled:opacity-50"
          >
            + Liste
          </button>
        </form>

        <div className="mt-6">
          <StoreManager stores={stores} categories={categories} onStoresChanged={onStoresChanged} />
        </div>

        <CategoryManager categories={categories} onCategoriesChanged={onCategoriesChanged} />
      </div>
    </div>
  );
}
