import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, default: "New chat", trim: true },
  },
  { timestamps: true },
);

export default mongoose.model("Conversation", conversationSchema);
