import { Router } from "express";
import crypto from "crypto";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import Document from "../models/Document.js";
import Quiz from "../models/Quiz.js";
import FlashcardSet from "../models/FlashcardSet.js";
import AccountDeletion from "../models/AccountDeletion.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { deleteDocumentFile, deleteDocumentMetadata } from "../lib/documentStorage.js";
import { generateOtp } from "../lib/otp.js";

const OTP_TTL_MS = 10 * 60 * 1000;

const router = Router();
router.use(requireAuth);

// No email service is configured yet, so the OTP is returned directly in the
// response instead of being emailed. Swap this for a real mailer before this
// ever goes to production — never log/return OTPs once one exists.
router.post("/delete/request", async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const otp = generateOtp();
    user.deleteOtpHash = crypto.createHash("sha256").update(otp).digest("hex");
    user.deleteOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    await user.save();

    res.json({ message: "Verification code generated.", otp });
  } catch (err) {
    next(err);
  }
});

router.post("/delete/confirm", async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ message: "Verification code is required" });
    }

    const user = await User.findById(req.session.userId).select("+deleteOtpHash +deleteOtpExpiresAt");
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const valid =
      user.deleteOtpHash &&
      user.deleteOtpExpiresAt &&
      user.deleteOtpExpiresAt > new Date() &&
      user.deleteOtpHash === otpHash;

    if (!valid) {
      return res.status(400).json({ message: "That code is invalid or has expired" });
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

    await AccountDeletion.create({ email: user.email });
    await User.deleteOne({ _id: user._id });

    req.session.destroy(err => {
      if (err) return next(err);
      res.clearCookie("connect.sid");
      res.status(204).end();
    });
  } catch (err) {
    next(err);
  }
});

export default router;
