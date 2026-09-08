import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import AccountDeletion from "../models/AccountDeletion.js";
import PendingRegistration from "../models/PendingRegistration.js";
import { isValidPassword, PASSWORD_REQUIREMENTS_MESSAGE } from "../lib/validatePassword.js";
import { generateOtp } from "../lib/otp.js";

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const REGISTRATION_OTP_TTL_MS = 10 * 60 * 1000;

const router = Router();

function toPublicUser(user) {
  return { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
}

// Signup is two steps: register() stashes the (hashed) signup details and
// emails an OTP, and no account exists yet. verify-registration() checks the
// OTP and only then actually creates the User. No email service is
// configured yet, so — same as the other OTP/token flows — the code is
// returned directly in the response instead of being emailed.
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ message: PASSWORD_REQUIREMENTS_MESSAGE });
    }

    const normalizedEmail = email.toLowerCase();

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    const recentlyDeleted = await AccountDeletion.findOne({ email: normalizedEmail });
    if (recentlyDeleted) {
      const availableAt = new Date(recentlyDeleted.deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const formatted = availableAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      return res.status(403).json({
        message: `This email was recently deleted and can't be reused until ${formatted}.`,
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const otpExpiresAt = new Date(Date.now() + REGISTRATION_OTP_TTL_MS);

    await PendingRegistration.findOneAndUpdate(
      { email: normalizedEmail },
      { name, email: normalizedEmail, passwordHash, otpHash, otpExpiresAt },
      { upsert: true, setDefaultsOnInsert: true },
    );

    res.json({ message: "Verification code generated.", email: normalizedEmail, otp });
  } catch (err) {
    next(err);
  }
});

router.post("/verify-registration", async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and verification code are required" });
    }

    const normalizedEmail = email.toLowerCase();
    const pending = await PendingRegistration.findOne({ email: normalizedEmail });
    if (!pending || pending.otpExpiresAt < new Date()) {
      return res.status(400).json({ message: "That code is invalid or has expired. Please sign up again." });
    }

    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (pending.otpHash !== otpHash) {
      return res.status(400).json({ message: "That code is invalid or has expired." });
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    const user = await User.create({ name: pending.name, email: pending.email, passwordHash: pending.passwordHash });
    await PendingRegistration.deleteOne({ _id: pending._id });

    req.session.userId = user._id.toString();
    req.session.role = user.role;
    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/resend-registration-otp", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase();
    const pending = await PendingRegistration.findOne({ email: normalizedEmail });
    if (!pending) {
      return res.status(400).json({ message: "No pending signup found for this email. Please sign up again." });
    }

    const otp = generateOtp();
    pending.otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    pending.otpExpiresAt = new Date(Date.now() + REGISTRATION_OTP_TTL_MS);
    await pending.save();

    res.json({ message: "Verification code generated.", otp });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    req.session.userId = user._id.toString();
    req.session.role = user.role;
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("connect.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.status(204).end();
  });
});

router.get("/me", async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

// No email service is configured yet, so the reset link is returned directly
// in the response instead of being emailed. Swap this for a real mailer
// (e.g. Nodemailer/SendGrid) before this ever goes to production.
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.json({ message: "If that account exists, a reset link has been generated." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.resetTokenHash = crypto.createHash("sha256").update(token).digest("hex");
    user.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
    res.json({ message: "Reset link generated.", resetUrl });
  } catch (err) {
    next(err);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: "Token and new password are required" });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ message: PASSWORD_REQUIREMENTS_MESSAGE });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: { $gt: new Date() },
    }).select("+resetTokenHash +resetTokenExpiresAt");

    if (!user) {
      return res.status(400).json({ message: "This reset link is invalid or has expired" });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    await user.save();

    res.json({ message: "Password updated. You can now log in." });
  } catch (err) {
    next(err);
  }
});

export default router;
