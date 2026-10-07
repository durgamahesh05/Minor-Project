import { useEffect, useRef, useState } from "react";
import { Plus, Mic, Square, ArrowUp, FileText, Loader2, X } from "lucide-react";
import type { ThemeColors } from "../../lib/theme";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../../context/LanguageContext";
import { api, type Document, type DocumentAttachment } from "../../lib/api";
import { beginLocalDocument, deleteLocalDocument, downloadLocalDocument, markLocalDocumentIndexed } from "../../lib/documentStorage";

type Props = {
  c: ThemeColors;
  value: string;
  onChange: (value: string) => void;
  onSend: (text?: string) => void;
  onDocumentStateChange?: (documents: DocumentAttachment[], processing: boolean) => void;
  existingDocuments?: DocumentAttachment[];
  disabled?: boolean;
};
type Attachment = Pick<Document, "originalName" | "mimeType" | "size"> & Partial<Pick<Document, "id" | "clientDocumentId" | "storageProvider">> & { uploading: boolean; stage?: string; key: string };
type BrowserSpeechRecognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};
type SpeechRecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number };
type SpeechRecognitionErrorEvent = { error: string };
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window { SpeechRecognition?: BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor }
}

const speechLocale: Record<string, string> = { en: "en-IN", hi: "hi-IN", te: "te-IN", es: "es-ES", fr: "fr-FR" };

export default function ChatInput({ c, value, onChange, onSend, onDocumentStateChange, existingDocuments, disabled }: Props) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const updateAttachments = (items: Attachment[]) => { attachmentsRef.current = items; if (mounted.current) setAttachments(items); };
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [uploadSeconds, setUploadSeconds] = useState(0);
  const failedFiles = useRef<File[]>([]);
  const sendBlocked = useRef(false);
  sendBlocked.current = Boolean(disabled || isUploading);

  useEffect(() => {
    updateAttachments((existingDocuments || []).map(document => ({ ...document, key: document.id, uploading: false })));
  }, [existingDocuments]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [value]);

  useEffect(() => () => speechRecognitionRef.current?.stop(), []);
  useEffect(() => {
    if (!isUploading) return;
    const started = Date.now();
    setUploadSeconds(0);
    const timer = window.setInterval(() => setUploadSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isUploading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!disabled && !isUploading) onSend();
    }
  };

  const startRecording = () => {
    setMicError(null);
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) { setMicError("Speech recognition is not supported by this browser. Use Chrome or Edge."); return; }

    const recognition = new Recognition();
    recognition.lang = speechLocale[language] ?? navigator.language;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = event => {
      const transcript = Array.from(event.results).slice(event.resultIndex).map(result => result[0]?.transcript ?? "").join(" ").trim();
      if (transcript) {
        const message = value.trim() ? `${value.trim()} ${transcript}` : transcript;
        onChange(message);
        if (!sendBlocked.current) onSend(message);
      }
      else setMicError("Didn't catch any speech — try again.");
    };
    recognition.onerror = event => {
      if (event.error !== "aborted") setMicError(event.error === "not-allowed" ? "Microphone permission was denied." : "Speech recognition failed. Please try again.");
    };
    recognition.onend = () => { setIsRecording(false); speechRecognitionRef.current = null; };
    speechRecognitionRef.current = recognition;
    try { recognition.start(); setIsRecording(true); }
    catch { setMicError("Speech recognition is already starting. Please try again."); }
  };

  const stopRecording = () => speechRecognitionRef.current?.stop();

  const uploadAttachments = async (files: File[]) => {
    if (!files.length || sendBlocked.current) return;
    setAttachmentError(null);
    if (attachmentsRef.current.length + files.length > 5) { setAttachmentError("Attach up to 5 files. Remove a file before adding more."); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024)) { setAttachmentError("Each file must be 20 MB or smaller."); return; }
    const supported = /\.(pdf|docx|pptx|xlsx|txt|md|csv|tsv|json|xml|html|htm|log|py|js|ts|css|java|c|cpp|h|yaml|yml|bmp|gif|jpe?g|png|tiff?|webp)$/i;
    const unsupported = files.filter(file => !supported.test(file.name));
    if (unsupported.length) { setAttachmentError(`Unsupported file: ${unsupported.map(file => file.name).join(", ")}. Use documents, spreadsheets, text, code or images.`); return; }
    const queued = files.map(file => ({ file, key: crypto.randomUUID() }));
    updateAttachments([...attachmentsRef.current, ...queued.map(({ file, key }) => ({ key, originalName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, uploading: true, stage: "Queued" }))]);
    setIsUploading(true);
    failedFiles.current = [];
    sendBlocked.current = true;
    speechRecognitionRef.current?.stop();
    onDocumentStateChange?.([], true);
    const errors: string[] = [];
    const update = (key: string, values: Partial<Attachment>) => updateAttachments(attachmentsRef.current.map(item => item.key === key ? { ...item, ...values } : item));
    let next = 0;
    const worker = async () => {
      while (next < queued.length) {
        const { file, key } = queued[next++];
        let localId: string | undefined;
        try {
          update(key, { stage: "Saving file" });
          localId = await beginLocalDocument(file);
          const { document } = await api.uploadDocument(file, localId, percent => update(key, { stage: percent >= 100 ? "Reading and indexing" : `Uploading ${percent}%` }));
          await markLocalDocumentIndexed(document);
          update(key, { ...document, uploading: false, stage: "Ready" });
        } catch (error) {
          if (localId) await deleteLocalDocument(localId).catch(() => {});
          updateAttachments(attachmentsRef.current.filter(item => item.key !== key));
          failedFiles.current.push(file);
          errors.push(`${file.name}: ${error instanceof Error ? error.message : "Upload failed"}`);
        }
      }
    };
    // Two uploads overlap network/OCR work without overwhelming the embedding model.
    await Promise.all([worker(), worker()]);
    if (!mounted.current) return;
    setIsUploading(false);
    sendBlocked.current = Boolean(disabled);
    onDocumentStateChange?.(attachmentsRef.current.filter(item => item.id && !item.uploading) as DocumentAttachment[], false);
    if (errors.length) setAttachmentError(errors.join("\n"));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openAttachment = async (attachment: Attachment) => {
    if (attachment.uploading || !attachment.id) return;
    try { await downloadLocalDocument(attachment); }
    catch { window.open(api.documentDownloadUrl(attachment.id), "_blank", "noopener,noreferrer"); }
  };
  const detachAttachment = (key: string) => {
    const items = attachmentsRef.current.filter(item => item.key !== key);
    updateAttachments(items);
    onDocumentStateChange?.(items as DocumentAttachment[], false);
  };

  return (
    <div className="relative">
      <div className="px-4 py-3 rounded-3xl" style={{ background: c.inputBg, border: `1px solid ${c.inputBorder}`, boxShadow: c.isDark ? "0 0 0 1px rgba(255,255,255,0.03)" : "0 1px 4px rgba(0,0,0,0.06)" }}>
        {attachments.map(attachment => (
          <div key={attachment.key} className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => openAttachment(attachment)}
            disabled={attachment.uploading}
            className="flex min-w-0 flex-1 max-w-[400px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-opacity hover:opacity-80 disabled:cursor-wait disabled:hover:opacity-100"
            style={{ borderColor: c.inputBorder, color: c.mainFg, background: c.chipBg }}
            title={attachment.uploading ? "Processing document" : "Open uploaded file"}
          >
            {attachment.uploading ? <Loader2 size={22} className="animate-spin flex-shrink-0" style={{ color: "#7c5af0" }} /> : <FileText size={22} className="flex-shrink-0" style={{ color: "#e0365a" }} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{attachment.originalName}</span>
              <span className="block text-[12px]" style={{ color: c.mainSub }}>
                {attachment.uploading ? `${attachment.stage} - ${uploadSeconds}s` : "Ready for questions"}
              </span>
            </span>
          </button>
          {!isUploading && <button type="button" disabled={disabled} onClick={() => { detachAttachment(attachment.key); }} title="Detach file from chat" aria-label="Detach file from chat" className="p-2 rounded-full hover:opacity-70 disabled:opacity-30" style={{ color: c.mainSub }}><X size={16} /></button>}
          </div>
        ))}
        <div className="flex items-end gap-3">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void uploadAttachments(files); }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={isUploading || disabled} className="flex-shrink-0 transition-opacity hover:opacity-70 disabled:opacity-50 pb-0.5" style={{ color: c.mainSub }} title="Upload up to 5 files (20 MB each)">
          <Plus size={18} strokeWidth={1.5} />
        </button>
        <textarea ref={textareaRef} value={value} onChange={e => onChange(e.target.value)} onKeyDown={handleKeyDown} aria-label="Message" placeholder={isUploading ? "Draft your question while the file is prepared…" : isRecording ? t("listening") : t("askAnything")} rows={1} className="min-w-0 flex-1 bg-transparent resize-none focus:outline-none text-[14px] leading-relaxed" style={{ color: c.mainFg, caretColor: "#7c5af0", maxHeight: 160, overflowY: "auto" }} />
        <div className="flex items-center gap-2 flex-shrink-0 pb-0.5">
          <button onClick={isRecording ? stopRecording : startRecording} disabled={isUploading || disabled} className="transition-opacity hover:opacity-70 disabled:opacity-50" style={{ color: isRecording ? "#e0365a" : c.mainSub }} title={isRecording ? t("stopRecording") : t("voiceInput")}>
            {isRecording ? <Square size={16} strokeWidth={1.5} className="animate-pulse" fill="currentColor" /> : <Mic size={16} strokeWidth={1.5} />}
          </button>
          <button onClick={() => onSend()} disabled={!value.trim() || disabled || isUploading} className="w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-25" style={{ background: value.trim() && !disabled && !isUploading ? "#7c5af0" : c.inputBorder }} title={isUploading ? "Document is being indexed" : t("send")}>
            <ArrowUp size={15} strokeWidth={2.5} style={{ color: value.trim() && !disabled && !isUploading ? "#ffffff" : c.mainSub }} />
          </button>
        </div>
        </div>
      </div>
      {isUploading && <p role="status" className="mt-2 px-2 text-xs" style={{ color: c.mainSub }}>{uploadSeconds >= 30 ? "Still preparing your file. Large files and the first upload can take longer." : "You can write your question now. Send unlocks when the file is ready."}</p>}
      {micError && <p role="alert" className="mt-2 px-2 text-xs break-words" style={{ color: "#e0365a" }}>{micError}</p>}
      {attachmentError && <div role="alert" className="mt-2 px-2 text-xs break-words" style={{ color: "#e0365a" }}>{attachmentError}{failedFiles.current.length > 0 && <button type="button" disabled={disabled || isUploading} className="ml-2 underline" onClick={() => uploadAttachments([...failedFiles.current])}>Retry upload</button>}</div>}
    </div>
  );
}
