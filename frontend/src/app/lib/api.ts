const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...(options.headers ?? {}) },
      ...options,
    });
  } catch {
    throw new ApiError(0, `Cannot connect to the API at ${API_URL}. Make sure the backend is running.`);
  }

  // FastAPI returns an empty body for successful DELETE requests.
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, body?.message ?? body?.detail ?? res.statusText);
  }
  return body as T;
}

export type User = { id: string; name: string; email: string; role: "user" | "admin" };
export type Conversation = { id: string; title: string; updatedAt: string };
export type Message = { id: string; role: "user" | "assistant"; text: string; createdAt: string };
export type Document = {
  id: string;
  clientDocumentId?: string;
  storageProvider?: "browser-opfs" | "supabase" | "local";
  originalName: string;
  mimeType: string;
  size: number;
  status: "uploading" | "processing" | "ready" | "indexed" | "failed";
  createdAt: string;
};
export type QuizQuestion = { question: string; options: string[]; correctIndex: number };
export type Quiz = { id: string; title: string; documentId: string | null; questions: QuizQuestion[]; createdAt: string };
export type QuizSummary = Omit<Quiz, "questions">;
export type Flashcard = { front: string; back: string };
export type FlashcardSet = { id: string; title: string; documentId: string | null; cards: Flashcard[]; createdAt: string };
export type FlashcardSetSummary = Omit<FlashcardSet, "cards">;

export type AdminStats = {
  totalUsers: number;
  totalDocuments: number;
  totalQuizzes: number;
  totalFlashcardSets: number;
  totalConversations: number;
};
export type AdminUser = { id: string; name: string; email: string; role: "user" | "admin"; createdAt: string };
export type Owner = { id: string; name: string; email: string } | null;
export type AdminDocument = { id: string; originalName: string; mimeType: string; size: number; createdAt: string; owner: Owner };
export type AdminQuiz = { id: string; title: string; questionCount: number; createdAt: string; owner: Owner };
export type AdminFlashcardSet = { id: string; title: string; cardCount: number; createdAt: string; owner: Owner };

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  register: (name: string, email: string, password: string) =>
    request<{ message: string; email: string; otp?: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),
  verifyRegistration: (email: string, otp: string) =>
    request<{ user: User }>("/api/auth/verify-registration", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    }),
  resendRegistrationOtp: (email: string) =>
    request<{ message: string; otp?: string }>("/api/auth/resend-registration-otp", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  forgotPassword: (email: string) =>
    request<{ message: string; expiresIn: number; resendCooldown: number; otp?: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resendPasswordOtp: (email: string) =>
    request<{ message: string; expiresIn: number; resendCooldown: number; otp?: string }>("/api/auth/resend-password-otp", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyPasswordOtp: (email: string, otp: string) =>
    request<{ message: string; token: string; expiresIn: number }>("/api/auth/verify-password-otp", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    }),
  resetPassword: (token: string, password: string, confirmPassword: string) =>
    request<{ message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password, confirmPassword }),
    }),

  listConversations: () => request<{ conversations: Conversation[] }>("/api/chat/conversations"),
  createConversation: (title?: string) =>
    request<{ conversation: Conversation }>("/api/chat/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (id: string) =>
    request<void>(`/api/chat/conversations/${id}`, { method: "DELETE" }),
  getMessages: (conversationId: string) =>
    request<{ messages: Message[] }>(`/api/chat/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, text: string, language = "auto", documentId?: string) =>
    request<{ userMessage: Message; assistantMessage: Message }>(
      `/api/chat/conversations/${conversationId}/messages`,
      { method: "POST", body: JSON.stringify({ text, language, documentId }) },
    ),

  listDocuments: () => request<{ documents: Document[] }>("/api/documents"),
  uploadDocument: (file: File, clientDocumentId: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("client_document_id", clientDocumentId);
    return request<{ document: Document }>("/api/documents", { method: "POST", body: formData });
  },
  documentDownloadUrl: (id: string) => `${API_URL}/api/documents/${id}/download`,
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),

  listQuizzes: () => request<{ quizzes: QuizSummary[] }>("/api/quizzes"),
  getQuiz: (id: string) => request<{ quiz: Quiz }>(`/api/quizzes/${id}`),
  createQuiz: (documentId?: string) =>
    request<{ quiz: Quiz }>("/api/quizzes", { method: "POST", body: JSON.stringify({ documentId }) }),
  deleteQuiz: (id: string) => request<void>(`/api/quizzes/${id}`, { method: "DELETE" }),

  listFlashcardSets: () => request<{ sets: FlashcardSetSummary[] }>("/api/flashcards"),
  getFlashcardSet: (id: string) => request<{ set: FlashcardSet }>(`/api/flashcards/${id}`),
  createFlashcardSet: (documentId?: string) =>
    request<{ set: FlashcardSet }>("/api/flashcards", { method: "POST", body: JSON.stringify({ documentId }) }),
  deleteFlashcardSet: (id: string) => request<void>(`/api/flashcards/${id}`, { method: "DELETE" }),

  adminStats: () => request<AdminStats>("/api/admin/stats"),
  adminListUsers: () => request<{ users: AdminUser[] }>("/api/admin/users"),
  adminDeleteUser: (id: string) => request<void>(`/api/admin/users/${id}`, { method: "DELETE" }),
  adminListDocuments: () => request<{ documents: AdminDocument[] }>("/api/admin/documents"),
  adminDeleteDocument: (id: string) => request<void>(`/api/admin/documents/${id}`, { method: "DELETE" }),
  adminListQuizzes: () => request<{ quizzes: AdminQuiz[] }>("/api/admin/quizzes"),
  adminDeleteQuiz: (id: string) => request<void>(`/api/admin/quizzes/${id}`, { method: "DELETE" }),
  adminListFlashcardSets: () => request<{ sets: AdminFlashcardSet[] }>("/api/admin/flashcards"),
  adminDeleteFlashcardSet: (id: string) => request<void>(`/api/admin/flashcards/${id}`, { method: "DELETE" }),

  requestAccountDeletion: () => request<{ message: string; email: string; otp?: string }>("/api/account/delete/request", { method: "POST" }),
  confirmAccountDeletion: (otp: string) =>
    request<void>("/api/account/delete/confirm", { method: "POST", body: JSON.stringify({ otp }) }),

};
