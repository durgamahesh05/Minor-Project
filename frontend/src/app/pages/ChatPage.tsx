import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, MessageSquare, ArrowDown, MoreHorizontal, Trash2, Pencil, ChevronDown } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type Conversation, type Message, type ResponseLevel, type DocumentAttachment } from "../lib/api";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { useTranslation } from "react-i18next";
import Sidebar, { NavItem } from "../components/layout/Sidebar";
import Header from "../components/layout/Header";
import ChatInput from "../components/chat/ChatInput";
import MessageList from "../components/chat/MessageList";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../components/ui/dropdown-menu";

import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../components/ui/dialog";

export default function ChatPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { theme } = useTheme();
  const { language } = useLanguage();
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [renamingConversation, setRenamingConversation] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingRename, setSavingRename] = useState(false);
  const renamePending = useRef(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [responseLevel, setResponseLevel] = useState<ResponseLevel>("simple");
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [activeDocuments, setActiveDocuments] = useState<DocumentAttachment[]>([]);
  const [documentProcessing, setDocumentProcessing] = useState(false);
  const documentState = useRef<{ ids: string[]; processing: boolean }>({ ids: [], processing: false });
  const sending = useRef(false);
  const [composerKey, setComposerKey] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const newConversation = useRef<string | null>(null);
  const scrollOnUpdate = useRef(false);
  const [showLatest, setShowLatest] = useState(false);
  const updateScrollState = () => {
    const panel = scrollRef.current;
    if (panel) setShowLatest(panel.scrollHeight - panel.scrollTop - panel.clientHeight > 100);
  };
  useLayoutEffect(() => {
    const panel = scrollRef.current;
    if (panel && scrollOnUpdate.current) {
      panel.scrollTop = panel.scrollHeight;
      scrollOnUpdate.current = false;
    }
    updateScrollState();
  }, [messages, isTyping, loadingMessages]);
  const updateDocumentState = (documents: DocumentAttachment[], processing: boolean) => {
    documentState.current = { ids: documents.map(document => document.id), processing };
    setDocumentProcessing(processing);
    if (!processing) setActiveDocuments(documents);
  };

  const c = getThemeColors(theme);
  const hasMessages = messages.length > 0 || isTyping;

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const onResize = () => setSidebarOpen(media.matches);
    media.addEventListener("change", onResize);
    return () => media.removeEventListener("change", onResize);
  }, []);

  useEffect(() => {
    api.listConversations().then(({ conversations }) => setConversations(conversations)).catch(() => setSendError("Unable to load chat history. Please refresh to try again."));
  }, []);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }
    if (newConversation.current === activeConversationId) {
      newConversation.current = null;
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    api
      .getMessages(activeConversationId)
      .then(({ messages }) => {
        if (cancelled) return;
        scrollOnUpdate.current = true;
        setMessages(messages);
        const lastUserMessage = [...messages].reverse().find(message => message.role === "user");
        const attached = lastUserMessage?.attachments ?? (lastUserMessage?.attachment ? [lastUserMessage.attachment] : []);
        updateDocumentState(attached, false);
        setActiveDocuments([]);
      })
      .catch(() => { if (!cancelled) setSendError("Unable to load this conversation. Please try again."); })
      .finally(() => { if (!cancelled) setLoadingMessages(false); });
    return () => { cancelled = true; };
  }, [activeConversationId]);

  const handleNewChat = () => {
    if (documentState.current.processing || sending.current) return;
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    updateDocumentState([], false);
    setComposerKey(key => key + 1);
    setSendError(null);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleDeleteConversation = async (id: string) => {
    if (sending.current || documentState.current.processing || deletingConversationId) return;
    setDeletingConversationId(id);
    setSendError(null);
    try {
      await api.deleteConversation(id);
      setConversations(previous => previous.filter(conversation => conversation.id !== id));
      if (activeConversationId === id) handleNewChat();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Unable to delete chat. Please try again.");
    } finally {
      setDeletingConversationId(null);
    }
  };

  const handleRenameConversation = async () => {
    if (!renamingConversation || !renameTitle.trim() || renamePending.current) return;
    renamePending.current = true;
    setSavingRename(true);
    setRenameError(null);
    try {
      const { conversation } = await api.renameConversation(renamingConversation.id, renameTitle.trim());
      setConversations(previous => previous.map(item => item.id === conversation.id ? conversation : item));
      setRenamingConversation(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Unable to rename chat. Please try again.");
    } finally {
      renamePending.current = false;
      setSavingRename(false);
    }
  };

  const handleSend = async (submittedText?: string) => {
    const text = (submittedText ?? input).trim();
    if (!text || sending.current || documentState.current.processing || loadingMessages || deletingConversationId) return;
    sending.current = true;
    setSendError(null);
    setInput("");
    setIsTyping(true);
    const pendingId = `pending-${crypto.randomUUID()}`;
    scrollOnUpdate.current = true;
    setMessages(prev => [...prev, { id: pendingId, role: "user", text, createdAt: new Date().toISOString(), attachments: activeDocuments }]);
    try {
      let convId = activeConversationId;
      if (!convId) {
        const { conversation } = await api.createConversation(text.slice(0, 60));
        convId = conversation.id;
        newConversation.current = convId;
        setActiveConversationId(convId);
        setConversations(prev => [conversation, ...prev]);
      }
      const { userMessage, assistantMessage } = await api.sendMessage(convId, text, language, undefined, responseLevel, documentState.current.ids);
      setMessages(prev => [...prev.map(message => message.id === pendingId ? userMessage : message), assistantMessage]);
      // Clear the upload tray, but retain documentState for follow-up questions.
      setActiveDocuments([]);
    } catch (error) {
      setMessages(prev => prev.filter(message => message.id !== pendingId));
      setInput(current => current || text);
      setSendError(error instanceof Error ? error.message : "Unable to send your message. Please try again.");
    } finally {
      sending.current = false;
      setIsTyping(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden" style={{ background: c.main, fontFamily: "'Inter', sans-serif" }}>
      <Dialog open={renamingConversation !== null} onOpenChange={open => { if (!open && !renamePending.current) setRenamingConversation(null); }}>
        <DialogContent style={{ background: c.sidebar, color: c.sbFg, borderColor: c.sbBorder }}>
          <DialogTitle>Rename chat</DialogTitle>
          <DialogDescription>Choose a name for this conversation.</DialogDescription>
          <form onSubmit={event => { event.preventDefault(); void handleRenameConversation(); }} className="space-y-4">
            <label htmlFor="chat-title" className="block text-sm">Chat name</label>
            <input id="chat-title" value={renameTitle} onChange={event => setRenameTitle(event.target.value)}
              onFocus={event => event.target.select()} maxLength={80} required disabled={savingRename}
              className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-violet-500"
              style={{ background: c.main, borderColor: c.sbBorder }} />
            {renameError && <p role="alert" className="text-sm text-destructive">{renameError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={savingRename} onClick={() => setRenamingConversation(null)} className="rounded-lg px-4 py-2">Cancel</button>
              <button type="submit" disabled={savingRename || !renameTitle.trim()} className="rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50">{savingRename ? "Saving?" : "Save"}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {sidebarOpen && <button aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="absolute inset-0 z-30 bg-black/40 md:hidden" />}
      <div className="flex shrink-0 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40">
      <Sidebar
        c={c}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        onLogout={handleLogout}
      >
        <NavItem c={c} icon={Plus} label="New chat" onClick={handleNewChat} />
        {user && <button
          type="button"
          aria-expanded={historyOpen}
          aria-controls="chat-history-list"
          onClick={() => setHistoryOpen(previous => !previous)}
          className="flex w-full items-center gap-1 px-3 pb-2 pt-4 text-xs font-medium"
          style={{ color: c.sbText }}
        >
          Chat history <ChevronDown size={14} className={`transition-transform ${historyOpen ? "" : "-rotate-90"}`} />
        </button>}
        <div id="chat-history-list" hidden={!historyOpen}>
        {user && conversations.length === 0 && <p className="px-3 py-2 text-xs" style={{ color: c.sbText }}>No chats yet</p>}
        {user &&
          conversations.map(conv => (
            <div key={conv.id} className="group/chat flex items-center rounded-xl hover:bg-[var(--chat-hover)]" style={{ "--chat-hover": c.sbHover, background: conv.id === activeConversationId ? c.sbHover : undefined } as React.CSSProperties}>
            <div className="flex-1 min-w-0">
            <NavItem
              key={conv.id}
              c={c}
              icon={MessageSquare}
              label={conv.title || t("newChat")}
              active={conv.id === activeConversationId}
              onClick={() => {
                if (documentState.current.processing || sending.current || deletingConversationId) return;
                if (conv.id === activeConversationId) return;
                setActiveConversationId(conv.id);
                setMessages([]);
                setInput("");
                updateDocumentState([], false);
                setComposerKey(key => key + 1);
                setSendError(null);
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
            />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Options for ${conv.title || t("newChat")}`}
                  title="Chat options"
                  disabled={isTyping || documentProcessing || deletingConversationId !== null}
                  className="mr-1 shrink-0 rounded-lg p-1.5 opacity-0 transition-opacity group-hover/chat:opacity-100 group-focus-within/chat:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100 disabled:opacity-40"
                  style={{ color: c.sbFg }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" style={{ background: c.sidebar, color: c.sbFg, borderColor: c.sbBorder }}>
                <DropdownMenuItem onSelect={() => {
                  setRenamingConversation(conv);
                  setRenameTitle(conv.title);
                  setRenameError(null);
                }}>
                  <Pencil size={14} /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => void handleDeleteConversation(conv.id)}>
                  <Trash2 size={14} /> Delete chat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          ))}
        </div>
      </Sidebar>
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <Header c={c} sidebarOpen={sidebarOpen} onOpenSidebar={() => setSidebarOpen(true)} user={user} />

        <div role="main" ref={scrollRef} onScroll={updateScrollState} className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ scrollbarGutter: "stable", overflowAnchor: "none" }}>
          {loadingMessages ? (
            <div className="h-full flex items-center justify-center text-sm" style={{ color: c.mainSub }}>
              {t("loading")}
            </div>
          ) : !hasMessages ? (
            <div className="h-full flex flex-col items-center justify-center gap-6 px-4 pb-24">
              <h1 className="text-[28px] font-semibold text-center" style={{ color: c.mainFg, ...JK }}>
                {t("begin")}
              </h1>
              <button
                className="px-4 py-1.5 rounded-full text-[13px] font-medium transition-opacity hover:opacity-80"
                style={{ background: c.chipBg, border: `1px solid ${c.chipBorder}`, color: c.mainFg }}
                onClick={() => setInput(t("whatCanYouDo"))}
              >
                {t("whatCanYouDo")}
              </button>
            </div>
          ) : (
            <MessageList c={c} messages={messages} isTyping={isTyping} />
          )}
        </div>

          <div className="relative flex-shrink-0 px-3 sm:px-6 pb-3 pt-2">
            {showLatest && <button type="button" onClick={() => {
              const panel = scrollRef.current;
              if (panel) panel.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
            }} className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-sm" style={{ background: c.inputBg, color: c.mainFg, borderColor: c.inputBorder }}><ArrowDown size={14} />Latest message</button>}
            <div className="max-w-[720px] mx-auto space-y-2">
              <div className="mb-2 flex items-center gap-2 px-2 text-xs" style={{ color: c.mainSub }}>
                <label htmlFor="response-level">Response detail</label>
                <select id="response-level" value={responseLevel} onChange={event => setResponseLevel(event.target.value as ResponseLevel)} disabled={isTyping}
                  className="rounded-lg border px-2 py-1" style={{ background: c.main, color: c.mainFg, borderColor: c.inputBorder }}
                  title="Instructions in your message override this preference">
                  <option value="auto">Auto</option>
                  <option value="simple">Simple</option>
                  <option value="detailed">Detailed</option>
                  <option value="deep">Deep</option>
                </select>
              </div>
              <ChatInput key={composerKey} c={c} value={input} onChange={setInput} onSend={handleSend} onDocumentStateChange={updateDocumentState} existingDocuments={activeDocuments} disabled={isTyping || documentProcessing || loadingMessages} />
              {sendError && <p role="alert" className="text-sm text-red-500">{sendError}</p>}
              <p className="text-[10px] text-center font-mono" style={{ color: c.mainSub }}>
                {t("disclaimer")}
              </p>
            </div>
          </div>

      </div>
    </div>
  );
}
