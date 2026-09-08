import { useState } from "react";
import { Check, ArrowRight } from "lucide-react";

const JK = { fontFamily: "'Plus Jakarta Sans', sans-serif" };

export default function ContactCard() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });

  const handleSubmit = () => {
    if (form.name && form.email && form.message) setSubmitted(true);
  };

  return (
    <div className="p-8 rounded-2xl border border-[rgba(255,255,255,0.07)]" style={{ background: "#0a1020" }}>
      {submitted ? (
        <div className="h-full flex flex-col items-center justify-center text-center gap-5 py-10">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(124,90,240,0.12)", border: "1px solid rgba(124,90,240,0.28)" }}
          >
            <Check size={22} strokeWidth={1.5} className="text-[#a78bfa]" />
          </div>
          <h3 className="text-[22px] font-bold text-white" style={JK}>Message sent!</h3>
          <p className="text-[14px] text-[#8a9ab8] max-w-[260px]">We'll get back to you within 24 hours.</p>
          <button
            onClick={() => { setSubmitted(false); setForm({ name: "", email: "", message: "" }); }}
            className="text-[13px] text-[#7c5af0] hover:text-[#a78bfa] transition-colors font-mono mt-1"
          >
            Send another →
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <h3 className="text-[19px] font-bold text-white mb-6" style={JK}>Send us a message</h3>

          {[
            { label: "Full name", key: "name", type: "text", ph: "Alex Chen" },
            { label: "Email address", key: "email", type: "email", ph: "alex@university.edu" },
          ].map(f => (
            <div key={f.key}>
              <label className="text-[10px] font-mono uppercase tracking-[0.1em] text-[#6b7a99] mb-1.5 block">
                {f.label}
              </label>
              <input
                type={f.type}
                placeholder={f.ph}
                value={form[f.key as keyof typeof form]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="w-full rounded-xl px-4 py-2.5 text-[13px] text-[#e2e6f0] placeholder:text-[#3d4f6b] focus:outline-none focus:ring-1 focus:ring-[#7c5af0]/30 transition-colors"
                style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.09)" }}
              />
            </div>
          ))}

          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.1em] text-[#6b7a99] mb-1.5 block">Message</label>
            <textarea
              rows={4}
              placeholder="Tell us how we can help…"
              value={form.message}
              onChange={e => setForm(prev => ({ ...prev, message: e.target.value }))}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] text-[#e2e6f0] placeholder:text-[#3d4f6b] focus:outline-none focus:ring-1 focus:ring-[#7c5af0]/30 transition-colors resize-none"
              style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.09)" }}
            />
          </div>

          <button
            onClick={handleSubmit}
            className="w-full py-3 rounded-xl text-[14px] font-semibold text-white bg-[#7c5af0] hover:bg-[#6d4de0] transition-colors flex items-center justify-center gap-2"
            style={JK}
          >
            Send message <ArrowRight size={14} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}
