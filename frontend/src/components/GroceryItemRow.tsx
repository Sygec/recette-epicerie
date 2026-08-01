import { CSSProperties, ReactNode, useState } from "react";
import { Category, GroceryItem } from "../lib/api";

export interface GroceryItemRowProps {
  item: GroceryItem;
  categories: Category[];
  onToggle: (item: GroceryItem) => void;
  onDelete: (id: number) => void;
  // Raw field values — the parent owns parsing and validation so the error
  // message stays in one place.
  onSaveQuantity: (id: number, quantity: string, unit: string) => void;
  onChangeCategory: (item: GroceryItem, categoryId: number | null, remember: boolean) => void;
  // Supplied by SortableGroceryItemRow in manual sort mode; absent in
  // category mode, where rows aren't draggable.
  innerRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  dragHandle?: ReactNode;
}

// One line of the grocery list. Owns its own transient edit state (which
// field is open, what's typed in it) so the parent only has to hold the
// items themselves; every actual write goes back up through a callback.
export default function GroceryItemRow({
  item,
  categories,
  onToggle,
  onDelete,
  onSaveQuantity,
  onChangeCategory,
  innerRef,
  style,
  dragHandle,
}: GroceryItemRowProps) {
  const [editingQuantity, setEditingQuantity] = useState(false);
  const [quantityValue, setQuantityValue] = useState("");
  const [unitValue, setUnitValue] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [remember, setRemember] = useState(false);

  function startEditingQuantity() {
    setQuantityValue(item.quantity != null ? String(item.quantity) : "");
    setUnitValue(item.unit ?? "");
    setEditingQuantity(true);
  }

  function saveQuantity() {
    setEditingQuantity(false);
    onSaveQuantity(item.id, quantityValue, unitValue);
  }

  function toggleCategoryPicker() {
    setRemember(false);
    setShowCategoryPicker((open) => !open);
  }

  function pickCategory(value: string) {
    const categoryId = value ? Number(value) : null;
    setShowCategoryPicker(false);
    if (categoryId === item.category_id && !remember) return;
    onChangeCategory(item, categoryId, remember);
  }

  return (
    <li ref={innerRef} style={style} className="bg-white/60 px-3 py-2.5">
      <div className="flex items-center gap-3">
        {dragHandle}
        <button
          onClick={() => onToggle(item)}
          aria-label={item.is_checked ? "Marquer comme non trouvé" : "Marquer comme trouvé"}
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 ${
            item.is_checked ? "border-sage bg-sage text-white" : "border-line"
          }`}
        >
          {item.is_checked ? "✓" : ""}
        </button>

        <span className={`flex-1 text-sm ${item.is_checked ? "text-ink/30 line-through" : ""}`}>
          {item.name}
        </span>

        {editingQuantity ? (
          <span
            className="flex flex-shrink-0 items-center gap-1"
            onBlur={(e) => {
              // Tabbing from the quantity field to the unit field fires a
              // blur on the quantity input too — only save once focus
              // actually leaves both fields, otherwise the fields unmount
              // mid-edit.
              if (!e.currentTarget.contains(e.relatedTarget as Node)) saveQuantity();
            }}
          >
            <input
              autoFocus
              value={quantityValue}
              onChange={(e) => setQuantityValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingQuantity(false);
              }}
              placeholder="Qté"
              aria-label="Quantité"
              inputMode="decimal"
              className="w-12 rounded border border-sage bg-white px-1 py-0.5 text-right font-mono text-xs focus:outline-none"
            />
            <input
              value={unitValue}
              onChange={(e) => setUnitValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingQuantity(false);
              }}
              placeholder="Unité"
              aria-label="Unité"
              className="w-16 rounded border border-sage bg-white px-1 py-0.5 font-mono text-xs focus:outline-none"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={startEditingQuantity}
            title="Cliquer pour modifier la quantité"
            className="flex-shrink-0 font-mono text-xs text-ink/50 hover:text-sage-dark"
          >
            {item.quantity != null || item.unit
              ? `${item.quantity ?? ""} ${item.unit ?? ""}`.trim()
              : "+ qté"}
          </button>
        )}

        <button
          type="button"
          onClick={toggleCategoryPicker}
          aria-label="Changer de rayon"
          title="Changer de rayon"
          className={`flex-shrink-0 text-xs ${
            showCategoryPicker ? "text-sage-dark" : "text-ink/30 hover:text-sage-dark"
          }`}
        >
          🏷
        </button>

        <button
          onClick={() => onDelete(item.id)}
          aria-label="Supprimer l'article"
          className="flex-shrink-0 text-ink/30 hover:text-brick"
        >
          ✕
        </button>
      </div>

      {showCategoryPicker && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-2">
          <select
            autoFocus
            value={item.category_id ?? ""}
            onChange={(e) => pickCategory(e.target.value)}
            aria-label="Rayon"
            className="rounded border border-sage bg-white px-1.5 py-1 text-xs focus:outline-none"
          >
            <option value="">Autres / Non classé</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          {/* An item whose name matched no dictionary entry has no food to
              re-file, so there is nothing to remember for next time. */}
          {item.food_id != null && (
            <label className="flex items-center gap-1.5 text-xs text-ink/60">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3.5 w-3.5 accent-sage"
              />
              Toujours classer cet aliment ici
            </label>
          )}
        </div>
      )}
    </li>
  );
}
