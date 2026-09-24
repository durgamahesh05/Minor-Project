import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Layers, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type FlashcardSetSummary } from "../lib/api";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

export default function FlashcardsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sets, setSets] = useState<FlashcardSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const c = getThemeColors(theme);

  useEffect(() => {
    api
      .listFlashcardSets()
      .then(({ sets }) => setSets(sets))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      const { set } = await api.createFlashcardSet();
      navigate(`/flashcards/${set.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate flashcard set.");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setDeletingId(id);
    try {
      await api.deleteFlashcardSet(id);
      setSets(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete flashcard set. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

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
          <div className="max-w-[820px] mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-[22px] font-semibold" style={{ color: c.mainFg, ...JK }}>
                  Flashcards
                </h1>
                <p className="text-[13px] mt-1" style={{ color: c.mainSub }}>
                  Generate a set from a document on the Dashboard, or start a general one here.
                </p>
              </div>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "#7c5af0", color: "#ffffff" }}
              >
                <Plus size={14} strokeWidth={2} />
                {creating ? "Generating…" : "New set"}
              </button>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {loading ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                Loading…
              </p>
            ) : sets.length === 0 ? (
              <div className="rounded-2xl p-10 text-center" style={{ background: c.chipBg, border: `1px dashed ${c.chipBorder}` }}>
                <Layers size={28} strokeWidth={1.5} style={{ color: c.mainSub, margin: "0 auto" }} />
                <p className="text-sm mt-3" style={{ color: c.mainSub }}>
                  No flashcard sets yet.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {sets.map(set => (
                  <div
                    key={set.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer"
                    style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                    onClick={() => navigate(`/flashcards/${set.id}`)}
                  >
                    <Layers size={18} strokeWidth={1.5} style={{ color: c.mainSub }} className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: c.mainFg }}>
                        {set.title}
                      </p>
                      <p className="text-[11px] font-mono" style={{ color: c.mainSub }}>
                        {new Date(set.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      title="Delete"
                      disabled={deletingId !== null}
                      onClick={e => {
                        e.stopPropagation();
                        handleDelete(set.id);
                      }}
                      className="p-2 rounded-lg transition-opacity hover:opacity-70 flex-shrink-0"
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
