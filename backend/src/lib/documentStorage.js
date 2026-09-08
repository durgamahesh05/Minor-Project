import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const bucket = process.env.SUPABASE_STORAGE_BUCKET || "documents";

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

function filenameFor(file) {
  return `${crypto.randomBytes(16).toString("hex")}${path.extname(file.originalname)}`;
}

function fileTypeFor(file) {
  const extension = path.extname(file.originalname).slice(1).toLowerCase();
  return extension || file.mimetype || "unknown";
}

function requiredSupabaseClient() {
  const client = supabaseClient();
  if (!client) {
    throw new Error("Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return client;
}

export async function saveDocument(file, userId) {
  const filename = filenameFor(file);
  const client = requiredSupabaseClient();
  const storagePath = `${userId}/${filename}`;
  const { error } = await client.storage.from(bucket).upload(storagePath, file.buffer, {
    contentType: file.mimetype || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  return { storageProvider: "supabase", storagePath, storedFilename: filename };
}

export async function createDocumentMetadata({ userId, file, storage }) {
  const client = requiredSupabaseClient();
  const { data, error } = await client
    .from("documents")
    .insert({
      user_id: userId.toString(),
      file_name: file.originalname,
      file_path: storage.storagePath,
      file_type: fileTypeFor(file),
      file_size: file.size,
      status: "ready",
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(`Supabase document metadata failed: ${error?.message ?? "no id returned"}`);
  return data.id;
}

export async function deleteDocumentMetadata(metadataId) {
  if (!metadataId) return;
  const client = requiredSupabaseClient();
  const { error } = await client.from("documents").delete().eq("id", metadataId);
  if (error) throw new Error(`Supabase document metadata delete failed: ${error.message}`);
}

export async function deleteDocumentFile(document) {
  if (document.storageProvider === "supabase" && document.storagePath) {
    const client = supabaseClient();
    if (!client) throw new Error("Supabase Storage is not configured");
    const { error } = await client.storage.from(bucket).remove([document.storagePath]);
    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
    return;
  }
  // Supports documents uploaded before Supabase Storage was enabled.
  const UPLOAD_DIR = path.resolve("uploads");
  await fs.unlink(path.join(UPLOAD_DIR, document.storedFilename)).catch(err => {
    if (err.code !== "ENOENT") throw err;
  });
}

export async function getDocumentDownloadUrl(document) {
  if (document.storageProvider === "supabase" && document.storagePath) {
    const client = supabaseClient();
    if (!client) throw new Error("Supabase Storage is not configured");
    const { data, error } = await client.storage.from(bucket).createSignedUrl(document.storagePath, 60, {
      download: document.originalName,
    });
    if (error || !data?.signedUrl) throw new Error(`Supabase download failed: ${error?.message ?? "no URL returned"}`);
    return data.signedUrl;
  }
  return null;
}
