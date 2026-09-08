import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    options: { type: [String], required: true },
    correctIndex: { type: Number, required: true },
  },
  { _id: false },
);

const quizSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", default: null },
    title: { type: String, required: true, trim: true },
    questions: { type: [questionSchema], required: true },
  },
  { timestamps: true },
);

export default mongoose.model("Quiz", quizSchema);
