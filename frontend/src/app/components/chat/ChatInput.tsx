import { useEffect, useRef, useState } from "react";
import { Plus, Mic, Square, ArrowUp, FileText, Loader2 } from "lucide-react";
import type { ThemeColors } from "../../lib/theme";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../../context/LanguageContext";
import { api, ApiError, type Document } from "../../lib/api";

type Props = { c: ThemeColors; value: string; onChange: (value: string) => void; onSend: (text?: string) => void; disabled?: boolean };
type Attachment = Pick<Document, "originalName" | "mimeType" | "size"> & { id?: string; uploading: boolean };
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

export default function ChatInput({ c, value, onChange, onSend, disabled }: Props) {
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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [value]);

  useEffect(() => () => speechRecognitionRef.current?.stop(), []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
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
        onSend(message);
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
    if (!file) return;
    setAttachmentError(null);
    if (file.size > 20 * 1024 * 1024) {
      setAttachmentError("Files must be 20 MB or smaller.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setAttachment({ originalName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, uploading: true });
    setIsUploading(true);
    try {
      const { document } = await api.uploadDocument(file);
      setAttachment({ ...document, uploading: false });
    } catch (error) {
      setAttachment(null);
      setAttachmentError(error instanceof ApiError ? error.message : "Upload failed.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const attachmentType = attachment?.originalName.includes(".") ? attachment.originalName.split(".").pop()?.toUpperCase() : attachment?.mimeType;

  return (
    <div className="relative">
      <div className="px-4 py-3 rounded-[2rem] transition-all" style={{ background: c.inputBg, border: `1px solid ${c.inputBorder}`, boxShadow: c.isDark ? "0 0 0 1px rgba(255,255,255,0.03)" : "0 1px 4px rgba(0,0,0,0.06)" }}>
        {attachment && (
          <button
            type="button"
            onClick={() => !attachment.uploading && attachment.id && window.open(api.documentDownloadUrl(attachment.id), "_blank", "noopener,noreferrer")}
            disabled={attachment.uploading}
            className="mb-3 flex w-full max-w-[400px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-opacity hover:opacity-80 disabled:cursor-wait disabled:hover:opacity-100"
            style={{ borderColor: c.inputBorder, color: c.mainFg, background: c.chipBg }}
            title={attachment.uploading ? "Uploading file" : "Open uploaded file"}
          >
            {attachment.uploading ? <Loader2 size={22} className="animate-spin flex-shrink-0" style={{ color: "#7c5af0" }} /> : <FileText size={22} className="flex-shrink-0" style={{ color: "#e0365a" }} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{attachment.originalName}</span>
              <span className="block text-[12px]" style={{ color: c.mainSub }}>{attachment.uploading ? "Uploading…" : attachmentType}</span>
            </span>
          </button>
        )}
        <div className="flex items-end gap-3">
        <input ref={fileInputRef} type="file" className="hidden" onChange={event => uploadAttachment(event.target.files?.[0])} />
        <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex-shrink-0 transition-opacity hover:opacity-70 disabled:opacity-50 pb-0.5" style={{ color: c.mainSub }} title="Upload a file">
          <Plus size={18} strokeWidth={1.5} />
        </button>
        <textarea ref={textareaRef} value={value} onChange={e => onChange(e.target.value)} onKeyDown={handleKeyDown} placeholder={isRecording ? t("listening") : t("askAnything")} rows={1} className="flex-1 bg-transparent resize-none focus:outline-none text-[14px] leading-relaxed" style={{ color: c.mainFg, caretColor: "#7c5af0", maxHeight: 160, overflowY: "auto" }} />
        <div className="flex items-center gap-2 flex-shrink-0 pb-0.5">
          <button onClick={isRecording ? stopRecording : startRecording} className="transition-opacity hover:opacity-70" style={{ color: isRecording ? "#e0365a" : c.mainSub }} title={isRecording ? t("stopRecording") : t("voiceInput")}>
            {isRecording ? <Square size={16} strokeWidth={1.5} className="animate-pulse" fill="currentColor" /> : <Mic size={16} strokeWidth={1.5} />}
          </button>
          <button onClick={() => onSend()} disabled={!value.trim() || disabled} className="w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-25" style={{ background: value.trim() && !disabled ? "#7c5af0" : c.inputBorder }} title={t("send")}>
            <ArrowUp size={15} strokeWidth={2.5} style={{ color: value.trim() && !disabled ? "#ffffff" : c.mainSub }} />
          </button>
        </div>
        </div>
      </div>
      {micError && <p className="absolute -bottom-5 left-4 text-[11px]" style={{ color: "#e0365a" }}>{micError}</p>}
      {attachmentError && <p className="absolute -bottom-5 left-4 text-[11px] truncate max-w-full" style={{ color: "#e0365a" }}>{attachmentError}</p>}
    </div>
  );
}
