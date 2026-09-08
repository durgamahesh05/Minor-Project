import { Router } from "express";
import path from "path";
import Document from "../models/Document.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { upload } from "../middleware/upload.js";
import { createDocumentMetadata, deleteDocumentFile, deleteDocumentMetadata, getDocumentDownloadUrl, saveDocument } from "../lib/documentStorage.js";

const router = Router();
router.use(requireAuth);

function toPublicDocument(doc) {
  return {
    id: doc._id.toString(),
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    status: doc.status,
    createdAt: doc.createdAt,
  };
}

router.get("/", async (req, res, next) => {
  try {
    const documents = await Document.find({ userId: req.session.userId }).sort({ createdAt: -1 });
    res.json({ documents: documents.map(toPublicDocument) });
  } catch (err) {
    next(err);
  }
});

router.post("/", (req, res, next) => {
  upload.single("file")(req, res, async err => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "File too large (20 MB maximum)" : err.message;
      return res.status(400).json({ message });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const storage = await saveDocument(req.file, req.session.userId);
      let metadataId;
      try {
        metadataId = await createDocumentMetadata({ userId: req.session.userId, file: req.file, storage });
        const document = await Document.create({
          userId: req.session.userId,
          originalName: req.file.originalname,
          ...storage,
          supabaseMetadataId: metadataId,
          mimeType: req.file.mimetype || "application/octet-stream",
          size: req.file.size,
          status: "ready",
        });
        return res.status(201).json({ document: toPublicDocument(document) });
      } catch (error) {
        await deleteDocumentFile(storage).catch(() => {});
        if (metadataId) await deleteDocumentMetadata(metadataId).catch(() => {});
        throw error;
      }
    } catch (storageErr) {
      next(storageErr);
    }
  });
});

router.get("/:id/download", async (req, res, next) => {
  try {
    const document = await Document.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }
    const signedUrl = await getDocumentDownloadUrl(document);
    if (signedUrl) return res.redirect(signedUrl);
    res.download(path.resolve("uploads", document.storedFilename), document.originalName);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const document = await Document.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }
    await deleteDocumentFile(document);
    await deleteDocumentMetadata(document.supabaseMetadataId);
    await document.deleteOne();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
