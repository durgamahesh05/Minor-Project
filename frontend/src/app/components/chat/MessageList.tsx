import DocumentCard from "./DocumentCard";
import { Link } from "react-router";
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
          <div className={`min-w-0 text-[14px] leading-[1.7] ${m.role === "user" ? "flex max-w-[90%] flex-col items-end gap-2" : "flex-1 py-1"}`} style={{ color: c.mainFg }}>
            {m.role === "user" && (m.attachments ?? (m.attachment ? [m.attachment] : [])).map(document => <DocumentCard key={document.id} document={document} c={c} />)}
            {m.role === "assistant" ? (
              <div className="message-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {m.text}
                </ReactMarkdown>
                {m.studyActions?.map(action => (
                  <Link key={action.kind}
                    to={action.id ? `/${action.kind}/${action.id}` : `/${action.kind}`}
                    className="inline-flex mt-3 mr-3 rounded-full px-4 py-2 text-sm font-semibold"
                    style={{ background: "#7c5af0", color: "white" }}>
                    {action.id ? (action.kind === "quiz" ? "Start quiz" : "Study flashcards") : (action.kind === "quiz" ? "Open quiz dashboard" : "Open flashcards dashboard")}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-md px-4 py-3" style={{ background: c.userBubble, border: `1px solid ${c.userBorder}` }}>{m.text}</div>
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
