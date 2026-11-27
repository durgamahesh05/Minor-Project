from typing import Literal
from pydantic import Field
from .common import MongoModel


class Document(MongoModel):
    user_id: object = Field(alias="userId")
    original_name: str = Field(alias="originalName")
    mime_type: str = Field(alias="mimeType")
    size: int
    status: Literal["uploading", "processing", "ready", "indexed", "failed"] = "ready"
    storage_provider: Literal["local", "supabase", "browser-opfs"] = Field(default="local", alias="storageProvider")
    stored_filename: str | None = Field(default=None, alias="storedFilename")
    storage_path: str | None = Field(default=None, alias="storagePath")
    supabase_metadata_id: str | None = Field(default=None, alias="supabaseMetadataId")
    client_document_id: str | None = Field(default=None, alias="clientDocumentId")
