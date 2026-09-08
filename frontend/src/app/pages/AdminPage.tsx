import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Users, FileText, ListChecks, Layers, MessageSquare, Trash2, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type AdminStats, type AdminUser, type AdminDocument, type AdminQuiz, type AdminFlashcardSet } from "../lib/api";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

type Tab = "users" | "documents" | "quizzes" | "flashcards";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("users");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [quizzes, setQuizzes] = useState<AdminQuiz[]>([]);
  const [flashcardSets, setFlashcardSets] = useState<AdminFlashcardSet[]>([]);

  const c = getThemeColors(theme);

  useEffect(() => {
    api.adminStats().then(setStats);
  }, []);

  useEffect(() => {
    setLoading(true);
    const load =
      tab === "users"
        ? api.adminListUsers().then(({ users }) => setUsers(users))
        : tab === "documents"
          ? api.adminListDocuments().then(({ documents }) => setDocuments(documents))
          : tab === "quizzes"
            ? api.adminListQuizzes().then(({ quizzes }) => setQuizzes(quizzes))
            : api.adminListFlashcardSets().then(({ sets }) => setFlashcardSets(sets));
    load.finally(() => setLoading(false));
  }, [tab]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm("Delete this user and all of their documents, quizzes, flashcards, and chats? This can't be undone.")) return;
    setBusyId(id);
    try {
      await api.adminDeleteUser(id);
      setUsers(prev => prev.filter(u => u.id !== id));
      setStats(prev => (prev ? { ...prev, totalUsers: prev.totalUsers - 1 } : prev));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    setBusyId(id);
    try {
      await api.adminDeleteDocument(id);
      setDocuments(prev => prev.filter(d => d.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteQuiz = async (id: string) => {
    setBusyId(id);
    try {
      await api.adminDeleteQuiz(id);
      setQuizzes(prev => prev.filter(q => q.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteFlashcardSet = async (id: string) => {
    setBusyId(id);
    try {
      await api.adminDeleteFlashcardSet(id);
      setFlashcardSets(prev => prev.filter(s => s.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "users", label: "Users", icon: Users },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "quizzes", label: "Quizzes", icon: ListChecks },
    { id: "flashcards", label: "Flashcards", icon: Layers },
  ];

  const statCards = stats
    ? [
        { label: "Users", value: stats.totalUsers, icon: Users },
        { label: "Documents", value: stats.totalDocuments, icon: FileText },
        { label: "Quizzes", value: stats.totalQuizzes, icon: ListChecks },
        { label: "Flashcard sets", value: stats.totalFlashcardSets, icon: Layers },
        { label: "Conversations", value: stats.totalConversations, icon: MessageSquare },
      ]
    : [];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: c.main, fontFamily: "'Inter', sans-serif" }}>
      <Sidebar
        c={c}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header c={c} sidebarOpen={sidebarOpen} onOpenSidebar={() => setSidebarOpen(true)} user={user} />

        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-[980px] mx-auto space-y-6">
            <div className="flex items-center gap-2.5">
              <ShieldCheck size={20} strokeWidth={1.5} style={{ color: "#7c5af0" }} />
              <h1 className="text-[22px] font-semibold" style={{ color: c.mainFg, ...JK }}>
                Admin
              </h1>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {statCards.map(s => (
                <div key={s.label} className="rounded-xl p-4" style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}>
                  <s.icon size={15} strokeWidth={1.5} style={{ color: c.mainSub }} />
                  <p className="text-[22px] font-semibold mt-2 tabular-nums" style={{ color: c.mainFg, ...JK }}>
                    {s.value}
                  </p>
                  <p className="text-[11px] font-mono" style={{ color: c.mainSub }}>
                    {s.label}
                  </p>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b" style={{ borderColor: c.chipBorder }}>
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-colors"
                  style={{
                    color: tab === t.id ? c.mainFg : c.mainSub,
                    borderBottom: tab === t.id ? "2px solid #7c5af0" : "2px solid transparent",
                  }}
                >
                  <t.icon size={14} strokeWidth={1.5} />
                  {t.label}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                Loading…
              </p>
            ) : (
              <div className="space-y-2">
                {tab === "users" &&
                  users.map(u => (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl"
                      style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate" style={{ color: c.mainFg }}>
                          {u.name} {u.role === "admin" && <span style={{ color: "#7c5af0" }}>· admin</span>}
                        </p>
                        <p className="text-[11px] font-mono truncate" style={{ color: c.mainSub }}>
                          {u.email} · joined {new Date(u.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      {u.id !== user?.id && (
                        <button
                          title="Delete user"
                          disabled={busyId === u.id}
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40 flex-shrink-0"
                          style={{ color: "#e0365a" }}
                        >
                          <Trash2 size={16} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  ))}

                {tab === "documents" &&
                  documents.map(d => (
                    <div
                      key={d.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl"
                      style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate" style={{ color: c.mainFg }}>
                          {d.originalName}
                        </p>
                        <p className="text-[11px] font-mono truncate" style={{ color: c.mainSub }}>
                          {formatSize(d.size)} · {d.owner ? `${d.owner.name} (${d.owner.email})` : "unknown owner"}
                        </p>
                      </div>
                      <button
                        title="Delete document"
                        disabled={busyId === d.id}
                        onClick={() => handleDeleteDocument(d.id)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40 flex-shrink-0"
                        style={{ color: "#e0365a" }}
                      >
                        <Trash2 size={16} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}

                {tab === "quizzes" &&
                  quizzes.map(q => (
                    <div
                      key={q.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl"
                      style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate" style={{ color: c.mainFg }}>
                          {q.title}
                        </p>
                        <p className="text-[11px] font-mono truncate" style={{ color: c.mainSub }}>
                          {q.questionCount} questions · {q.owner ? `${q.owner.name} (${q.owner.email})` : "unknown owner"}
                        </p>
                      </div>
                      <button
                        title="Delete quiz"
                        disabled={busyId === q.id}
                        onClick={() => handleDeleteQuiz(q.id)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40 flex-shrink-0"
                        style={{ color: "#e0365a" }}
                      >
                        <Trash2 size={16} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}

                {tab === "flashcards" &&
                  flashcardSets.map(s => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl"
                      style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate" style={{ color: c.mainFg }}>
                          {s.title}
                        </p>
                        <p className="text-[11px] font-mono truncate" style={{ color: c.mainSub }}>
                          {s.cardCount} cards · {s.owner ? `${s.owner.name} (${s.owner.email})` : "unknown owner"}
                        </p>
                      </div>
                      <button
                        title="Delete flashcard set"
                        disabled={busyId === s.id}
                        onClick={() => handleDeleteFlashcardSet(s.id)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40 flex-shrink-0"
                        style={{ color: "#e0365a" }}
                      >
                        <Trash2 size={16} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
