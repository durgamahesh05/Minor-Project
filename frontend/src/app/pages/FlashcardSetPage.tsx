import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type FlashcardSet } from "../lib/api";
import { isSlowConnection, studyCache } from "../lib/studyCache";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

export default function FlashcardSetPage() {
  const { id } = useParams<{ id: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const cacheUser = user?.id ?? "anonymous";

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
    let active = true;
    setError(null);
    setIndex(0);
    setFlipped(false);
    // A just-generated set arrives with the navigation; otherwise use the cached copy.
    const handedOver = (location.state as { item?: FlashcardSet } | null)?.item;
    const known = handedOver?.id === id ? handedOver : studyCache.item<FlashcardSet>(cacheUser, "flashcards", id);
    setSet(known ?? null);
    setLoading(!known);
    if (known) studyCache.setItem(cacheUser, "flashcards", known);
    // Card content never changes after generation; skip the refresh on slow connections.
    if (known && isSlowConnection()) return;
    api
      .getFlashcardSet(id)
      .then(({ set }) => {
        studyCache.setItem(cacheUser, "flashcards", set);
        if (active) setSet(set);
      })
      .catch(error => { if (active && !known) setError(error instanceof Error ? error.message : t("study.loadError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cacheUser]);

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
              {t("flashcards.all")}
            </Link>

            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : loading || !set ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                {t("loading")}
              </p>
            ) : (
              <>
                <h1 className="text-[22px] font-semibold" style={{ color: c.mainFg, ...JK }}>
                  {set.title}
                </h1>

                {set.cards.length === 0 && <p style={{ color: c.mainSub }}>{t("flashcards.empty")}</p>}
                {card && (
                  <div className="flex flex-col items-center gap-4">
                    <button
                      onClick={() => setFlipped(f => !f)}
                      className="w-full max-w-[480px] aspect-[3/2] rounded-2xl flex items-center justify-center p-8 text-center transition-colors"
                      style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                    >
                      <div>
                        <p className="text-[11px] font-mono uppercase tracking-wide mb-3" style={{ color: c.mainSub }}>
                          {flipped ? t("flashcards.answer") : t("flashcards.question")} · {index + 1} / {set.cards.length}
                        </p>
                        <p className="text-[16px]" style={{ color: c.mainFg, ...JK }}>
                          {flipped ? card.back : card.front}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-3">
                      <button
                        aria-label={t("flashcards.previous")}
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
                        {t("flashcards.flip")}
                      </button>
                      <button
                        aria-label={t("flashcards.next")}
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
