import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import {
  Brain, Upload, MessageSquare, FileText, CreditCard, HelpCircle, Search,
  ArrowRight, Menu, X, Zap, Mail, MapPin,
  Twitter, Github, Linkedin, ArrowUp,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import ContactCard from "../components/ContactCard";
import PricingCards from "../components/PricingCards";
import FloatingQRWidget from "../components/FloatingQRWidget";

const JK = { fontFamily: "'Plus Jakarta Sans', sans-serif" };

export default function LandingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Every other page manages its own internal scroll region (the app-wide
  // `overflow: hidden` on html/body prevents accidental page panning — see
  // frontend/index.html). This page is the one exception: a long marketing
  // page that genuinely needs the whole document to scroll.
  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => {
      document.body.style.overflow = "hidden";
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Supports links like "/#contact" from other pages (e.g. the Pricing page).
  useEffect(() => {
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }));
    }
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  };

  const goToApp = () => navigate(user ? "/chat" : "/register");

  const nav = [
    { label: "Home",         id: "home" },
    { label: "Features",     id: "features" },
    { label: "How it works", id: "how-it-works" },
    { label: "Pricing",      id: "pricing" },
    { label: "Contact",      id: "contact" },
  ];

  const features = [
    {
      icon: Upload,
      title: "Smart Upload",
      desc: "Drop any PDF, DOCX, or PPTX. Synapse extracts structure, key concepts, and metadata — ready to study in under a minute.",
      color: "#7c5af0",
    },
    {
      icon: MessageSquare,
      title: "Chat / Q&A",
      desc: "Ask questions in plain language. Synapse searches across everything you've uploaded and answers with page-level citations.",
      color: "#38bdf8",
    },
    {
      icon: FileText,
      title: "AI Summaries",
      desc: "Get your 8,000-word chapter down to 400 focused words. Choose brief, standard, or detailed — then export to PDF or Notion.",
      color: "#34d399",
    },
    {
      icon: CreditCard,
      title: "Flashcards",
      desc: "Synapse generates a full flashcard deck from any document. Review with spaced repetition and track exactly what you know.",
      color: "#f59e0b",
    },
    {
      icon: HelpCircle,
      title: "Adaptive Quizzes",
      desc: "Multiple-choice quizzes built from your actual material. Explanations for every answer so you learn even when you're wrong.",
      color: "#f472b6",
    },
    {
      icon: Search,
      title: "Semantic Search",
      desc: "Search by meaning, not keywords. Ask a conceptual question and get the exact paragraph — not just word matches.",
      color: "#a78bfa",
    },
  ];

  const steps = [
    {
      n: "01",
      title: "Upload your material",
      desc: "Drop lecture notes, textbook chapters, research papers, or slides. PDF, DOCX, PPTX, and TXT up to 50 MB — all supported.",
    },
    {
      n: "02",
      title: "Synapse reads it for you",
      desc: "In under 60 seconds, Synapse extracts concepts, structure, and meaning — generating a summary, flashcard set, and search index automatically.",
    },
    {
      n: "03",
      title: "Study on your terms",
      desc: "Chat with your material, quiz yourself, review flashcards, or search by concept. Everything stays in sync across your workspace.",
    },
  ];

  return (
    <div className="min-h-screen bg-[#080d1a] text-[#e2e6f0]" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
          scrolled ? "bg-[#080d1a]/96 backdrop-blur-md border-b border-[rgba(255,255,255,0.07)]" : ""
        }`}
      >
        <div className="max-w-[1160px] mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <button onClick={() => scrollTo("home")} className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7c5af0] flex items-center justify-center">
              <Brain size={16} strokeWidth={2} className="text-white" />
            </div>
            <span className="text-[15px] font-bold text-white" style={JK}>Synapse</span>
          </button>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {nav.map(l => (
              <button
                key={l.id}
                onClick={() => scrollTo(l.id)}
                className="px-4 py-2 rounded-lg text-[13px] text-[#8a9ab8] hover:text-white transition-colors"
              >
                {l.label}
              </button>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <button
                onClick={goToApp}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-[#7c5af0] hover:bg-[#6d4de0] transition-colors"
                style={JK}
              >
                Go to app
              </button>
            ) : (
              <>
                <Link to="/login" className="px-4 py-2 rounded-lg text-[13px] text-[#8a9ab8] hover:text-white transition-colors">
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-[#7c5af0] hover:bg-[#6d4de0] transition-colors"
                  style={JK}
                >
                  Get started free
                </Link>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="md:hidden p-2 text-[#8a9ab8] hover:text-white transition-colors"
          >
            {menuOpen ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-b border-[rgba(255,255,255,0.07)] bg-[#080d1a] px-6 pb-4 space-y-1">
            {nav.map(l => (
              <button
                key={l.id}
                onClick={() => scrollTo(l.id)}
                className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] text-[#8a9ab8] hover:text-white transition-colors"
              >
                {l.label}
              </button>
            ))}
            {user ? (
              <button
                onClick={goToApp}
                className="w-full mt-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-[#7c5af0]"
                style={JK}
              >
                Go to app
              </button>
            ) : (
              <>
                <Link to="/login" className="block w-full text-left px-3 py-2.5 rounded-lg text-[13px] text-[#8a9ab8] hover:text-white transition-colors">
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="block w-full text-center mt-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-[#7c5af0]"
                  style={JK}
                >
                  Get started free
                </Link>
              </>
            )}
          </div>
        )}
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section id="home" className="pt-36 pb-28 px-6">
        <div className="max-w-[1160px] mx-auto">
          {/* Text block */}
          <div className="flex flex-col items-center text-center max-w-[760px] mx-auto mb-20">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#7c5af0]/30 bg-[#7c5af0]/10 mb-7">
              <Zap size={11} className="text-[#a78bfa]" />
              <span className="text-[10px] font-mono text-[#a78bfa] tracking-[0.14em] uppercase">
                AI-powered study platform
              </span>
            </div>

            <h1
              className="text-[52px] md:text-[66px] font-bold leading-[1.08] tracking-tight text-white mb-6"
              style={JK}
            >
              Study{" "}
              <span
                style={{
                  background: "linear-gradient(130deg, #7c5af0 0%, #38bdf8 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                smarter
              </span>
              ,<br />not harder.
            </h1>

            <p className="text-[17px] text-[#8a9ab8] leading-relaxed mb-9 max-w-[520px]">
              Upload your lecture notes, textbooks, or papers. Synapse turns them into
              flashcards, quizzes, summaries, and a searchable knowledge base — instantly.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={goToApp}
                className="px-6 py-3 rounded-xl text-[14px] font-semibold text-white bg-[#7c5af0] hover:bg-[#6d4de0] transition-colors flex items-center gap-2"
                style={JK}
              >
                Start for free <ArrowRight size={14} strokeWidth={2} />
              </button>
              <button
                onClick={() => scrollTo("how-it-works")}
                className="px-6 py-3 rounded-xl text-[14px] font-medium text-[#8a9ab8] hover:text-white border border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] transition-colors"
                style={JK}
              >
                See how it works
              </button>
            </div>

            <div className="flex items-center gap-8 mt-10">
              {[["2.4M", "notes processed"], ["140K", "active students"], ["98%", "retention lift"]].map(([v, l]) => (
                <div key={l} className="text-center">
                  <p className="text-[18px] font-bold text-white tabular-nums" style={JK}>{v}</p>
                  <p className="text-[11px] font-mono text-[#6b7a99] mt-0.5">{l}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Product mockup */}
          <div className="relative max-w-[880px] mx-auto">
            {/* Background glow */}
            <div
              className="absolute inset-x-16 -top-8 h-64 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at 50% 0%, rgba(124,90,240,0.28) 0%, transparent 70%)",
                filter: "blur(32px)",
              }}
            />

            {/* Browser shell */}
            <div
              className="relative rounded-2xl border border-[rgba(255,255,255,0.1)] overflow-hidden"
              style={{ background: "#0a1020" }}
            >
              {/* Title bar */}
              <div
                className="flex items-center gap-3 px-5 py-3.5 border-b border-[rgba(255,255,255,0.07)]"
                style={{ background: "#060c18" }}
              >
                <div className="flex gap-1.5">
                  {["#ff5f57", "#febc2e", "#28c840"].map(col => (
                    <div key={col} className="w-2.5 h-2.5 rounded-full" style={{ background: col }} />
                  ))}
                </div>
                <div
                  className="flex-1 mx-3 h-6 rounded-md flex items-center px-3"
                  style={{ background: "#0e1628" }}
                >
                  <span className="text-[10px] font-mono text-[#3d4f6b]">app.synapse.ai/chat</span>
                </div>
              </div>

              {/* UI preview */}
              <div className="flex" style={{ minHeight: 340 }}>
                {/* Mini sidebar */}
                <div
                  className="w-44 border-r border-[rgba(255,255,255,0.06)] p-3 hidden sm:flex flex-col gap-1"
                  style={{ background: "#060c18" }}
                >
                  <div className="flex items-center gap-2 px-2 py-2 mb-1">
                    <div className="w-5 h-5 rounded-md bg-[#7c5af0] flex items-center justify-center">
                      <Brain size={10} strokeWidth={2} className="text-white" />
                    </div>
                    <span className="text-[11px] font-semibold text-white" style={JK}>Synapse</span>
                  </div>
                  {[
                    ["Neuroscience Ch.12", "#7c5af0", 73],
                    ["Microeconomics Sets", "#38bdf8", 41],
                    ["Cold War to Détente", "#f59e0b", 88],
                    ["Statistical Methods", "#34d399", 96],
                  ].map(([name, color, pct]) => (
                    <div
                      key={name as string}
                      className="flex items-center gap-2 px-2 py-2.5 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                    >
                      <div
                        className="w-0.5 self-stretch rounded-full flex-shrink-0"
                        style={{ background: color as string, opacity: 0.6 }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] text-[#6b7a99] truncate">{name as string}</p>
                        <div className="w-full h-0.5 bg-[#1a2540] rounded-full mt-1 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color as string }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Chat preview */}
                <div className="flex-1 flex flex-col p-5 gap-4">
                  {/* AI message */}
                  <div className="flex gap-2.5">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: "#7c5af0" }}
                    >
                      <Brain size={12} strokeWidth={2} className="text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#071a0d] border border-[#16a34a]/25 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" style={{ boxShadow: "0 0 4px #22c55e" }} />
                        <span className="text-[8px] font-mono font-semibold tracking-[0.15em] text-[#4ade80] uppercase">Synapse</span>
                      </div>
                      <div
                        className="rounded-2xl rounded-tl-sm px-4 py-3 text-[12px] text-[#c8d4e8] leading-relaxed max-w-[440px] border border-[rgba(255,255,255,0.07)]"
                        style={{ background: "#0e1628" }}
                      >
                        <strong>Long-Term Potentiation (LTP)</strong> is a persistent strengthening of synaptic
                        transmission triggered by high-frequency stimulation — mediated by NMDA receptor
                        activation and subsequent AMPA receptor insertion. It's the primary cellular model of learning and memory.
                      </div>
                    </div>
                  </div>

                  {/* User message */}
                  <div className="flex justify-end">
                    <div
                      className="rounded-2xl rounded-tr-sm px-4 py-3 text-[12px] text-[#c8d4e8] max-w-[300px] border border-[#7c5af0]/20"
                      style={{ background: "#1a1240" }}
                    >
                      Can you make flashcards from this chapter?
                    </div>
                  </div>

                  {/* Input */}
                  <div className="mt-auto flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border border-[rgba(255,255,255,0.08)]" style={{ background: "#111827" }}>
                    <span className="text-[11px] text-[#3d4f6b] flex-1 font-mono">What's still unclear from Chapter 12?</span>
                    <div className="w-6 h-6 rounded-full bg-[#7c5af0] flex items-center justify-center">
                      <ArrowUp size={11} strokeWidth={2.5} className="text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-28 px-6" style={{ background: "#060c18" }}>
        <div className="max-w-[1160px] mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-mono text-[#7c5af0] uppercase tracking-[0.16em] mb-3">
              Everything you need
            </p>
            <h2 className="text-[40px] md:text-[48px] font-bold text-white tracking-tight" style={JK}>
              Six ways to learn faster
            </h2>
            <p className="text-[16px] text-[#8a9ab8] mt-4 max-w-[460px] mx-auto leading-relaxed">
              One upload. Six tools that work together so you spend less time re-reading and more time actually retaining.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="group p-6 rounded-2xl border border-[rgba(255,255,255,0.07)] hover:border-[rgba(255,255,255,0.13)] transition-all"
                style={{ background: i === 0 ? "#0e1628" : "#0a1020" }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-5"
                  style={{ background: `${f.color}18`, border: `1px solid ${f.color}28` }}
                >
                  <f.icon size={18} strokeWidth={1.5} style={{ color: f.color }} />
                </div>
                <h3 className="text-[16px] font-semibold text-white mb-2" style={JK}>{f.title}</h3>
                <p className="text-[13px] text-[#8a9ab8] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-28 px-6">
        <div className="max-w-[1160px] mx-auto">
          <div className="text-center mb-20">
            <p className="text-[10px] font-mono text-[#7c5af0] uppercase tracking-[0.16em] mb-3">
              Simple by design
            </p>
            <h2 className="text-[40px] md:text-[48px] font-bold text-white tracking-tight" style={JK}>
              Up and studying in 60 seconds
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
            {steps.map((s, i) => (
              <div key={s.n} className="relative flex flex-col gap-5">
                {i < steps.length - 1 && (
                  <div
                    className="hidden md:block absolute top-5 left-[calc(100%+8px)] right-0 h-px"
                    style={{ width: "calc(100% - 16px)", background: "rgba(124,90,240,0.25)", left: "calc(100% + 16px)" }}
                  />
                )}
                <div className="flex items-center gap-4">
                  <span
                    className="text-[32px] font-bold tabular-nums leading-none"
                    style={{ color: "#7c5af0", opacity: 0.45, ...JK }}
                  >
                    {s.n}
                  </span>
                  <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                </div>
                <h3 className="text-[19px] font-semibold text-white" style={JK}>{s.title}</h3>
                <p className="text-[14px] text-[#8a9ab8] leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-28 px-6">
        <div className="max-w-[1160px] mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-mono text-[#7c5af0] uppercase tracking-[0.16em] mb-3">
              Straightforward pricing
            </p>
            <h2 className="text-[40px] md:text-[48px] font-bold text-white tracking-tight" style={JK}>
              Start free, scale when ready
            </h2>
            <p className="text-[16px] text-[#8a9ab8] mt-4">No credit card required for the free plan.</p>
          </div>

          <PricingCards onCta={cta => (cta === "Contact us" ? scrollTo("contact") : goToApp())} />
        </div>
      </section>

      {/* ── Contact ────────────────────────────────────────────────────────── */}
      <section id="contact" className="py-28 px-6" style={{ background: "#060c18" }}>
        <div className="max-w-[1160px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20">

            {/* Left — info */}
            <div>
              <p className="text-[10px] font-mono text-[#7c5af0] uppercase tracking-[0.16em] mb-3">
                Get in touch
              </p>
              <h2 className="text-[38px] font-bold text-white tracking-tight mb-5" style={JK}>
                We'd love to hear from you
              </h2>
              <p className="text-[15px] text-[#8a9ab8] leading-relaxed mb-10">
                Whether you have a question about features, pricing, need a demo for your institution,
                or just want to say hello — our team is ready to help.
              </p>

              <div className="space-y-5">
                {[
                  { icon: Mail,    label: "Email us",  value: "supportsynapse@gmail.com"     },
                  { icon: MapPin,  label: "Location",  value: "India"    },
                ].map(c => (
                  <div key={c.label} className="flex items-center gap-4">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(124,90,240,0.1)", border: "1px solid rgba(124,90,240,0.22)" }}
                    >
                      <c.icon size={17} strokeWidth={1.5} className="text-[#a78bfa]" />
                    </div>
                    <div>
                      <p className="text-[10px] font-mono text-[#6b7a99] uppercase tracking-wider mb-0.5">
                        {c.label}
                      </p>
                      <p className="text-[14px] text-[#c8d4e8]">{c.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — form */}
            <ContactCard />
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[rgba(255,255,255,0.07)] py-16 px-6" style={{ background: "#050a14" }}>
        <div className="max-w-[1160px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-14">
            {/* Brand */}
            <div className="col-span-2">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-8 h-8 rounded-lg bg-[#7c5af0] flex items-center justify-center">
                  <Brain size={15} strokeWidth={2} className="text-white" />
                </div>
                <span className="text-[15px] font-bold text-white" style={JK}>Synapse</span>
              </div>
              <p className="text-[13px] text-[#6b7a99] leading-relaxed max-w-[240px] mb-6">
                AI-powered study platform that turns your documents into a personal knowledge base.
              </p>
              <div className="flex items-center gap-2">
                {[Twitter, Github, Linkedin].map((Icon, i) => (
                  <button
                    key={i}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[rgba(255,255,255,0.08)]"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                  >
                    <Icon size={14} strokeWidth={1.5} className="text-[#6b7a99]" />
                  </button>
                ))}
              </div>
            </div>

            {/* Link columns */}
            {[
              { heading: "Product",  links: ["Features", "Pricing", "Changelog", "Roadmap"] },
              { heading: "Company",  links: ["About", "Blog", "Careers", "Press"]           },
              { heading: "Support",  links: ["Docs", "Help center", "Privacy", "Terms"]     },
            ].map(col => (
              <div key={col.heading}>
                <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[#6b7a99] mb-4">
                  {col.heading}
                </p>
                <ul className="space-y-2.5">
                  {col.links.map(l => (
                    <li key={l}>
                      <button className="text-[13px] text-[#8a9ab8] hover:text-white transition-colors">
                        {l}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div
            className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8 border-t border-[rgba(255,255,255,0.07)]"
          >
            <p className="text-[12px] font-mono text-[#3d4f6b]">
              © 2026 Synapse AI, Inc. All rights reserved.
            </p>
            <p className="text-[12px] font-mono text-[#3d4f6b]">Made for students, by students.</p>
          </div>
        </div>
      </footer>

      <FloatingQRWidget />
    </div>
  );
}
