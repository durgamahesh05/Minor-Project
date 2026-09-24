import { useEffect, useRef, useState } from "react";
import { Plus, Mic, Square, ArrowUp, FileText, Loader2, X } from "lucide-react";
import type { ThemeColors } from "../../lib/theme";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../../context/LanguageContext";
import { api, type Document } from "../../lib/api";
import { beginLocalDocument, chooseDocumentFile, deleteLocalDocument, downloadLocalDocument, markLocalDocumentIndexed } from "../../lib/documentStorage";

type Props = {
  c: ThemeColors;
  value: string;
  onChange: (value: string) => void;
  onSend: (text?: string) => void;
  onDocumentStateChange?: (documentId: string | null, processing: boolean) => void;
  disabled?: boolean;
};
type Attachment = Pick<Document, "originalName" | "mimeType" | "size"> & Partial<Pick<Document, "id" | "clientDocumentId" | "storageProvider">> & { uploading: boolean };
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

export default function ChatInput({ c, value, onChange, onSend, onDocumentStateChange, disabled }: Props) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState("Saving file");
  const [uploadSeconds, setUploadSeconds] = useState(0);
  const failedFile = useRef<File | undefined>(undefined);
  const sendBlocked = useRef(false);
  sendBlocked.current = Boolean(disabled || isUploading);

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

  const uploadAttachment = async (file: File | undefined) => {
    if (!file || sendBlocked.current) return;
    setAttachmentError(null);
    if (file.size > 20 * 1024 * 1024) {
      setAttachmentError("Files must be 20 MB or smaller.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setAttachment({ originalName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, uploading: true });
    setIsUploading(true);
    setUploadStage("Saving file");
    failedFile.current = undefined;
    sendBlocked.current = true;
    speechRecognitionRef.current?.stop();
    onDocumentStateChange?.(null, true);
    let clientDocumentId: string | undefined;
    try {
      clientDocumentId = await beginLocalDocument(file);
      setUploadStage("Uploading and indexing");
      const { document } = await api.uploadDocument(file, clientDocumentId);
      await markLocalDocumentIndexed(document);
      setAttachment({ ...document, uploading: false });
      onDocumentStateChange?.(document.id, false);
    } catch (error) {
      if (clientDocumentId) await deleteLocalDocument(clientDocumentId).catch(() => {});
      setAttachment(null);
      onDocumentStateChange?.(null, false);
      setAttachmentError(error instanceof Error ? error.message : "Upload failed.");
      failedFile.current = file;
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const chooseAttachment = async () => {
    try {
      const file = await chooseDocumentFile();
      if (file) await uploadAttachment(file);
      else fileInputRef.current?.click();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setAttachmentError("Unable to open the file picker.");
    }
  };

  const openAttachment = async () => {
    if (!attachment || attachment.uploading || !attachment.id) return;
    try {
      await downloadLocalDocument(attachment);
    } catch {
      window.open(api.documentDownloadUrl(attachment.id), "_blank", "noopener,noreferrer");
    }
  };

  const attachmentType = attachment?.originalName.includes(".") ? attachment.originalName.split(".").pop()?.toUpperCase() : attachment?.mimeType;

  return (
    <div className="relative">
      <div className="px-4 py-3 rounded-3xl" style={{ background: c.inputBg, border: `1px solid ${c.inputBorder}`, boxShadow: c.isDark ? "0 0 0 1px rgba(255,255,255,0.03)" : "0 1px 4px rgba(0,0,0,0.06)" }}>
        {attachment && (
          <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={openAttachment}
            disabled={attachment.uploading}
            className="flex min-w-0 flex-1 max-w-[400px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-opacity hover:opacity-80 disabled:cursor-wait disabled:hover:opacity-100"
            style={{ borderColor: c.inputBorder, color: c.mainFg, background: c.chipBg }}
            title={attachment.uploading ? "Processing document" : "Open uploaded file"}
          >
            {attachment.uploading ? <Loader2 size={22} className="animate-spin flex-shrink-0" style={{ color: "#7c5af0" }} /> : <FileText size={22} className="flex-shrink-0" style={{ color: "#e0365a" }} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{attachment.originalName}</span>
              <span className="block text-[12px]" style={{ color: c.mainSub }}>
                {attachment.uploading ? `${uploadStage}… ${uploadSeconds}s` : `Ready for questions · ${attachmentType}`}
              </span>
            </span>
          </button>
          {!isUploading && <button type="button" disabled={disabled} onClick={() => { setAttachment(null); onDocumentStateChange?.(null, false); }} title="Detach file from chat" aria-label="Detach file from chat" className="p-2 rounded-full hover:opacity-70 disabled:opacity-30" style={{ color: c.mainSub }}><X size={16} /></button>}
          </div>
        )}
        <div className="flex items-end gap-3">
        <input ref={fileInputRef} type="file" className="hidden" onChange={event => uploadAttachment(event.target.files?.[0])} />
        <button onClick={chooseAttachment} disabled={isUploading || disabled} className="flex-shrink-0 transition-opacity hover:opacity-70 disabled:opacity-50 pb-0.5" style={{ color: c.mainSub }} title="Upload a file">
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
      {attachmentError && <div role="alert" className="mt-2 px-2 text-xs break-words" style={{ color: "#e0365a" }}>{attachmentError}{failedFile.current && <button type="button" disabled={disabled || isUploading} className="ml-2 underline" onClick={() => uploadAttachment(failedFile.current)}>Retry upload</button>}</div>}
    </div>
  );
}
