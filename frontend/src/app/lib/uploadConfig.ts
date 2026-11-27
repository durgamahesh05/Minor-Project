import { useEffect, useState } from "react";
import { api, type UploadConfig } from "./api";
import i18n from "../i18n";

// Used only until the server's /api/documents/config response arrives (or if it fails).
const DEFAULT_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".rtf", ".pptx", ".xlsx", ".xls",
  ".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".log",
  ".py", ".js", ".ts", ".css", ".java", ".c", ".cpp", ".h", ".yaml", ".yml",
  ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp",
];

export const DEFAULT_UPLOAD_CONFIG: UploadConfig = {
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxFileSizeMb: 10,
  maxAttachments: 5,
  uploadConcurrency: 3,
  extensions: DEFAULT_EXTENSIONS,
  accept: DEFAULT_EXTENSIONS.join(","),
  formats: ["PDF", "Word", "PowerPoint", "Excel", "Text & code", "Images"],
};

let pending: Promise<UploadConfig> | null = null;

export function loadUploadConfig(): Promise<UploadConfig> {
  pending ??= api.uploadConfig()
    .then(config => ({ ...DEFAULT_UPLOAD_CONFIG, ...config }))
    .catch(() => {
      pending = null; // retry on the next page that needs it
      return DEFAULT_UPLOAD_CONFIG;
    });
  return pending;
}

export function useUploadConfig(): UploadConfig {
  const [config, setConfig] = useState(DEFAULT_UPLOAD_CONFIG);
  useEffect(() => {
    let active = true;
    void loadUploadConfig().then(value => { if (active) setConfig(value); });
    return () => { active = false; };
  }, []);
  return config;
}

export function fileExtension(name: string) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index).toLowerCase() : "";
}

/** "PDF, Word, PowerPoint or images", in the current UI language. */
export function formatList(config: UploadConfig) {
  const formats = config.formats.length
    ? config.formats.map(format => i18n.t(`upload.formats.${format}`, { defaultValue: format }))
    : [i18n.t("upload.documents")];
  return formats.length === 1 ? formats[0] : `${formats.slice(0, -1).join(", ")} ${i18n.t("upload.or")} ${formats[formats.length - 1]}`;
}

/** Returns a user-facing error, or null when every file can be uploaded. */
export function validateFiles(files: File[], config: UploadConfig, alreadyAttached = 0): string | null {
  if (alreadyAttached + files.length > config.maxAttachments) {
    return i18n.t("upload.tooMany", { count: config.maxAttachments });
  }
  const tooLarge = files.filter(file => file.size > config.maxFileSizeBytes);
  if (tooLarge.length) return i18n.t("upload.tooLarge", { names: tooLarge.map(file => file.name).join(", "), size: config.maxFileSizeMb });
  const supported = new Set(config.extensions.map(extension => extension.toLowerCase()));
  const unsupported = files.filter(file => !supported.has(fileExtension(file.name)));
  if (unsupported.length) return i18n.t("upload.unsupported", { names: unsupported.map(file => file.name).join(", "), formats: formatList(config) });
  return null;
}

/** Runs `task` for every item with at most `limit` running at once. */
export async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
