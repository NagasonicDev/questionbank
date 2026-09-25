import { createContext, useContext, useState, type ReactNode } from "react";

interface CourseContextValue {
  courseId: string | null;
  setCourseId: (id: string | null) => void;
}

const CourseContext = createContext<CourseContextValue | undefined>(undefined);

export function CourseProvider({ children }: { children: ReactNode }) {
  const [courseId, setCourseIdState] = useState<string | null>(
    () => localStorage.getItem("qb-active-course")
  );

  const setCourseId = (id: string | null) => {
    setCourseIdState(id);
    if (id) localStorage.setItem("qb-active-course", id);
    else localStorage.removeItem("qb-active-course");
  };

  return (
    <CourseContext.Provider value={{ courseId, setCourseId }}>
      {children}
    </CourseContext.Provider>
  );
}

export function useActiveCourse() {
  const ctx = useContext(CourseContext);
  if (!ctx) throw new Error("useActiveCourse must be used within CourseProvider");
  return ctx;
}
