import mongoose from "mongoose";

const pendingRegistrationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    otpHash: { type: String, required: true },
    // TTL index: Mongo removes this document the moment otpExpiresAt is
    // reached, so an abandoned signup just quietly disappears.
    otpExpiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export default mongoose.model("PendingRegistration", pendingRegistrationSchema);
