import { HashRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseProvider } from "./hooks/useActiveCourse";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Browser } from "./pages/Browser";
import { Practice } from "./pages/Practice";
import { TestGenerator } from "./pages/TestGenerator";
import { QuestionDetail } from "./pages/QuestionDetail";
import { Import } from "./pages/Import";
import { CourseSettings } from "./pages/CourseSettings";
import { Settings } from "./pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CourseProvider>
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="browse" element={<Browser />} />
              <Route path="practice" element={<Practice />} />
              <Route path="test-generator" element={<TestGenerator />} />
              <Route path="questions/:questionId" element={<QuestionDetail />} />
              <Route path="import" element={<Import />} />
              <Route path="course-settings" element={<CourseSettings />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </HashRouter>
      </CourseProvider>
    </QueryClientProvider>
  );
}
