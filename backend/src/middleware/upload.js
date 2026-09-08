import multer from "multer";

export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;

export const upload = multer({
  // Files are forwarded directly to Supabase Storage and never written to the
  // application server. MIME types are intentionally unrestricted: storage
  // accepts any file type, subject to the 20 MB limit.
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
});
