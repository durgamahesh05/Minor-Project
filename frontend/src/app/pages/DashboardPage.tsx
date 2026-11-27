import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { studyCache } from "../lib/studyCache";
import { useLanguage } from "../context/LanguageContext";
import { FileText, Upload, Trash2, Download, ListChecks, Layers } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type Document } from "../lib/api";
import { beginLocalDocument, chooseDocumentFiles, deleteLocalDocument, downloadLocalDocument, markLocalDocumentIndexed } from "../lib/documentStorage";
import { formatList, runWithConcurrency, useUploadConfig, validateFiles } from "../lib/uploadConfig";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const cacheUser = user?.id ?? "anonymous";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  // Paint the last known data immediately; the server response replaces it.
  const [documents, setDocuments] = useState<Document[]>(() => studyCache.documents(cacheUser) ?? []);
  const [counts, setCounts] = useState(() => ({ quizzes: studyCache.list(cacheUser, "quiz")?.length ?? 0, flashcards: studyCache.list(cacheUser, "flashcards")?.length ?? 0 }));
  const [loading, setLoading] = useState(() => !studyCache.documents(cacheUser));
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const uploadConfig = useUploadConfig();
  const [error, setError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  const c = getThemeColors(theme);

  useEffect(() => {
    Promise.all([api.listDocuments(), api.listQuizzes(), api.listFlashcardSets()])
      .then(([{ documents }, { quizzes }, { sets }]) => {
        // Server indexing status remains authoritative across browsers/restarts.
        setDocuments(documents);
        setCounts({ quizzes: quizzes.length, flashcards: sets.length });
        studyCache.setDocuments(cacheUser, documents);
        studyCache.setList(cacheUser, "quiz", quizzes);
        studyCache.setList(cacheUser, "flashcards", sets);
      })
      .catch(error => {
        setLoadFailed(true);
        setError(error instanceof Error ? error.message : t("dashboard.loadError"));
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleFilesChosen = async (files: File[]) => {
    if (!files.length || uploading) return;
    setError(null);
    // The library has no per-message attachment cap; only size and type apply.
    const invalid = validateFiles(files, { ...uploadConfig, maxAttachments: Number.MAX_SAFE_INTEGER });
    if (invalid) {
      setError(invalid);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });
    const errors: string[] = [];
    try {
      await runWithConcurrency(files, uploadConfig.uploadConcurrency, async file => {
        let clientDocumentId: string | undefined;
        try {
          clientDocumentId = await beginLocalDocument(file);
          const { document } = await api.uploadDocument(file, clientDocumentId);
          await markLocalDocumentIndexed(document);
          setDocuments(prev => [document, ...prev]);
        } catch (err) {
          if (clientDocumentId) await deleteLocalDocument(clientDocumentId).catch(() => {});
          errors.push(`${file.name}: ${err instanceof Error ? err.message : t("composer.uploadFailed")}`);
        } finally {
          setUploadProgress(progress => ({ ...progress, done: progress.done + 1 }));
        }
      });
    } finally {
      setUploading(false);
      if (errors.length) setError(errors.join("\n"));
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleChooseFile = async () => {
    try {
      const files = await chooseDocumentFiles(uploadConfig.extensions);
      if (files) await handleFilesChosen(files);
      else fileInputRef.current?.click();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setError(t("dashboard.pickerError"));
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setBusyDocId(id);
    try {
      await api.deleteDocument(id);
      const document = documents.find(item => item.id === id);
      setDocuments(prev => prev.filter(d => d.id !== id));
      await deleteLocalDocument(document?.clientDocumentId).catch(() => {
        setError(t("dashboard.deleteLocalError"));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.deleteError"));
    } finally {
      setBusyDocId(null);
    }
  };

  const handleDownload = async (document: Document) => {
    setError(null);
    try {
      if (document.storageProvider === "browser-opfs") await downloadLocalDocument(document);
      else window.open(api.documentDownloadUrl(document.id), "_blank", "noopener,noreferrer");
    } catch {
      setError(t("dashboard.downloadError"));
    }
  };

  const handleGenerateQuiz = async (documentId: string) => {
    setError(null);
    setBusyDocId(documentId);
    try {
      const { quiz } = await api.createQuiz(documentId, { language });
      studyCache.added(cacheUser, "quiz", quiz);
      navigate(`/quiz/${quiz.id}`, { state: { item: quiz } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.quizError"));
    } finally {
      setBusyDocId(null);
    }
  };

  const handleGenerateFlashcards = async (documentId: string) => {
    setError(null);
    setBusyDocId(documentId);
    try {
      const { set } = await api.createFlashcardSet(documentId, { language });
      studyCache.added(cacheUser, "flashcards", set);
      navigate(`/flashcards/${set.id}`, { state: { item: set } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.flashcardsError"));
    } finally {
      setBusyDocId(null);
    }
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
                  {t("dashboard.title")}
                </h1>
                <p className="text-[13px] mt-1" style={{ color: c.mainSub }}>
                  {t("dashboard.subtitle", { formats: formatList(uploadConfig), size: uploadConfig.maxFileSizeMb })}
                </p>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={uploadConfig.accept}
                  className="hidden"
                  onChange={e => { void handleFilesChosen(Array.from(e.target.files ?? [])); }}
                />
                <button
                  onClick={handleChooseFile}
                  disabled={uploading}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "#7c5af0", color: "#ffffff" }}
                >
                  <Upload size={14} strokeWidth={2} />
                  {uploading ? (uploadProgress.total > 1 ? t("dashboard.uploadingCount", { done: uploadProgress.done, total: uploadProgress.total }) : t("dashboard.uploading")) : t("dashboard.uploadDocuments")}
                </button>
              </div>
            </div>

            {!loading && !loadFailed && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border p-4" style={{ borderColor: c.chipBorder, color: c.mainFg }}>{t("dashboard.documents", { count: documents.length })}</div>
              <Link to="/quiz" className="rounded-xl border p-4" style={{ borderColor: c.chipBorder, color: c.mainFg }}>{t("dashboard.quizzes", { count: counts.quizzes })}</Link>
              <Link to="/flashcards" className="rounded-xl border p-4" style={{ borderColor: c.chipBorder, color: c.mainFg }}>{t("dashboard.flashcardSets", { count: counts.flashcards })}</Link>
            </div>}
            {busyDocId && <p role="status" className="text-sm" style={{ color: c.mainSub }}>{t("dashboard.working")}</p>}
            {error && <p role="alert" className="text-sm text-destructive whitespace-pre-line">{error}</p>}

            {loading ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                {t("loading")}
              </p>
            ) : documents.length === 0 ? (
              <div
                className="rounded-2xl p-10 text-center"
                style={{ background: c.chipBg, border: `1px dashed ${c.chipBorder}` }}
              >
                <FileText size={28} strokeWidth={1.5} style={{ color: c.mainSub, margin: "0 auto" }} />
                <p className="text-sm mt-3" style={{ color: c.mainSub }}>
                  {t("dashboard.empty", { size: uploadConfig.maxFileSizeMb })}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map(doc => (
                  <div
                    key={doc.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl"
                    style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}` }}
                  >
                    <FileText size={18} strokeWidth={1.5} style={{ color: c.mainSub }} className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: c.mainFg }}>
                        {doc.originalName}
                      </p>
                      <p className="text-[11px] font-mono" style={{ color: c.mainSub }}>
                        {t("dashboard.status." + doc.status, { defaultValue: doc.status })} | {formatSize(doc.size)} · {new Date(doc.createdAt).toLocaleDateString(language === "auto" ? undefined : language)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        title={t("dashboard.generateQuiz")}
                        disabled={busyDocId !== null || doc.status !== "indexed"}
                        onClick={() => handleGenerateQuiz(doc.id)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ color: c.mainSub }}
                      >
                        <ListChecks size={16} strokeWidth={1.5} />
                      </button>
                      <button
                        title={t("dashboard.generateFlashcards")}
                        disabled={busyDocId !== null || doc.status !== "indexed"}
                        onClick={() => handleGenerateFlashcards(doc.id)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ color: c.mainSub }}
                      >
                        <Layers size={16} strokeWidth={1.5} />
                      </button>
                      <button
                        title={t("dashboard.download")}
                        onClick={() => handleDownload(doc)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: c.mainSub }}
                      >
                        <Download size={16} strokeWidth={1.5} />
                      </button>
                      <button
                        title={t("common.delete")}
                        disabled={busyDocId !== null}
                        onClick={() => handleDelete(doc.id)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ color: "#e0365a" }}
                      >
                        <Trash2 size={16} strokeWidth={1.5} />
                      </button>
                    </div>
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
