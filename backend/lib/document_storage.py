import secrets
from pathlib import Path

from document_storage import (
    create_metadata,
    delete_document,
    delete_upload_metadata,
    signed_download_url,
    sync_upload_metadata,
    upload_file,
)

UPLOADS = Path(__file__).resolve().parents[1] / "uploads"


def save_document(file, user_id):
    filename = getattr(file, "filename", None) or "upload"
    extension = Path(filename).suffix
    stored_filename = f"{secrets.token_hex(16)}{extension}"
    storage_path = f"{user_id}/{stored_filename}"
    content = file.file.read()
    upload_file(storage_path, content, getattr(file, "content_type", None) or "application/octet-stream")
    return {
        "storageProvider": "supabase",
        "storagePath": storage_path,
        "storedFilename": stored_filename,
    }


def create_document_metadata(user_id, file, storage):
    filename = getattr(file, "filename", None) or "upload"
    extension = Path(filename).suffix.removeprefix(".").lower()
    return create_metadata({
        "user_id": str(user_id),
        "file_name": filename,
        "file_path": storage["storagePath"],
        "file_type": extension or getattr(file, "content_type", None) or "unknown",
        "file_size": getattr(file, "size", 0),
        "status": "ready",
    })


def delete_document_metadata(metadata_id):
    if metadata_id:
        delete_document(None, metadata_id)


def delete_document_file(document):
    provider = value(document, "storageProvider") or "local"
    storage_path = value(document, "storagePath")
    if provider == "supabase" and storage_path:
        delete_document(storage_path, None)
        return
    filename = value(document, "storedFilename")
    if provider == "local" and filename:
        target = (UPLOADS / filename).resolve()
        if target.parent == UPLOADS.resolve():
            target.unlink(missing_ok=True)


def get_document_download_url(document):
    storage_path = value(document, "storagePath")
    if value(document, "storageProvider") == "supabase" and storage_path:
        return signed_download_url(storage_path, value(document, "originalName") or "download")
    return None


def value(document, key):
    if isinstance(document, dict):
        return document.get(key)
    model_dump = getattr(document, "model_dump", None)
    if callable(model_dump):
        return model_dump(by_alias=True).get(key)
    return getattr(document, key, None)


__all__ = [
    "create_document_metadata",
    "delete_document_file",
    "delete_document_metadata",
    "delete_upload_metadata",
    "get_document_download_url",
    "save_document",
    "signed_download_url",
    "sync_upload_metadata",
]
