import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Layers, ListChecks, Pencil, Trash2, Upload, FileText } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type FlashcardSetSummary, type Document } from "../lib/api";
import { beginLocalDocument, deleteLocalDocument, markLocalDocumentIndexed } from "../lib/documentStorage";
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

  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [sets, setSets] = useState<FlashcardSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = creating || uploading;
  const c = getThemeColors(theme);

  const handleUpload = async (file?: File) => {
    if (!file || busy) return;
    setError(null);
    if (file.size > 20 * 1024 * 1024) { setError("Files must be 20 MB or smaller."); return; }
    setUploading(true);
    setProgress(0);
    let localId: string | undefined;
    try {
      localId = await beginLocalDocument(file);
      const { document } = await api.uploadDocument(file, localId, setProgress);
      await markLocalDocumentIndexed(document);
      setDocuments(previous => [document, ...previous.filter(item => item.id !== document.id)]);
      setDocumentId(document.id);
    } catch (error) {
      if (localId) await deleteLocalDocument(localId).catch(() => {});
      setError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  useEffect(() => {
    Promise.all([isQuiz ? api.listQuizzes().then(result => ({ sets: result.quizzes })) : api.listFlashcardSets(), api.listDocuments()])
      .then(([result, { documents }]) => {
        setSets(result.sets);
        setDocuments(documents.filter(document => document.status === "indexed"));
      })
      .catch(error => setError(error instanceof Error ? error.message : "Unable to load study materials."))
      .finally(() => setLoading(false));
  }, [isQuiz]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      const options = { title: name.trim() || undefined };
      const result = isQuiz ? await api.createQuiz(documentId || undefined, options) : await api.createFlashcardSet(documentId || undefined, options);
      const item = "quiz" in result ? result.quiz : result.set;
      navigate(`/${kind}/${item.id}`);
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
      if (isQuiz) await api.deleteQuiz(id); else await api.deleteFlashcardSet(id);
      setSets(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete flashcard set. Please try again.");
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
      setEditingId(null);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to rename."); }
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
                  {isQuiz ? "Quizzes" : "Flashcards"}
                </h1>
                <p className="text-[13px] mt-1" style={{ color: c.mainSub }}>
                  Upload a document, generate your study materials, and revisit saved work below.
                </p>
              </div>
            </div>

            <section className="rounded-2xl p-5" style={{ background: c.chipBg, border: `1px dashed ${c.chipBorder}` }} aria-label={isQuiz ? "Generate new quiz" : "Generate flashcards"}>
              <h2 className="text-lg font-semibold mb-4" style={{ color: c.mainFg }}>{isQuiz ? "Generate new quiz" : "Generate flashcards"}</h2>
              <input ref={fileInput} type="file" className="sr-only" aria-label="Upload document"
                accept=".pdf,.txt,.docx,.pptx,.bmp,.gif,.jpeg,.jpg,.png,.tif,.tiff,.webp" disabled={busy}
                onChange={event => { void handleUpload(event.target.files?.[0]); }} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}
                className="w-full flex flex-col items-center justify-center gap-3 py-10 rounded-xl disabled:opacity-60"
                style={{ color: c.mainFg }}>
                <Upload size={34} strokeWidth={1.5} style={{ color: "#9b7bff" }} />
                <span className="font-medium">{uploading ? (progress < 100 ? `Uploading ${progress}%` : "Processing document...") : "Upload a document"}</span>
                <span className="text-xs" style={{ color: c.mainSub }}>PDF, Word, PowerPoint, text or images - Up to 20 MB</span>
              </button>
              {documents.length > 0 && <details className="mb-4" open={!!documentId}>
                <summary className="cursor-pointer text-sm" style={{ color: c.mainSub }}>Use an uploaded document</summary>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button disabled={busy} onClick={() => setDocumentId("")} aria-pressed={!documentId}
                    className="border rounded-lg px-3 py-2 text-xs" style={{ color: c.mainFg, borderColor: !documentId ? "#7c5af0" : c.chipBorder }}>All indexed documents</button>
                  {documents.map(document => <button key={document.id} disabled={busy} onClick={() => setDocumentId(document.id)}
                    aria-pressed={documentId === document.id} className="flex items-center gap-2 border rounded-lg px-3 py-2 text-xs max-w-full"
                    style={{ color: c.mainFg, borderColor: documentId === document.id ? "#7c5af0" : c.chipBorder }}>
                    <FileText size={14} className="shrink-0" /><span className="truncate">{document.originalName}</span>
                  </button>)}
                </div>
              </details>}
              {!loading && documents.length === 0 && <p className="text-sm mb-4" style={{ color: c.mainSub }}>Upload a document to begin.</p>}
              <div className="flex flex-wrap items-end justify-end gap-3">
                <label className="flex-1 min-w-48 text-sm" style={{ color: c.mainFg }}>{isQuiz ? "Quiz name (optional)" : "Flashcard name (optional)"}
                  <input value={name} onChange={event => setName(event.target.value)} disabled={busy} maxLength={120} placeholder="Name your study set"
                    className="block w-full border rounded-xl p-3 mt-2" style={{ background: c.main, borderColor: c.chipBorder }} />
                </label>
                <button onClick={handleCreate} disabled={busy || loading || documents.length === 0}
                  className="rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "#7c5af0", color: "white" }}>
                  {creating ? "Generating..." : "Generate"}
                </button>
              </div>
            </section>

            <h2 className="text-lg font-semibold" style={{ color: c.mainFg }}>{isQuiz ? "Recent quizzes" : "Recent flashcard lists"}</h2>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {loading ? (
              <p className="text-sm" style={{ color: c.mainSub }}>
                Loading…
              </p>
            ) : sets.length === 0 ? (
              <div className="rounded-2xl p-10 text-center" style={{ background: c.chipBg, border: `1px dashed ${c.chipBorder}` }}>
                <Icon size={28} strokeWidth={1.5} style={{ color: c.mainSub, margin: "0 auto" }} />
                <p className="text-sm mt-3" style={{ color: c.mainSub }}>
                  {isQuiz ? "No quizzes yet." : "No flashcard sets yet."}
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
                        {set.itemCount ?? 0} items | {new Date(set.createdAt).toLocaleDateString()}
                      </p>
                    </button>
                    <button title="Rename" aria-label={`Rename ${set.title}`} disabled={saving}
                      onClick={() => { setEditingId(set.id); setEditName(set.title); }} className="p-2" style={{ color: c.mainSub }}><Pencil size={16} /></button>
                    {editingId === set.id && <form className="w-full flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void handleRename(set.id); }}>
                      <input autoFocus aria-label="New name" value={editName} onChange={event => setEditName(event.target.value)} maxLength={120} required
                        className="w-full rounded border p-2" style={{ color: c.mainFg, background: c.main, borderColor: c.chipBorder }} />
                      <button disabled={saving || !editName.trim()} className="text-sm" style={{ color: c.mainFg }}>{saving ? "Saving..." : "Save"}</button>
                      <button type="button" disabled={saving} onClick={() => setEditingId(null)} className="text-sm" style={{ color: c.mainSub }}>Cancel</button>
                    </form>}
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
