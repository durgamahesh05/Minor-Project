import { Router } from "express";
import FlashcardSet from "../models/FlashcardSet.js";
import Document from "../models/Document.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

function toPublicSet(set) {
  return {
    id: set._id.toString(),
    title: set.title,
    documentId: set.documentId?.toString() ?? null,
    cards: set.cards,
    createdAt: set.createdAt,
  };
}

function toPublicSetSummary(set) {
  const { cards: _cards, ...rest } = toPublicSet(set);
  return rest;
}

// Placeholder for real generation from a document via the RAG service.
// Swap this out once ai-service can produce real flashcards from content.
function generateStubFlashcards(sourceTitle) {
  return [
    { front: `What is "${sourceTitle}" about?`, back: "Connect the RAG service to generate real answers." },
    { front: "Is this flashcard set AI-generated yet?", back: "Not yet — this is placeholder content." },
  ];
}

router.get("/", async (req, res, next) => {
  try {
    const sets = await FlashcardSet.find({ userId: req.session.userId }).sort({ createdAt: -1 });
    res.json({ sets: sets.map(toPublicSetSummary) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const set = await FlashcardSet.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!set) {
      return res.status(404).json({ message: "Flashcard set not found" });
    }
    res.json({ set: toPublicSet(set) });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { documentId } = req.body;
    let sourceTitle = "your notes";

    if (documentId) {
      const document = await Document.findOne({ _id: documentId, userId: req.session.userId });
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      sourceTitle = document.originalName;
    }

    const set = await FlashcardSet.create({
      userId: req.session.userId,
      documentId: documentId || null,
      title: `Flashcards: ${sourceTitle}`,
      cards: generateStubFlashcards(sourceTitle),
    });
    res.status(201).json({ set: toPublicSet(set) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const set = await FlashcardSet.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
    if (!set) {
      return res.status(404).json({ message: "Flashcard set not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
