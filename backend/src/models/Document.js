import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    originalName: { type: String, required: true },
    storedFilename: { type: String, required: true },
    storageProvider: { type: String, enum: ["local", "supabase"], default: "local" },
    storagePath: { type: String, default: null },
    supabaseMetadataId: { type: String, default: null, index: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    status: { type: String, enum: ["uploading", "processing", "ready", "failed"], default: "ready" },
  },
  { timestamps: true },
);

export default mongoose.model("Document", documentSchema);
