import { useState } from "react";
import { FileText } from "lucide-react";
import { api, type DocumentAttachment } from "../../lib/api";
import { downloadLocalDocument } from "../../lib/documentStorage";
import type { ThemeColors } from "../../lib/theme";

export default function DocumentCard({ document, c }: { document: DocumentAttachment; c: ThemeColors }) {
  const [error, setError] = useState<string | null>(null);
  const extension = document.originalName.split(".").pop()?.toUpperCase() || "FILE";
  const open = async () => {
    setError(null);
    try {
      if (document.storageProvider === "browser-opfs") await downloadLocalDocument(document);
      else window.open(api.documentDownloadUrl(document.id), "_blank", "noopener,noreferrer");
    } catch {
      setError("The original file is unavailable in this browser. Your chat is still saved.");
    }
  };
  return (
    <div className="w-full max-w-[400px]">
      <button type="button" onClick={open} aria-label={`Open ${document.originalName}`}
        className="flex w-full min-w-0 items-center gap-3 rounded-2xl border px-4 py-3 text-left hover:opacity-90"
        style={{ background: c.chipBg, borderColor: c.chipBorder, color: c.mainFg }}>
        <FileText size={26} className="shrink-0" style={{ color: extension === "PDF" ? "#f87171" : "#a78bfa" }} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{document.originalName}</span>
          <span className="block text-xs" style={{ color: c.mainSub }}>{extension} · Ready</span>
        </span>
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
