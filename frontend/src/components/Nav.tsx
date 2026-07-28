import { NavLink } from "react-router-dom";
import { BookOpen, Calendar, Plus, ShoppingCart, type LucideIcon } from "lucide-react";

const items: { to: string; end?: boolean; label: string; icon: LucideIcon }[] = [
  { to: "/", end: true, label: "Recettes", icon: BookOpen },
  { to: "/courses", label: "Courses", icon: ShoppingCart },
  { to: "/planification", label: "Planifier", icon: Calendar },
  { to: "/recettes/nouvelle", label: "Ajouter", icon: Plus },
];

export default function Nav() {
  return (
    <nav
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-4 right-4 z-20
                 flex items-center justify-around gap-1 rounded-full bg-white px-2 py-2
                 shadow-lg shadow-ink/15
                 sm:sticky sm:bottom-auto sm:left-auto sm:right-auto sm:top-4 sm:mx-6
                 sm:w-fit sm:justify-start sm:gap-2 sm:shadow-md"
    >
      {items.map(({ to, end, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 rounded-full px-4 py-2 text-xs font-medium transition-colors ${
              isActive ? "bg-ink/[0.06] text-sage-dark" : "text-ink/70 hover:text-ink"
            }`
          }
        >
          <Icon size={22} strokeWidth={2} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
