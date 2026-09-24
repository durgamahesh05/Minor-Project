import type { Document } from "./api";

const DATABASE = "synapse-ai";
const STORE = "documents";
const DIRECTORY = "documents";

export type LocalDocumentMetadata = {
  clientDocumentId: string;
  serverId?: string;
  name: string;
  type: string;
  size: number;
  status: "processing" | "indexed" | "failed";
  createdAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "clientDocumentId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putMetadata(metadata: LocalDocumentMetadata) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(metadata);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function removeMetadata(clientDocumentId: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(clientDocumentId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function listLocalDocuments(): Promise<LocalDocumentMetadata[]> {
  const database = await openDatabase();
  const records = await new Promise<LocalDocumentMetadata[]>((resolve, reject) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as LocalDocumentMetadata[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return records;
}

async function documentDirectory() {
  if (!navigator.storage?.getDirectory) throw new Error("Private browser file storage is not supported in this browser.");
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create: true });
}

export async function beginLocalDocument(file: File) {
  const clientDocumentId = crypto.randomUUID();
  const directory = await documentDirectory();
  const handle = await directory.getFileHandle(clientDocumentId, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  await putMetadata({
    clientDocumentId,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    status: "processing",
    createdAt: new Date().toISOString(),
  });
  return clientDocumentId;
}

export async function markLocalDocumentIndexed(document: Document) {
  if (document.status !== "indexed") throw new Error("The document has not finished indexing. Please try uploading it again.");
  if (!document.clientDocumentId) return;
  await putMetadata({
    clientDocumentId: document.clientDocumentId,
    serverId: document.id,
    name: document.originalName,
    type: document.mimeType,
    size: document.size,
    status: "indexed",
    createdAt: document.createdAt,
  });
}

export async function deleteLocalDocument(clientDocumentId?: string) {
  if (!clientDocumentId) return;
  try {
    const directory = await documentDirectory();
    await directory.removeEntry(clientDocumentId);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
  await removeMetadata(clientDocumentId);
}

export async function clearAllLocalDocuments() {
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(DIRECTORY, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function downloadLocalDocument(document: Pick<Document, "clientDocumentId" | "originalName">) {
  if (!document.clientDocumentId) throw new Error("This document is not stored in this browser.");
  const directory = await documentDirectory();
  const handle = await directory.getFileHandle(document.clientDocumentId);
  const file = await handle.getFile();
  const url = URL.createObjectURL(file);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = document.originalName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function chooseDocumentFile(): Promise<File | undefined> {
  const picker = (window as Window & { showOpenFilePicker?: (options: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
  if (!picker) return undefined;
  const [handle] = await picker.call(window, {
    multiple: false,
    types: [{
      description: "Study documents",
      accept: {
        "application/pdf": [".pdf"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
        "text/plain": [".txt"],
        "image/*": [".png", ".jpg", ".jpeg", ".webp"],
      },
    }],
  });
  return handle?.getFile();
}
