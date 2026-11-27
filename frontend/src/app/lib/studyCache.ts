import type { Document, FlashcardSet, FlashcardSetSummary, Quiz, QuizSummary } from "./api";

/**
 * Per-user, per-tab cache for study pages (stale-while-revalidate).
 * Pages render cached data immediately, then refresh it from the server, so
 * revisiting a dashboard or a quiz does not wait on the network.
 */
export type StudyKind = "quiz" | "flashcards";
type Summary = QuizSummary | FlashcardSetSummary;
type Item = Quiz | FlashcardSet;

const PREFIX = "synapse-study:";
const memory = new Map<string, unknown>();

function read<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw) {
      const value = JSON.parse(raw) as T;
      memory.set(key, value);
      return value;
    }
  } catch { /* storage unavailable or corrupt: fall back to the network */ }
  return undefined;
}

function write(key: string, value: unknown) {
  memory.set(key, value);
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* quota or private mode */ }
}

function remove(key: string) {
  memory.delete(key);
  try { sessionStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

const listKey = (user: string, kind: StudyKind) => `${user}:list:${kind}`;
const itemKey = (user: string, kind: StudyKind, id: string) => `${user}:item:${kind}:${id}`;

export const studyCache = {
  list: (user: string, kind: StudyKind) => read<Summary[]>(listKey(user, kind)),
  setList: (user: string, kind: StudyKind, items: Summary[]) => write(listKey(user, kind), items),
  documents: (user: string) => read<Document[]>(`${user}:documents`),
  setDocuments: (user: string, documents: Document[]) => write(`${user}:documents`, documents),
  item: <T extends Item>(user: string, kind: StudyKind, id: string) => read<T>(itemKey(user, kind, id)),
  setItem: (user: string, kind: StudyKind, item: Item) => write(itemKey(user, kind, item.id), item),
  /** Adds a newly generated item to the cached list and caches its content. */
  added: (user: string, kind: StudyKind, item: Item) => {
    write(itemKey(user, kind, item.id), item);
    const count = "questions" in item ? item.questions.length : item.cards.length;
    const summary = { id: item.id, title: item.title, documentId: item.documentId, createdAt: item.createdAt, itemCount: count };
    const list = read<Summary[]>(listKey(user, kind)) ?? [];
    write(listKey(user, kind), [summary, ...list.filter(entry => entry.id !== item.id)]);
  },
  renamed: (user: string, kind: StudyKind, id: string, title: string) => {
    const list = read<Summary[]>(listKey(user, kind));
    if (list) write(listKey(user, kind), list.map(entry => entry.id === id ? { ...entry, title } : entry));
    const item = read<Item>(itemKey(user, kind, id));
    if (item) write(itemKey(user, kind, id), { ...item, title });
  },
  removed: (user: string, kind: StudyKind, id: string) => {
    remove(itemKey(user, kind, id));
    const list = read<Summary[]>(listKey(user, kind));
    if (list) write(listKey(user, kind), list.filter(entry => entry.id !== id));
  },
};

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** True on data-saver or 2G/3G connections, where avoidable downloads are skipped. */
export function isSlowConnection() {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(connection?.saveData || (connection?.effectiveType && /(^|-)2g$|^3g$/.test(connection.effectiveType)));
}
