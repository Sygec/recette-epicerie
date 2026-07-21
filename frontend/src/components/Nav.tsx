import { NavLink } from "react-router-dom";

const linkBase =
  "flex flex-col items-center gap-1 px-4 py-2 text-xs font-medium transition-colors";

export default function Nav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 flex justify-around
                 border-t border-line bg-paper/95 backdrop-blur
                 pb-[env(safe-area-inset-bottom)]
                 sm:sticky sm:top-0 sm:justify-start sm:gap-2 sm:border-b sm:border-t-0 sm:px-6 sm:py-3"
    >
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `${linkBase} ${isActive ? "text-sage-dark" : "text-ink/50 hover:text-ink"}`
        }
      >
        <span aria-hidden>📖</span>
        Recettes
      </NavLink>
      <NavLink
        to="/courses"
        className={({ isActive }) =>
          `${linkBase} ${isActive ? "text-sage-dark" : "text-ink/50 hover:text-ink"}`
        }
      >
        <span aria-hidden>🧺</span>
        Courses
      </NavLink>
      <NavLink
        to="/recettes/nouvelle"
        className={({ isActive }) =>
          `${linkBase} ${isActive ? "text-sage-dark" : "text-ink/50 hover:text-ink"}`
        }
      >
        <span aria-hidden>＋</span>
        Ajouter
      </NavLink>
    </nav>
  );
}
