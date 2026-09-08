import mongoose from "mongoose";

const cardSchema = new mongoose.Schema(
  {
    front: { type: String, required: true },
    back: { type: String, required: true },
  },
  { _id: false },
);

const flashcardSetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", default: null },
    title: { type: String, required: true, trim: true },
    cards: { type: [cardSchema], required: true },
  },
  { timestamps: true },
);

export default mongoose.model("FlashcardSet", flashcardSetSchema);
