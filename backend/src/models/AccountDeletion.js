import mongoose from "mongoose";

const COOLDOWN_SECONDS = 30 * 24 * 60 * 60; // 30 days

const accountDeletionSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  // TTL index: Mongo auto-removes this document 30 days after deletedAt,
  // which is also exactly how long the email stays blocked from re-registering.
  deletedAt: { type: Date, default: Date.now, expires: COOLDOWN_SECONDS },
});

export default mongoose.model("AccountDeletion", accountDeletionSchema);
