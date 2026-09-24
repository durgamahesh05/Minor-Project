import { Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type { ThemeColors } from "../../lib/theme";
import type { Message } from "../../lib/api";
import { useTranslation } from "react-i18next";

type Props = {
  c: ThemeColors;
  messages: Message[];
  isTyping: boolean;
};

export default function MessageList({ c, messages, isTyping }: Props) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-[768px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      {messages.map(m => (
        <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
          {m.role === "assistant" && (
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "#7c5af0" }}>
              <Brain size={14} strokeWidth={2} className="text-white" />
            </div>
          )}
          <div
            className={`min-w-0 break-words text-[14px] leading-[1.7] ${
              m.role === "user" ? "max-w-[85%] px-4 py-3 rounded-2xl rounded-tr-md" : "flex-1 py-1"
            }`}
            style={{
              background: m.role === "user" ? c.userBubble : "transparent",
              border: m.role === "user" ? `1px solid ${c.userBorder}` : "none",
              color: c.mainFg,
            }}
          >
            {m.role === "assistant" ? (
              <div className="message-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {m.text}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
            )}
          </div>
        </div>
      ))}

      {isTyping && (
        <div className="flex gap-3">
          <span className="sr-only">{t("loading")}</span>
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "#7c5af0" }}>
            <Brain size={14} strokeWidth={2} className="text-white" />
          </div>
          <div role="status" className="flex items-center gap-1.5 py-3">
            <span className="mr-2 text-xs" style={{ color: c.mainSub }}>Preparing your answer</span>
            {[0, 1, 2].map(j => (
              <span
                key={j}
                className="w-2 h-2 rounded-full animate-bounce"
                style={{ background: "#7c5af0", opacity: 0.7, animationDelay: `${j * 0.15}s`, animationDuration: "0.9s" }}
              />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
