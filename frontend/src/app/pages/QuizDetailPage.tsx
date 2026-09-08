import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { ArrowLeft, Check, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type Quiz } from "../lib/api";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

export default function QuizDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const c = getThemeColors(theme);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setAnswers({});
    setSubmitted(false);
    api
      .getQuiz(id)
      .then(({ quiz }) => setQuiz(quiz))
      .finally(() => setLoading(false));
  }, [id]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const score = quiz ? quiz.questions.filter((q, i) => answers[i] === q.correctIndex).length : 0;

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
          <div className="max-w-[680px] mx-auto space-y-6">
            <Link to="/quiz" className="text-[13px] flex items-center gap-1.5" style={{ color: c.mainSub }}>
              <ArrowLeft size={14} strokeWidth={2} />
              All quizzes
            </Link>

            {loading || !quiz ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                Loading…
              </p>
            ) : (
              <>
                <h1 className="text-[22px] font-semibold" style={{ color: c.mainFg, ...JK }}>
                  {quiz.title}
                </h1>

                {submitted && (
                  <div className="rounded-xl p-4" style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}>
                    <p className="text-sm font-semibold" style={{ color: c.mainFg }}>
                      Score: {score} / {quiz.questions.length}
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
                      </div>
                    );
                  })}
                </div>

                {!submitted && (
                  <button
                    onClick={() => setSubmitted(true)}
                    disabled={Object.keys(answers).length < quiz.questions.length}
                    className="px-5 py-2 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{ background: "#7c5af0", color: "#ffffff" }}
                  >
                    Submit
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
