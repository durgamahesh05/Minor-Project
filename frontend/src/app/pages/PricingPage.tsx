import { Link, useNavigate } from "react-router";
import { Brain } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import PricingCards from "../components/PricingCards";

const JK = { fontFamily: "'Plus Jakarta Sans', sans-serif" };

export default function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleCta = (cta: string) => {
    if (cta === "Contact us") {
      navigate("/#contact");
      return;
    }
    navigate(user ? "/chat" : "/register");
  };

  return (
    <div className="min-h-screen bg-[#080d1a] text-[#e2e6f0]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <header className="px-6 h-16 flex items-center justify-between max-w-[1160px] mx-auto">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#7c5af0] flex items-center justify-center">
            <Brain size={16} strokeWidth={2} className="text-white" />
          </div>
          <span className="text-[15px] font-bold text-white" style={JK}>Synapse</span>
        </Link>

        {user ? (
          <button
            onClick={() => navigate("/chat")}
            className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-[#7c5af0] hover:bg-[#6d4de0] transition-colors"
            style={JK}
          >
            Go to app
          </button>
        ) : (
          <div className="flex items-center gap-3">
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
          </div>
        )}
      </header>

      <section className="pt-16 pb-28 px-6">
        <div className="max-w-[1160px] mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-mono text-[#7c5af0] uppercase tracking-[0.16em] mb-3">
              Straightforward pricing
            </p>
            <h1 className="text-[40px] md:text-[48px] font-bold text-white tracking-tight" style={JK}>
              Start free, scale when ready
            </h1>
            <p className="text-[16px] text-[#8a9ab8] mt-4">No credit card required for the free plan.</p>
          </div>

          <PricingCards onCta={handleCta} />
        </div>
      </section>
    </div>
  );
}
