import express from "express";
import cors from "cors";
import session from "express-session";
import MongoStore from "connect-mongo";
import authRoutes from "./routes/auth.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import documentsRoutes from "./routes/documents.routes.js";
import quizRoutes from "./routes/quiz.routes.js";
import flashcardRoutes from "./routes/flashcard.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import accountRoutes from "./routes/account.routes.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
  app.use(express.json());

  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    }),
  );

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/documents", documentsRoutes);
  app.use("/api/quizzes", quizRoutes);
  app.use("/api/flashcards", flashcardRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/account", accountRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || "Internal server error" });
  });

  return app;
}
