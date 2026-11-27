import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Layers, ListChecks, Pencil, Trash2, Upload, FileText } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type FlashcardSetSummary, type Document } from "../lib/api";
import { studyCache } from "../lib/studyCache";
import { useLanguage } from "../context/LanguageContext";
import { beginLocalDocument, deleteLocalDocument, markLocalDocumentIndexed } from "../lib/documentStorage";
import { formatList, useUploadConfig, validateFiles } from "../lib/uploadConfig";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

export default function StudyDashboard({ kind }: { kind: "quiz" | "flashcards" }) {
  const isQuiz = kind === "quiz";
  const Icon = isQuiz ? ListChecks : Layers;
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const cacheUser = user?.id ?? "anonymous";

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  // Show the last known lists immediately; the server response replaces them.
  const [sets, setSets] = useState<FlashcardSetSummary[]>(() => studyCache.list(cacheUser, kind) ?? []);
  const [loading, setLoading] = useState(() => !studyCache.list(cacheUser, kind));
  const [documents, setDocuments] = useState<Document[]>(() => (studyCache.documents(cacheUser) ?? []).filter(document => document.status === "indexed"));
  const [documentId, setDocumentId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadConfig = useUploadConfig();
  const busy = creating || uploading;
  const c = getThemeColors(theme);

  const handleUpload = async (file?: File) => {
    if (!file || busy) return;
    setError(null);
    const invalid = validateFiles([file], uploadConfig);
    if (invalid) {
      setError(invalid);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setUploading(true);
    setProgress(0);
    let localId: string | undefined;
    try {
      localId = await beginLocalDocument(file);
      const { document } = await api.uploadDocument(file, localId, setProgress);
      await markLocalDocumentIndexed(document);
      setDocuments(previous => [document, ...previous.filter(item => item.id !== document.id)]);
      studyCache.setDocuments(cacheUser, [document, ...(studyCache.documents(cacheUser) ?? []).filter(item => item.id !== document.id)]);
      setDocumentId(document.id);
    } catch (error) {
      if (localId) await deleteLocalDocument(localId).catch(() => {});
      setError(error instanceof Error ? error.message : t("study.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  useEffect(() => {
    let active = true;
    const cached = studyCache.list(cacheUser, kind);
    setSets(cached ?? []);
    setLoading(!cached);
    // Lists and documents load in parallel; each updates the page as soon as it arrives.
    const lists = (isQuiz ? api.listQuizzes().then(result => result.quizzes) : api.listFlashcardSets().then(result => result.sets))
      .then(items => {
        studyCache.setList(cacheUser, kind, items);
        if (active) setSets(items);
      });
    const docs = api.listDocuments().then(({ documents }) => {
      studyCache.setDocuments(cacheUser, documents);
      if (active) setDocuments(documents.filter(document => document.status === "indexed"));
    });
    Promise.all([lists, docs])
      .catch(error => { if (active) setError(error instanceof Error ? error.message : t("study.loadError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isQuiz, cacheUser]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      // Study materials are written in the selected language ("auto" follows the request's language).
      const options = { title: name.trim() || undefined, language };
      const result = isQuiz ? await api.createQuiz(documentId || undefined, options) : await api.createFlashcardSet(documentId || undefined, options);
      const item = "quiz" in result ? result.quiz : result.set;
      studyCache.added(cacheUser, kind, item);
      // Hand the generated content to the detail page so it opens without another request.
      navigate(`/${kind}/${item.id}`, { state: { item } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t(isQuiz ? "study.quizError" : "study.flashcardsError"));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setDeletingId(id);
    try {
      if (isQuiz) await api.deleteQuiz(id); else await api.deleteFlashcardSet(id);
      setSets(prev => prev.filter(s => s.id !== id));
      studyCache.removed(cacheUser, kind, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(isQuiz ? "study.deleteQuizError" : "study.deleteFlashcardsError"));
    } finally {
      setDeletingId(null);
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.renameStudyMaterial(kind, id, editName.trim());
      setSets(previous => previous.map(item => item.id === id ? { ...item, title: editName.trim() } : item));
      studyCache.renamed(cacheUser, kind, id, editName.trim());
      setEditingId(null);
    } catch (error) { setError(error instanceof Error ? error.message : t("study.renameError")); }
    finally { setSaving(false); }
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
          <div className="max-w-[820px] mx-auto space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-[22px] font-semibold" style={{ color: c.mainFg, ...JK }}>
                  {isQuiz ? t("study.quizzes") : t("study.flashcards")}
                </h1>
                <p className="text-[13px] mt-1" style={{ color: c.mainSub }}>
                  {t("study.subtitle")}
                </p>
              </div>
            </div>

            <section className="rounded-2xl p-5" style={{ background: c.chipBg, border: `1px dashed ${c.chipBorder}` }} aria-label={isQuiz ? t("study.generateQuiz") : t("study.generateFlashcards")}>
              <h2 className="text-lg font-semibold mb-4" style={{ color: c.mainFg }}>{isQuiz ? t("study.generateQuiz") : t("study.generateFlashcards")}</h2>
              <input ref={fileInput} type="file" className="sr-only" aria-label={t("study.uploadAria")}
                accept={uploadConfig.accept} disabled={busy}
                onChange={event => { void handleUpload(event.target.files?.[0]); }} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}
                className="w-full flex flex-col items-center justify-center gap-3 py-10 rounded-xl disabled:opacity-60"
                style={{ color: c.mainFg }}>
                <Upload size={34} strokeWidth={1.5} style={{ color: "#9b7bff" }} />
                <span className="font-medium">{uploading ? (progress < 100 ? t("study.uploadingPercent", { percent: progress }) : t("study.processingDocument")) : t("study.uploadDocument")}</span>
                <span className="text-xs" style={{ color: c.mainSub }}>{t("study.formatsLimit", { formats: formatList(uploadConfig), size: uploadConfig.maxFileSizeMb })}</span>
              </button>
              {documents.length > 0 && <details className="mb-4" open={!!documentId}>
                <summary className="cursor-pointer text-sm" style={{ color: c.mainSub }}>{t("study.useUploaded")}</summary>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button disabled={busy} onClick={() => setDocumentId("")} aria-pressed={!documentId}
                    className="border rounded-lg px-3 py-2 text-xs" style={{ color: c.mainFg, borderColor: !documentId ? "#7c5af0" : c.chipBorder }}>{t("study.allIndexed")}</button>
                  {documents.map(document => <button key={document.id} disabled={busy} onClick={() => setDocumentId(document.id)}
                    aria-pressed={documentId === document.id} className="flex items-center gap-2 border rounded-lg px-3 py-2 text-xs max-w-full"
                    style={{ color: c.mainFg, borderColor: documentId === document.id ? "#7c5af0" : c.chipBorder }}>
                    <FileText size={14} className="shrink-0" /><span className="truncate">{document.originalName}</span>
                  </button>)}
                </div>
              </details>}
              {!loading && documents.length === 0 && <p className="text-sm mb-4" style={{ color: c.mainSub }}>{t("study.uploadToBegin")}</p>}
              <div className="flex flex-wrap items-end justify-end gap-3">
                <label className="flex-1 min-w-48 text-sm" style={{ color: c.mainFg }}>{isQuiz ? t("study.quizName") : t("study.flashcardName")}
                  <input value={name} onChange={event => setName(event.target.value)} disabled={busy} maxLength={120} placeholder={t("study.namePlaceholder")}
                    className="block w-full border rounded-xl p-3 mt-2" style={{ background: c.main, borderColor: c.chipBorder }} />
                </label>
                <button onClick={handleCreate} disabled={busy || loading || documents.length === 0}
                  className="rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "#7c5af0", color: "white" }}>
                  {creating ? t("study.generating") : t("study.generate")}
                </button>
              </div>
            </section>

            <h2 className="text-lg font-semibold" style={{ color: c.mainFg }}>{isQuiz ? t("study.recentQuizzes") : t("study.recentFlashcards")}</h2>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {loading ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                {t("loading")}
              </p>
            ) : sets.length === 0 ? (
              <div className="rounded-2xl p-10 text-center" style={{ background: c.chipBg, border: `1px dashed ${c.chipBorder}` }}>
                <Icon size={28} strokeWidth={1.5} style={{ color: c.mainSub, margin: "0 auto" }} />
                <p className="text-sm mt-3" style={{ color: c.mainSub }}>
                  {isQuiz ? t("study.noQuizzes") : t("study.noFlashcards")}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sets.map(set => (
                  <div
                    key={set.id}
                    className="flex flex-wrap items-start gap-3 p-5 min-h-40 rounded-2xl"
                    style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                  >
                    <Icon size={18} strokeWidth={1.5} style={{ color: c.mainSub }} className="flex-shrink-0" />
                    <button onClick={() => navigate(`/${kind}/${set.id}`)} className="flex-1 min-w-0 text-left">
                      <p className="text-[13px] font-medium truncate" style={{ color: c.mainFg }}>
                        {set.title}
                      </p>
                      <p className="text-[11px] font-mono" style={{ color: c.mainSub }}>
                        {t("study.items", { count: set.itemCount ?? 0 })} | {new Date(set.createdAt).toLocaleDateString(language === "auto" ? undefined : language)}
                      </p>
                    </button>
                    <button title={t("common.rename")} aria-label={t("study.renameItem", { title: set.title })} disabled={saving}
                      onClick={() => { setEditingId(set.id); setEditName(set.title); }} className="p-2" style={{ color: c.mainSub }}><Pencil size={16} /></button>
                    {editingId === set.id && <form className="w-full flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void handleRename(set.id); }}>
                      <input autoFocus aria-label={t("study.newName")} value={editName} onChange={event => setEditName(event.target.value)} maxLength={120} required
                        className="w-full rounded border p-2" style={{ color: c.mainFg, background: c.main, borderColor: c.chipBorder }} />
                      <button disabled={saving || !editName.trim()} className="text-sm" style={{ color: c.mainFg }}>{saving ? t("common.saving") : t("common.save")}</button>
                      <button type="button" disabled={saving} onClick={() => setEditingId(null)} className="text-sm" style={{ color: c.mainSub }}>{t("common.cancel")}</button>
                    </form>}
                    <button
                      title={t("common.delete")}
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
