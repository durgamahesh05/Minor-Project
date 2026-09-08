import { Router } from "express";
import Quiz from "../models/Quiz.js";
import Document from "../models/Document.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

function toPublicQuiz(quiz) {
  return {
    id: quiz._id.toString(),
    title: quiz.title,
    documentId: quiz.documentId?.toString() ?? null,
    questions: quiz.questions,
    createdAt: quiz.createdAt,
  };
}

function toPublicQuizSummary(quiz) {
  const { questions: _questions, ...rest } = toPublicQuiz(quiz);
  return rest;
}

// Placeholder for real generation from a document via the RAG service.
// Swap this out once ai-service can produce real questions from content.
function generateStubQuiz(sourceTitle) {
  return [
    {
      question: `What is the main topic of "${sourceTitle}"?`,
      options: ["Not yet known — connect the RAG service", "Option B", "Option C", "Option D"],
      correctIndex: 0,
    },
    {
      question: "Quiz generation from document content isn't wired up yet. What should happen next?",
      options: [
        "Nothing",
        "Connect ai-service's /api/rag/query to generate real questions",
        "Delete this quiz",
        "Ignore it",
      ],
      correctIndex: 1,
    },
  ];
}

router.get("/", async (req, res, next) => {
  try {
    const quizzes = await Quiz.find({ userId: req.session.userId }).sort({ createdAt: -1 });
    res.json({ quizzes: quizzes.map(toPublicQuizSummary) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }
    res.json({ quiz: toPublicQuiz(quiz) });
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

    const quiz = await Quiz.create({
      userId: req.session.userId,
      documentId: documentId || null,
      title: `Quiz: ${sourceTitle}`,
      questions: generateStubQuiz(sourceTitle),
    });
    res.status(201).json({ quiz: toPublicQuiz(quiz) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const quiz = await Quiz.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
