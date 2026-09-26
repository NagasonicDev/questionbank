import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useIsFetching } from "@tanstack/react-query";
import { Menu, Moon, Sun, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useTheme } from "../hooks/useTheme";
import { CourseSelector } from "./CourseSelector";
import { RecentQuestionsSidebar } from "./RecentQuestionsSidebar";
import { Button } from "./ui/button";
import { useActiveCourse } from "../hooks/useActiveCourse";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/browse", label: "Question Bank" },
  { to: "/practice", label: "Practice" },
  { to: "/test-generator", label: "Test Generator" },
  { to: "/import", label: "Import" },
  { to: "/course-settings", label: "Course Settings" },
  { to: "/settings", label: "Settings" },
];

const linkBase =
  "rounded-md px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground";
const linkActive = "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground";

export function Layout() {
  const { courseId } = useActiveCourse();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isFetching = useIsFetching() > 0;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="ledger-wash" />

      <div className="global-loading-track" aria-hidden="true">
        {isFetching && <div className="global-loading-bar" />}
      </div>

      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto grid h-14 max-w-[1500px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 sm:flex sm:px-5">
          <Link
            to="/"
            className="font-display shrink-0 text-xl font-semibold"
            onClick={() => setMobileOpen(false)}
          >
            Quaestio<span className="text-accent-foreground">.</span>
          </Link>

          <CourseSelector />

          <nav className="ml-auto hidden items-center gap-0.5 xl:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn(linkBase, isActive && linkActive)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="bg-surface/60"
              onClick={toggle}
              aria-label="Toggle theme"
            >
              {theme === "light" ? <Sun /> : <Moon />}
              <span className="hidden md:inline">{theme === "light" ? "Light" : "Dark"}</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="xl:hidden"
              aria-label="Toggle menu"
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="grid border-t border-border bg-background p-3 sm:grid-cols-3 xl:hidden">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground",
                    isActive && "bg-secondary text-foreground"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <div className={cn("relative z-10 mx-auto grid max-w-[1500px] gap-6 px-4 py-6 sm:px-5", courseId && "md:grid-cols-[238px_minmax(0,1fr)]")}>
        {courseId && <RecentQuestionsSidebar />}
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
