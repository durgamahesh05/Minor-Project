import { QRCodeSVG } from "qrcode.react";
import { Brain } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const JK = { fontFamily: "'Plus Jakarta Sans', sans-serif" };

export default function FloatingQRWidget() {
  const { user } = useAuth();
  const qrValue = `${window.location.origin}${user ? "/chat" : "/register"}`;

  return (
    <div
      className="hidden md:flex fixed bottom-6 right-6 z-40 items-center gap-4 pl-5 pr-6 py-4 rounded-2xl border border-[rgba(255,255,255,0.1)] shadow-2xl"
      style={{ background: "#0a1020" }}
    >
      <div className="p-2 rounded-xl bg-white">
        <QRCodeSVG
          title="Scan to open Synapse on your phone"
          role="img"
          aria-label="Scan to open Synapse on your phone"
          value={qrValue}
          size={72}
          level="H"
          bgColor="#ffffff"
          fgColor="#080d1a"
          imageSettings={{
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Crect width='16' height='16' rx='4' fill='%237c5af0'/%3E%3C/svg%3E",
            height: 18,
            width: 18,
            excavate: true,
          }}
        />
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <div className="w-7 h-7 rounded-lg bg-[#7c5af0] flex items-center justify-center">
          <Brain size={14} strokeWidth={2} className="text-white" />
        </div>
        <span className="text-[15px] font-bold text-white leading-tight" style={JK}>
          chat with<br />Synapse
        </span>
      </div>
    </div>
  );
}
