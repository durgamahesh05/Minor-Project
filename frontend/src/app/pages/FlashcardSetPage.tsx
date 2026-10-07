import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type FlashcardSet } from "../lib/api";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

export default function FlashcardSetPage() {
  const { id } = useParams<{ id: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [set, setSet] = useState<FlashcardSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const c = getThemeColors(theme);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setIndex(0);
    setFlipped(false);
    api
      .getFlashcardSet(id)
      .then(({ set }) => setSet(set))
      .catch(error => setError(error instanceof Error ? error.message : "Unable to load study materials."))
      .finally(() => setLoading(false));
  }, [id]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const card = set?.cards[index];

  const goTo = (next: number) => {
    if (!set) return;
    setFlipped(false);
    setIndex(Math.max(0, Math.min(set.cards.length - 1, next)));
  };

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden" style={{ background: c.main, fontFamily: "'Inter', sans-serif" }}>
      <Sidebar
        c={c}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header c={c} sidebarOpen={sidebarOpen} onOpenSidebar={() => setSidebarOpen(true)} user={user} />

        <div role="main" className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-8">
          <div className="max-w-[680px] mx-auto space-y-6">
            <Link to="/flashcards" className="text-[13px] flex items-center gap-1.5" style={{ color: c.mainSub }}>
              <ArrowLeft size={14} strokeWidth={2} />
              All flashcard sets
            </Link>

            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : loading || !set ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                Loading…
              </p>
            ) : (
              <>
                <h1 className="text-[22px] font-semibold" style={{ color: c.mainFg, ...JK }}>
                  {set.title}
                </h1>

                {set.cards.length === 0 && <p style={{ color: c.mainSub }}>This set has no cards. Generate a new set from your documents.</p>}
                {card && (
                  <div className="flex flex-col items-center gap-4">
                    <button
                      onClick={() => setFlipped(f => !f)}
                      className="w-full max-w-[480px] aspect-[3/2] rounded-2xl flex items-center justify-center p-8 text-center transition-colors"
                      style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                    >
                      <div>
                        <p className="text-[11px] font-mono uppercase tracking-wide mb-3" style={{ color: c.mainSub }}>
                          {flipped ? "Answer" : "Question"} · {index + 1} / {set.cards.length}
                        </p>
                        <p className="text-[16px]" style={{ color: c.mainFg, ...JK }}>
                          {flipped ? card.back : card.front}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-3">
                      <button
                        aria-label="Previous card"
                        onClick={() => goTo(index - 1)}
                        disabled={index === 0}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-30"
                        style={{ color: c.mainSub }}
                      >
                        <ChevronLeft size={18} strokeWidth={2} />
                      </button>
                      <button
                        onClick={() => setFlipped(f => !f)}
                        className="px-4 py-1.5 rounded-full text-[13px] font-medium flex items-center gap-2 transition-opacity hover:opacity-80"
                        style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}`, color: c.mainFg }}
                      >
                        <RotateCw size={14} strokeWidth={2} />
                        Flip
                      </button>
                      <button
                        aria-label="Next card"
                        onClick={() => goTo(index + 1)}
                        disabled={index === set.cards.length - 1}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-30"
                        style={{ color: c.mainSub }}
                      >
                        <ChevronRight size={18} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
