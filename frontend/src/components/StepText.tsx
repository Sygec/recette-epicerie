import { useEffect, useMemo, useRef } from "react";
import { segmentStep } from "../lib/ingredientMatch";

export interface StepIngredient {
  id: string | number;
  name: string;
  /** Already scaled to the chosen servings, so the tooltip agrees with the
   *  ingredient list above it. */
  quantity: number | null;
  unit: string | null;
}

interface Props {
  stepId: number;
  text: string;
  ingredients: StepIngredient[];
  /** Which mention is showing its tooltip, shared across every step so only
   *  one is ever open. */
  openKey: string | null;
  onOpenChange: (key: string | null) => void;
}

function amountLabel(ing: StepIngredient): string {
  const amount = [ing.quantity ?? "", ing.unit ?? ""].join(" ").trim();
  return amount || "Quantité non précisée";
}

// Renders a step with its ingredient mentions highlighted; each one shows the
// quantity from the ingredient list on hover (mouse) or tap (touch).
export default function StepText({
  stepId,
  text,
  ingredients,
  openKey,
  onOpenChange,
}: Props) {
  const segments = useMemo(() => segmentStep(text, ingredients), [text, ingredients]);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  // A tap fires pointerenter before click on touch, so opening on hover and
  // toggling on click would open then immediately close. Remember how the
  // interaction started and let only one of the two act.
  const lastPointerType = useRef<string>("mouse");

  useEffect(() => {
    if (openKey == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openKey, onOpenChange]);

  return (
    <p className="text-sm leading-relaxed">
      {segments.map((segment, index) => {
        const ingredient =
          segment.ingredientId != null ? byId.get(segment.ingredientId) : undefined;
        if (!ingredient) return <span key={index}>{segment.text}</span>;

        const key = `${stepId}:${index}`;
        const isOpen = openKey === key;

        return (
          <span key={index} className="relative inline-block">
            <button
              type="button"
              onPointerDown={(e) => {
                lastPointerType.current = e.pointerType;
              }}
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") onOpenChange(key);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") onOpenChange(null);
              }}
              onClick={() => {
                // Mouse users already got it on hover; acting again here
                // would just close what they are looking at.
                if (lastPointerType.current !== "mouse") {
                  onOpenChange(isOpen ? null : key);
                }
              }}
              // Keyboard focus should reveal the tooltip, but a tap also
              // focuses the button — and focus fires before click, so opening
              // here unconditionally made the click handler toggle it right
              // back shut. :focus-visible is false for pointer-driven focus,
              // which is exactly the distinction needed.
              onFocus={(e) => {
                if (e.currentTarget.matches(":focus-visible")) onOpenChange(key);
              }}
              onBlur={() => onOpenChange(null)}
              aria-describedby={isOpen ? `tip-${key}` : undefined}
              aria-label={`${segment.text} — ${amountLabel(ingredient)}`}
              className="rounded bg-mustard/25 px-0.5 font-medium decoration-mustard-dark/60 decoration-dotted underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sage"
            >
              {segment.text}
            </button>

            {isOpen && (
              <span
                role="tooltip"
                id={`tip-${key}`}
                className="absolute bottom-full left-1/2 z-30 mb-1 w-max max-w-[60vw]
                           -translate-x-1/2 rounded-card border border-line bg-white
                           px-2 py-1 text-left text-xs font-normal leading-snug
                           text-ink shadow-lg shadow-ink/10"
              >
                <span className="block font-mono font-medium text-sage-dark">
                  {amountLabel(ingredient)}
                </span>
                <span className="block text-ink/60">{ingredient.name}</span>
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}
