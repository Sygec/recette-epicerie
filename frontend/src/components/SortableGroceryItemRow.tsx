import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import GroceryItemRow, { GroceryItemRowProps } from "./GroceryItemRow";

type Props = Omit<GroceryItemRowProps, "innerRef" | "style" | "dragHandle">;

// Wraps a row with drag behaviour for manual sort mode. Separate from
// GroceryItemRow because useSortable is a hook and category mode renders the
// same row without it.
export default function SortableGroceryItemRow(props: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.item.id });

  return (
    <GroceryItemRow
      {...props}
      innerRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Lift the row being dragged above its neighbours; without this it
        // slides underneath them.
        zIndex: isDragging ? 10 : undefined,
        position: isDragging ? "relative" : undefined,
        opacity: isDragging ? 0.9 : undefined,
      }}
      dragHandle={
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Réordonner"
          title="Glisser pour réordonner"
          className="flex-shrink-0 cursor-grab touch-none text-ink/25 hover:text-ink/50 active:cursor-grabbing"
        >
          ≡
        </button>
      }
    />
  );
}
