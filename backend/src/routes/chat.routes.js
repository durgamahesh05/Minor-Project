import { Router } from "express";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

function toPublicConversation(conv) {
  return { id: conv._id.toString(), title: conv.title, updatedAt: conv.updatedAt };
}

function toPublicMessage(msg) {
  return { id: msg._id.toString(), role: msg.role, text: msg.text, createdAt: msg.createdAt };
}

// Placeholder for the real AI/RAG call (ai-service, Gemini, etc). Swap this
// one function out once that's wired up — everything else stays the same.
const fallbackReplies = {
  en: "I'm Synapse. I can help you understand your documents, generate flashcards, quiz you, and create summaries — full AI answers are coming soon once the RAG service is connected.",
  hi: "मैं Synapse हूँ। मैं आपके दस्तावेज़ समझने, फ्लैशकार्ड और क्विज़ बनाने में मदद कर सकता हूँ। RAG सेवा जुड़ने पर विस्तृत AI उत्तर उपलब्ध होंगे।",
  te: "నేను Synapseను. మీ పత్రాలను అర్థం చేసుకోవడం, ఫ్లాష్‌కార్డ్‌లు మరియు క్విజ్‌లు రూపొందించడంలో సహాయం చేస్తాను. RAG సేవ కనెక్ట్ అయిన తర్వాత పూర్తి AI సమాధానాలు అందుబాటులో ఉంటాయి.",
  es: "Soy Synapse. Puedo ayudarte a entender tus documentos, crear tarjetas y cuestionarios. Las respuestas completas de IA estarán disponibles cuando se conecte el servicio RAG.",
  fr: "Je suis Synapse. Je peux vous aider à comprendre vos documents et à créer des fiches et des quiz. Les réponses IA complètes seront disponibles une fois le service RAG connecté.",
};

function fallbackReply(language) { return fallbackReplies[language] ?? fallbackReplies.en; }

async function generateAssistantReply(userText, conversationId, language) {
  const serviceUrl = process.env.AI_SERVICE_URL;
  if (!serviceUrl) return fallbackReply(language);
  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/api/rag/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: userText, conversation_id: conversationId.toString(), language }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`AI service returned ${response.status}`);
    const payload = await response.json();
    return typeof payload.answer === "string" && payload.answer.trim() ? payload.answer : fallbackReply(language);
  } catch (err) {
    console.warn(`AI service unavailable; using fallback reply: ${err.message}`);
    return fallbackReply(language);
  }
}

router.get("/conversations", async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ userId: req.session.userId }).sort({ updatedAt: -1 });
    res.json({ conversations: conversations.map(toPublicConversation) });
  } catch (err) {
    next(err);
  }
});

router.post("/conversations", async (req, res, next) => {
  try {
    const title = (req.body?.title || "New chat").slice(0, 80);
    const conversation = await Conversation.create({ userId: req.session.userId, title });
    res.status(201).json({ conversation: toPublicConversation(conversation) });
  } catch (err) {
    next(err);
  }
});

router.patch("/conversations/:id", async (req, res, next) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title || title.length > 80) {
      return res.status(400).json({ message: "Chat title must contain 1 to 80 characters" });
    }
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.session.userId },
      { $set: { title } },
      { new: true, timestamps: false },
    );
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    res.json({ conversation: toPublicConversation(conversation) });
  } catch (err) {
    next(err);
  }
});

router.delete("/conversations/:id", async (req, res, next) => {
  try {
    const conversation = await Conversation.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    await Message.deleteMany({ conversationId: conversation._id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/conversations/:id/messages", async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    const messages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 });
    res.json({ messages: messages.map(toPublicMessage) });
  } catch (err) {
    next(err);
  }
});

router.post("/conversations/:id/messages", async (req, res, next) => {
  try {
    const { text, language = "auto" } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: "Message text is required" });
    }

    const conversation = await Conversation.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const userMessage = await Message.create({ conversationId: conversation._id, role: "user", text: text.trim() });
    const replyText = await generateAssistantReply(text.trim(), conversation._id, language);
    const assistantMessage = await Message.create({ conversationId: conversation._id, role: "assistant", text: replyText });

    conversation.updatedAt = new Date();
    await conversation.save();

    res.status(201).json({ userMessage: toPublicMessage(userMessage), assistantMessage: toPublicMessage(assistantMessage) });
  } catch (err) {
    next(err);
  }
});

export default router;
