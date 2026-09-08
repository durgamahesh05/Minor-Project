import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, MessageSquare } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, type Conversation, type Message } from "../lib/api";
import { getThemeColors, JK } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { useTranslation } from "react-i18next";
import Sidebar, { NavItem } from "../components/layout/Sidebar";
import Header from "../components/layout/Header";
import ChatInput from "../components/chat/ChatInput";
import MessageList from "../components/chat/MessageList";

export default function ChatPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { theme } = useTheme();
  const { language } = useLanguage();
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const c = getThemeColors(theme);
  const hasMessages = messages.length > 0 || isTyping;

  useEffect(() => {
    api.listConversations().then(({ conversations }) => setConversations(conversations));
  }, []);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    api
      .getMessages(activeConversationId)
      .then(({ messages }) => setMessages(messages))
      .finally(() => setLoadingMessages(false));
  }, [activeConversationId]);

  const handleNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
  };

  const handleSend = async (submittedText?: string) => {
    const text = (submittedText ?? input).trim();
    if (!text || isTyping) return;
    setInput("");
    setIsTyping(true);
    try {
      let convId = activeConversationId;
      if (!convId) {
        const { conversation } = await api.createConversation(text.slice(0, 60));
        convId = conversation.id;
        setActiveConversationId(convId);
        setConversations(prev => [conversation, ...prev]);
      }
      const { userMessage, assistantMessage } = await api.sendMessage(convId, text, language);
      setMessages(prev => [...prev, userMessage, assistantMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: c.main, fontFamily: "'Inter', sans-serif" }}>
      <Sidebar
        c={c}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        onLogout={handleLogout}
      >
        <NavItem c={c} icon={Plus} label="New chat" onClick={handleNewChat} />
        {user &&
          conversations.map(conv => (
            <NavItem
              key={conv.id}
              c={c}
              icon={MessageSquare}
              label={conv.title || t("newChat")}
              active={conv.id === activeConversationId}
              onClick={() => setActiveConversationId(conv.id)}
            />
          ))}
      </Sidebar>

      <div className="flex-1 flex flex-col min-w-0">
        <Header c={c} sidebarOpen={sidebarOpen} onOpenSidebar={() => setSidebarOpen(true)} user={user} />

        <div className="flex-1 overflow-y-auto">
          {loadingMessages ? (
            <div className="h-full flex items-center justify-center text-sm" style={{ color: c.mainSub }}>
              {t("loading")}
            </div>
          ) : !hasMessages ? (
            <div className="h-full flex flex-col items-center justify-center gap-6 px-4 pb-24">
              <h1 className="text-[28px] font-semibold text-center" style={{ color: c.mainFg, ...JK }}>
                {t("begin")}
              </h1>
              <div className="w-full max-w-[680px]">
                <ChatInput c={c} value={input} onChange={setInput} onSend={handleSend} disabled={isTyping} />
              </div>
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

        {hasMessages && (
          <div className="flex-shrink-0 px-6 pb-5 pt-2">
            <div className="max-w-[720px] mx-auto space-y-2">
              <ChatInput c={c} value={input} onChange={setInput} onSend={handleSend} disabled={isTyping} />
              <p className="text-[10px] text-center font-mono" style={{ color: c.mainSub }}>
                {t("disclaimer")}
              </p>
            </div>
          </div>
        )}

        {!hasMessages && !loadingMessages && (
          <div className="flex-shrink-0 px-6 pb-4">
            <p className="text-[11px] text-center font-mono" style={{ color: c.mainSub }}>
              Synapse is AI. By using it, you agree to our{" "}
              <button className="underline hover:opacity-80 transition-opacity">Terms</button> &{" "}
              <button className="underline hover:opacity-80 transition-opacity">Privacy Policy</button>. Chats may be
              reviewed to improve our AI models.{" "}
              <button className="underline hover:opacity-80 transition-opacity">Learn more</button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
