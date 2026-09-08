import { Router } from "express";
import User from "../models/User.js";
import Document from "../models/Document.js";
import Quiz from "../models/Quiz.js";
import FlashcardSet from "../models/FlashcardSet.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { deleteDocumentFile, deleteDocumentMetadata } from "../lib/documentStorage.js";

const router = Router();
router.use(requireAuth, requireAdmin);

function toPublicUser(user) {
  return { id: user._id.toString(), name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}

router.get("/stats", async (_req, res, next) => {
  try {
    const [totalUsers, totalDocuments, totalQuizzes, totalFlashcardSets, totalConversations] = await Promise.all([
      User.countDocuments(),
      Document.countDocuments(),
      Quiz.countDocuments(),
      FlashcardSet.countDocuments(),
      Conversation.countDocuments(),
    ]);
    res.json({ totalUsers, totalDocuments, totalQuizzes, totalFlashcardSets, totalConversations });
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (_req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ users: users.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:id", async (req, res, next) => {
  try {
    if (req.params.id === req.session.userId) {
      return res.status(400).json({ message: "You can't delete your own account while logged in" });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const conversations = await Conversation.find({ userId: user._id });
    await Message.deleteMany({ conversationId: { $in: conversations.map(c => c._id) } });
    await Conversation.deleteMany({ userId: user._id });

    const documents = await Document.find({ userId: user._id });
    await Promise.all(documents.map(async document => {
      await deleteDocumentFile(document);
      await deleteDocumentMetadata(document.supabaseMetadataId);
    }));
    await Document.deleteMany({ userId: user._id });

    await Quiz.deleteMany({ userId: user._id });
    await FlashcardSet.deleteMany({ userId: user._id });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/documents", async (_req, res, next) => {
  try {
    const documents = await Document.find().sort({ createdAt: -1 }).populate("userId", "name email");
    res.json({
      documents: documents.map(doc => ({
        id: doc._id.toString(),
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
        createdAt: doc.createdAt,
        owner: doc.userId ? { id: doc.userId._id.toString(), name: doc.userId.name, email: doc.userId.email } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/documents/:id", async (req, res, next) => {
  try {
    const document = await Document.findByIdAndDelete(req.params.id);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }
    await deleteDocumentFile(document);
    await deleteDocumentMetadata(document.supabaseMetadataId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/quizzes", async (_req, res, next) => {
  try {
    const quizzes = await Quiz.find().sort({ createdAt: -1 }).populate("userId", "name email");
    res.json({
      quizzes: quizzes.map(quiz => ({
        id: quiz._id.toString(),
        title: quiz.title,
        questionCount: quiz.questions.length,
        createdAt: quiz.createdAt,
        owner: quiz.userId ? { id: quiz.userId._id.toString(), name: quiz.userId.name, email: quiz.userId.email } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/quizzes/:id", async (req, res, next) => {
  try {
    const quiz = await Quiz.findByIdAndDelete(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/flashcards", async (_req, res, next) => {
  try {
    const sets = await FlashcardSet.find().sort({ createdAt: -1 }).populate("userId", "name email");
    res.json({
      sets: sets.map(set => ({
        id: set._id.toString(),
        title: set.title,
        cardCount: set.cards.length,
        createdAt: set.createdAt,
        owner: set.userId ? { id: set.userId._id.toString(), name: set.userId.name, email: set.userId.email } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/flashcards/:id", async (req, res, next) => {
  try {
    const set = await FlashcardSet.findByIdAndDelete(req.params.id);
    if (!set) {
      return res.status(404).json({ message: "Flashcard set not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
