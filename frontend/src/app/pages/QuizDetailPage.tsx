import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type Quiz } from "../lib/api";
import { isSlowConnection, studyCache } from "../lib/studyCache";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

export default function QuizDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const cacheUser = user?.id ?? "anonymous";

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const c = getThemeColors(theme);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setError(null);
    setAnswers({});
    setSubmitted(false);
    // A just-generated quiz arrives with the navigation; otherwise use the cached copy.
    const handedOver = (location.state as { item?: Quiz } | null)?.item;
    const known = handedOver?.id === id ? handedOver : studyCache.item<Quiz>(cacheUser, "quiz", id);
    setQuiz(known ?? null);
    setLoading(!known);
    if (known) studyCache.setItem(cacheUser, "quiz", known);
    // Quiz content never changes after generation; skip the refresh on slow connections.
    if (known && isSlowConnection()) return;
    api
      .getQuiz(id)
      .then(({ quiz }) => {
        studyCache.setItem(cacheUser, "quiz", quiz);
        if (active) setQuiz(quiz);
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

  const score = quiz ? quiz.questions.filter((q, i) => answers[i] === q.correctIndex).length : 0;

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
            <Link to="/quiz" className="text-[13px] flex items-center gap-1.5" style={{ color: c.mainSub }}>
              <ArrowLeft size={14} strokeWidth={2} />
              {t("quiz.all")}
            </Link>

            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : loading || !quiz ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                {t("loading")}
              </p>
            ) : (
              <>
                <h1 className="text-[22px] font-semibold" style={{ color: c.mainFg, ...JK }}>
                  {quiz.title}
                </h1>

                {submitted && (
                  <div className="rounded-xl p-4" style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}>
                    <p className="text-sm font-semibold" style={{ color: c.mainFg }}>
                      {t("quiz.score", { score, total: quiz.questions.length })}
                    </p>
                  </div>
                )}

                <div className="space-y-5">
                  {quiz.questions.map((q, qi) => {
                    const selected = answers[qi];
                    return (
                      <div key={qi} className="rounded-xl p-4" style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}>
                        <p className="text-[14px] font-medium mb-3" style={{ color: c.mainFg }}>
                          {qi + 1}. {q.question}
                        </p>
                        <div className="space-y-2">
                          {q.options.map((opt, oi) => {
                            const isSelected = selected === oi;
                            const isCorrect = submitted && oi === q.correctIndex;
                            const isWrongSelected = submitted && isSelected && oi !== q.correctIndex;
                            return (
                              <button
                                key={oi}
                                aria-pressed={isSelected}
                                disabled={submitted}
                                onClick={() => setAnswers(prev => ({ ...prev, [qi]: oi }))}
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-[13px] transition-colors disabled:cursor-default"
                                style={{
                                  color: c.mainFg,
                                  background: isSelected && !submitted ? c.userBubble : "transparent",
                                  border: `1px solid ${isCorrect ? "#34d399" : isWrongSelected ? "#e0365a" : c.chipBorder}`,
                                }}
                              >
                                {opt}
                                {isCorrect && <Check size={14} strokeWidth={2} style={{ color: "#34d399" }} />}
                                {isWrongSelected && <X size={14} strokeWidth={2} style={{ color: "#e0365a" }} />}
                              </button>
                            );
                          })}
                        </div>
                        {submitted && q.explanation && <p className="mt-3 text-sm" style={{ color: c.mainFg }}>{q.explanation}</p>}
                      </div>
                    );
                  })}
                </div>

                {submitted && <button onClick={() => { setAnswers({}); setSubmitted(false); }} className="rounded-full border px-5 py-2 text-sm" style={{ color: c.mainFg, borderColor: c.chipBorder }}>{t("quiz.tryAgain")}</button>}
                {!submitted && (
                  <button
                    onClick={() => setSubmitted(true)}
                    disabled={Object.keys(answers).length < quiz.questions.length}
                    className="px-5 py-2 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{ background: "#7c5af0", color: "#ffffff" }}
                  >
                    {t("quiz.submit")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
