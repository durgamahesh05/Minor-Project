
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./app/i18n.ts";
  import "./styles/index.css";

  createRoot(document.getElementById("root")!).render(<App />);
  
