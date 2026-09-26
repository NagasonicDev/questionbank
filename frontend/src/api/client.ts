import * as data from "../lib/data";
import { registerQuestionAssets, uploadAsset } from "../lib/assets";
import type {
  Course,
  CourseFullConfig,
  CourseNode,
  DifficultyLevel,
  GeneratedTestMeta,
  ImportResponse,
  LevelDef,
  Question,
  QuestionCountsResponse,
  QuestionListResponse,
  RandomQuestionResponse,
  Source,
  InstitutionYearFilter,
  TestSectionInput,
} from "./types";

export { assetUrl } from "../lib/assets";
export type {
  GeneratedTestMeta,
  ImportResponse,
  ImportResultItem,
  TestSectionInput,
  TestSectionResult,
} from "./types";

async function registerQuestion(q: Question | null): Promise<Question | null> {
  if (q) await registerQuestionAssets(q);
  return q;
}

async function registerRandom(q: RandomQuestionResponse): Promise<RandomQuestionResponse> {
  if (q.question) await registerQuestionAssets(q.question);
  return q;
}

export const api = {
  listCourses(): Promise<Course[]> {
    return data.listCourses();
  },

  createCourse(payload: {
    name: string;
    description?: string | null;
    subject?: string | null;
    hierarchy?: LevelDef[];
    difficulty_levels?: DifficultyLevel[];
    question_types?: string[];
  }): Promise<CourseFullConfig> {
    return data.createCourse(payload);
  },

  getCourse(courseId: string): Promise<CourseFullConfig> {
    return data.getCourseFullConfig(courseId) as Promise<CourseFullConfig>;
  },

  createNode(
    courseId: string,
    payload: { level_index: number; parent_node_id?: string | null; name: string; code?: string | null }
  ): Promise<CourseNode> {
    return data.createNode(courseId, payload);
  },

  updateNode(
    courseId: string,
    nodeId: string,
    payload: Partial<{
      name: string;
      code: string | null;
      description: string | null;
      sort_order: number;
      parent_node_id: string | null;
    }>
  ): Promise<CourseNode> {
    return data.updateNode(courseId, nodeId, payload);
  },

  deleteNode(courseId: string, nodeId: string): Promise<void> {
    return data.deleteNode(courseId, nodeId);
  },

  addLevel(courseId: string, level: LevelDef): Promise<LevelDef> {
    return data.addLevel(courseId, level);
  },

  updateLevel(courseId: string, levelIndex: number, level: LevelDef): Promise<LevelDef> {
    return data.updateLevel(courseId, levelIndex, level);
  },

  deleteLevel(courseId: string, levelIndex: number): Promise<void> {
    return data.deleteLevel(courseId, levelIndex);
  },

  getInstructions(courseId: string): Promise<{ course_id: string; instructions_markdown: string }> {
    return data.getInstructions(courseId);
  },

  skillDownloadUrl(courseId: string): string {
    // Placeholder kept for API-surface compatibility; real download is
    // triggered via downloadSkill() below.
    void courseId;
    return "";
  },

  downloadSkill(courseId: string): Promise<void> {
    return import("../lib/exchange").then((m) => m.downloadSkill(courseId));
  },

  exportCourse(courseId: string): Promise<void> {
    return import("../lib/exchange").then((m) => m.exportCourse(courseId));
  },

  importCourseFile(file: File): Promise<{ course_id: string; course_name: string }> {
    return import("../lib/exchange").then((m) => m.importCourseFile(file));
  },

  uploadAsset(
    file: File
  ): Promise<{ asset_path: string; mime_type: string; original_filename: string }> {
    return uploadAsset(file);
  },

  listQuestions(
    courseId: string,
    filters: { node_id?: string | string[]; type?: string | string[]; difficulty?: string | number | Array<string | number>; tag?: string; q?: string; sort?: string; page?: number; page_size?: number; source_filters?: InstitutionYearFilter[] } = {}
  ): Promise<QuestionListResponse> {
    return data.listQuestions(courseId, filters);
  },

  questionSourceOptions(courseId: string): Promise<{ institutions: Array<{ name: string; years: number[] }> }> {
    return data.questionSourceOptions(courseId);
  },

  renameInstitution(courseId: string, currentName: string, nextName: string): Promise<number> {
    return data.renameInstitution(courseId, currentName, nextName);
  },

  async getQuestion(id: string): Promise<Question> {
    const q = await data.getQuestion(id);
    return (await registerQuestion(q)) as Question;
  },

  async createQuestion(payload: Record<string, any>): Promise<Question> {
    const q = await data.createQuestion(payload as any);
    return (await registerQuestion(q)) as Question;
  },

  async updateQuestion(id: string, payload: Record<string, any>): Promise<Question> {
    const q = await data.updateQuestion(id, payload as any);
    return (await registerQuestion(q)) as Question;
  },

  deleteQuestion(id: string): Promise<void> {
    return data.deleteQuestion(id);
  },

  questionCounts(
    courseId: string,
    opts: {
      type?: string | string[];
      difficulty?: string | number;
      difficulties?: Array<string | number>;
      node_ids?: string[];
    } = {}
  ): Promise<QuestionCountsResponse> {
    return data.questionCounts(courseId, opts);
  },

  estimateTestSections(courseId: string, sections: TestSectionInput[]): Promise<Array<{ question_count: number; available_marks: number }>> {
    return data.estimateTestSections(courseId, sections);
  },

  randomQuestion(params: {
    course_id: string;
    node_id?: string | string[];
    type?: string | string[];
    difficulty?: string | number | Array<string | number>;
    tag?: string;
    exclude_question_ids?: Array<string | number>;
    exclude_recent_days?: number;
    source_filters?: InstitutionYearFilter[];
  }): Promise<RandomQuestionResponse> {
    return data.randomQuestion(params).then((r) => registerRandom(r));
  },

  recordAttempt(payload: {
    session_id?: string;
    question_id: string;
    status: string;
    correct?: boolean;
    time_spent_sec?: number;
    user_notes?: string;
  }): Promise<{ attempt_id: string }> {
    return data.recordAttempt(payload);
  },

  recentQuestions(
    courseId: string,
    limit: number = 10
  ): Promise<Array<{ question_id: string; course_id: string; snippet: string; type_key: string; status: string; seen_at: string }>> {
    return data.recentQuestions(courseId, limit);
  },

  generateTest(
    courseId: string,
    payload: {
      title?: string;
      node_ids?: string[];
      format: "docx" | "pdf";
      shuffle?: boolean;
      sections: TestSectionInput[];
      selectionTimeoutMs?: number;
      onProgress?: (progress: { phase: "selecting" | "hydrating" | "paper" | "solutions" | "preview" | "saving"; questionCount?: number }) => void;
    }
  ): Promise<GeneratedTestMeta> {
    return data.generateTest(courseId, payload);
  },

  listTests(courseId: string, limit: number = 20): Promise<GeneratedTestMeta[]> {
    return data.listTests(courseId, limit);
  },

  deleteTest(testId: string): Promise<void> {
    return data.deleteTest(testId);
  },

  testDownloadUrl(meta: Pick<GeneratedTestMeta, "test_download_url">): string {
    return meta.test_download_url;
  },

  testSolutionsUrl(meta: Pick<GeneratedTestMeta, "solutions_download_url">): string {
    return meta.solutions_download_url;
  },

  testPreviewUrl(meta: Pick<GeneratedTestMeta, "preview_url">): string {
    return meta.preview_url;
  },

  importJson(courseId: string, fileContent: Record<string, any>): Promise<ImportResponse> {
    return data.importJson(courseId, fileContent);
  },
};

export type { Source };
