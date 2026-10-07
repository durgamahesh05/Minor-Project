import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { LanguageProvider } from "./context/LanguageContext";
import { Skeleton } from "./components/ui/skeleton";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const QuizPage = lazy(() => import("./pages/QuizPage"));
const QuizDetailPage = lazy(() => import("./pages/QuizDetailPage"));
const FlashcardsPage = lazy(() => import("./pages/FlashcardsPage"));
const FlashcardSetPage = lazy(() => import("./pages/FlashcardSetPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));

function AppSkeleton() {
  return (
    <div className="flex h-screen bg-background" role="status" aria-label="Loading application">
      <aside className="hidden w-64 border-r p-4 md:block">
        <Skeleton className="mb-8 h-9 w-32" />
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
        </div>
      </aside>
      <main className="flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex items-center justify-between"><Skeleton className="h-9 w-48" /><Skeleton className="h-9 w-24" /></div>
          <Skeleton className="h-32 w-full rounded-xl" />
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
          </div>
        </div>
      </main>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <AppSkeleton />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <AppSkeleton />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== "admin") {
    return <Navigate to="/chat" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/quiz"
        element={
          <ProtectedRoute>
            <QuizPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/quiz/:id"
        element={
          <ProtectedRoute>
            <QuizDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/flashcards"
        element={
          <ProtectedRoute>
            <FlashcardsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/flashcards/:id"
        element={
          <ProtectedRoute>
            <FlashcardSetPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider><AuthProvider><BrowserRouter><Suspense fallback={<AppSkeleton />}><AppRoutes /></Suspense></BrowserRouter></AuthProvider></LanguageProvider>
    </ThemeProvider>
  );
}
