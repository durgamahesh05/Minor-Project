import { Check } from "lucide-react";
import { pricingPlans } from "../lib/pricingPlans";

const JK = { fontFamily: "'Plus Jakarta Sans', sans-serif" };

export default function PricingCards({ onCta }: { onCta: (cta: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-[920px] mx-auto">
      {pricingPlans.map(p => (
        <div
          key={p.name}
          className={`p-6 rounded-2xl flex flex-col relative ${
            p.highlight ? "border-2 border-[#7c5af0]" : "border border-[rgba(255,255,255,0.07)]"
          }`}
          style={{ background: p.highlight ? "#0d0a1f" : "#0a1020" }}
        >
          {p.highlight && (
            <div
              className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-mono font-semibold text-white uppercase tracking-wider"
              style={{ background: "#7c5af0" }}
            >
              Most popular
            </div>
          )}

          <div className="mb-6">
            <h3 className="text-[16px] font-bold text-white mb-1" style={JK}>{p.name}</h3>
            <p className="text-[12px] text-[#6b7a99] font-mono mb-4">{p.desc}</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[38px] font-bold text-white tabular-nums" style={JK}>{p.price}</span>
              <span className="text-[12px] font-mono text-[#6b7a99]">/ {p.period}</span>
            </div>
          </div>

          <ul className="space-y-3 flex-1 mb-7">
            {p.features.map(f => (
              <li key={f} className="flex items-start gap-2.5 text-[13px] text-[#a8b4cc]">
                <Check size={13} strokeWidth={2} className="text-[#7c5af0] mt-0.5 flex-shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={() => onCta(p.cta)}
            className={`w-full py-3 rounded-xl text-[13px] font-semibold transition-colors ${
              p.highlight ? "bg-[#7c5af0] hover:bg-[#6d4de0] text-white" : "bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.1)] text-white"
            }`}
            style={JK}
          >
            {p.cta}
          </button>
        </div>
      ))}
    </div>
  );
}
