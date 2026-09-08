import { useEffect, useRef } from "react";
import { Brain } from "lucide-react";
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  return (
    <div className="max-w-[720px] mx-auto px-6 py-8 space-y-6">
      {messages.map(m => (
        <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
          {m.role === "assistant" && (
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "#7c5af0" }}>
              <Brain size={14} strokeWidth={2} className="text-white" />
            </div>
          )}
          <div
            className={`max-w-[82%] text-[14px] leading-[1.7] ${
              m.role === "user" ? "px-4 py-3 rounded-2xl rounded-tr-md" : "py-1"
            }`}
            style={{
              background: m.role === "user" ? c.userBubble : "transparent",
              border: m.role === "user" ? `1px solid ${c.userBorder}` : "none",
              color: c.mainFg,
            }}
          >
            {m.text}
          </div>
        </div>
      ))}

      {isTyping && (
        <div className="flex gap-3">
          <span className="sr-only">{t("loading")}</span>
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "#7c5af0" }}>
            <Brain size={14} strokeWidth={2} className="text-white" />
          </div>
          <div className="flex items-center gap-1.5 py-3">
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

      <div ref={bottomRef} />
    </div>
  );
}
