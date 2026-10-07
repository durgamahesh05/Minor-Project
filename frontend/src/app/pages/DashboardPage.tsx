import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import { FileText, Upload, Trash2, Download, ListChecks, Layers } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError, type Document } from "../lib/api";
import { beginLocalDocument, chooseDocumentFile, deleteLocalDocument, downloadLocalDocument, markLocalDocumentIndexed } from "../lib/documentStorage";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [counts, setCounts] = useState({ quizzes: 0, flashcards: 0 });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  const c = getThemeColors(theme);

  useEffect(() => {
    Promise.all([api.listDocuments(), api.listQuizzes(), api.listFlashcardSets()])
      .then(([{ documents }, { quizzes }, { sets }]) => {
        // Server indexing status remains authoritative across browsers/restarts.
        setDocuments(documents);
        setCounts({ quizzes: quizzes.length, flashcards: sets.length });
      })
      .catch(error => setError(error instanceof Error ? error.message : "Unable to load your dashboard."))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleFileChosen = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 20 * 1024 * 1024) {
      setError("Files must be 20 MB or smaller.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    let clientDocumentId: string | undefined;
    try {
      clientDocumentId = await beginLocalDocument(file);
      const { document } = await api.uploadDocument(file, clientDocumentId);
      await markLocalDocumentIndexed(document);
      setDocuments(prev => [document, ...prev]);
    } catch (err) {
      if (clientDocumentId) await deleteLocalDocument(clientDocumentId).catch(() => {});
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleChooseFile = async () => {
    try {
      const file = await chooseDocumentFile();
      if (file) await handleFileChosen(file);
      else fileInputRef.current?.click();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setError("Unable to open the file picker.");
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
        setError("Document deleted, but its browser copy could not be removed.");
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete document. Please try again.");
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
      setError("The original file is not available in this browser.");
    }
  };

  const handleGenerateQuiz = async (documentId: string) => {
    setError(null);
    setBusyDocId(documentId);
    try {
      const { quiz } = await api.createQuiz(documentId);
      navigate(`/quiz/${quiz.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate quiz.");
    } finally {
      setBusyDocId(null);
    }
  };

  const handleGenerateFlashcards = async (documentId: string) => {
    setError(null);
    setBusyDocId(documentId);
    try {
      const { set } = await api.createFlashcardSet(documentId);
      navigate(`/flashcards/${set.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate flashcards.");
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
                  Your documents
                </h1>
                <p className="text-[13px] mt-1" style={{ color: c.mainSub }}>
                  Upload files up to 20 MB, then generate quizzes and flashcards from supported study materials.
                </p>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={e => handleFileChosen(e.target.files?.[0])}
                />
                <button
                  onClick={handleChooseFile}
                  disabled={uploading}
                  className="px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "#7c5af0", color: "#ffffff" }}
                >
                  <Upload size={14} strokeWidth={2} />
                  {uploading ? "Uploading…" : "Upload document"}
                </button>
              </div>
            </div>

            {!loading && !error && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border p-4" style={{ borderColor: c.chipBorder, color: c.mainFg }}>{documents.length} documents</div>
              <Link to="/quiz" className="rounded-xl border p-4" style={{ borderColor: c.chipBorder, color: c.mainFg }}>{counts.quizzes} quizzes</Link>
              <Link to="/flashcards" className="rounded-xl border p-4" style={{ borderColor: c.chipBorder, color: c.mainFg }}>{counts.flashcards} flashcard sets</Link>
            </div>}
            {busyDocId && <p role="status" className="text-sm" style={{ color: c.mainSub }}>Working on your document?</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {loading ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                Loading…
              </p>
            ) : documents.length === 0 ? (
              <div
                className="rounded-2xl p-10 text-center"
                style={{ background: c.chipBg, border: `1px dashed ${c.chipBorder}` }}
              >
                <FileText size={28} strokeWidth={1.5} style={{ color: c.mainSub, margin: "0 auto" }} />
                <p className="text-sm mt-3" style={{ color: c.mainSub }}>
                  No documents yet. Upload a file up to 20 MB to get started.
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
                        {doc.status} | {formatSize(doc.size)} · {new Date(doc.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        title="Generate quiz"
                        disabled={busyDocId !== null || doc.status !== "indexed"}
                        onClick={() => handleGenerateQuiz(doc.id)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ color: c.mainSub }}
                      >
                        <ListChecks size={16} strokeWidth={1.5} />
                      </button>
                      <button
                        title="Generate flashcards"
                        disabled={busyDocId !== null || doc.status !== "indexed"}
                        onClick={() => handleGenerateFlashcards(doc.id)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ color: c.mainSub }}
                      >
                        <Layers size={16} strokeWidth={1.5} />
                      </button>
                      <button
                        title="Download"
                        onClick={() => handleDownload(doc)}
                        className="p-2 rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: c.mainSub }}
                      >
                        <Download size={16} strokeWidth={1.5} />
                      </button>
                      <button
                        title="Delete"
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
