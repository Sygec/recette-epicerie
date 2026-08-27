import { NavLink } from "react-router-dom";
import { BookOpen, Calendar, Library, Plus, ShoppingCart, type LucideIcon } from "lucide-react";

// Five is what fits. Livres sits next to Recettes because that's the pairing
// you move between — a book is a place recipes come from. Aliments gave up
// this slot: it's the tab that gets used least, and it belongs beside the
// grocery list it exists to serve, so it's a button in the Courses header
// instead (see pages/GroceryList.tsx).
const items: { to: string; end?: boolean; label: string; icon: LucideIcon }[] = [
  { to: "/", end: true, label: "Recettes", icon: BookOpen },
  { to: "/livres", label: "Livres", icon: Library },
  { to: "/courses", label: "Courses", icon: ShoppingCart },
  { to: "/planification", label: "Planifier", icon: Calendar },
  { to: "/recettes/nouvelle", label: "Ajouter", icon: Plus },
];

export default function Nav() {
  return (
    <nav
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-2 right-2 z-20
                 flex items-center justify-around gap-0 rounded-full bg-white px-1 py-2
                 shadow-lg shadow-ink/15
                 sm:sticky sm:bottom-auto sm:left-auto sm:right-auto sm:top-4 sm:mx-6
                 sm:w-fit sm:justify-start sm:gap-2 sm:px-2 sm:shadow-md"
    >
      {items.map(({ to, end, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-2 text-[11px] font-medium leading-tight transition-colors sm:flex-none sm:px-4 sm:text-xs ${
              isActive ? "bg-ink/[0.06] text-sage-dark" : "text-ink/70 hover:text-ink"
            }`
          }
        >
          <Icon size={20} strokeWidth={2} aria-hidden className="sm:h-[22px] sm:w-[22px]" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
