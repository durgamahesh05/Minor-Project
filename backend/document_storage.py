"""Private Supabase Storage and document-metadata operations."""
import json
import os
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


def _settings() -> tuple[str, str, str]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "documents")
    if not url or not key:
        raise RuntimeError("Supabase Storage is not configured")
    return url, key, bucket


def _request(method: str, url: str, body: bytes | None = None, content_type: str = "application/json", prefer: str | None = None):
    _, key, _ = _settings()
    request = Request(url, data=body, method=method, headers={
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": content_type,
    })
    if prefer:
        request.add_header("Prefer", prefer)
    try:
        with urlopen(request, timeout=30) as response:
            data = response.read()
            return json.loads(data) if data else None
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase request failed ({error.code}): {detail}") from error


def upload_file(storage_path: str, content: bytes, content_type: str) -> None:
    url, _, bucket = _settings()
    path = quote(storage_path, safe="/")
    _request("POST", f"{url}/storage/v1/object/{quote(bucket)}/{path}", content, content_type)


def create_metadata(values: dict) -> str:
    url, _, _ = _settings()
    body = json.dumps(values).encode()
    _, key, _ = _settings()
    request = Request(f"{url}/rest/v1/documents", data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json", "Prefer": "return=representation",
    })
    try:
        with urlopen(request, timeout=30) as response:
            rows = json.loads(response.read())
            return rows[0]["id"]
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase metadata failed ({error.code}): {detail}") from error


def update_metadata(metadata_id: str, status: str) -> None:
    url, _, _ = _settings()
    _request("PATCH", f"{url}/rest/v1/documents?id=eq.{quote(metadata_id)}", json.dumps({"status": status}).encode())


def delete_document(storage_path: str | None, metadata_id: str | None) -> None:
    url, _, bucket = _settings()
    if storage_path:
        _request("DELETE", f"{url}/storage/v1/object/{quote(bucket)}", json.dumps({"prefixes": [storage_path]}).encode())
    if metadata_id:
        _request("DELETE", f"{url}/rest/v1/documents?id=eq.{quote(metadata_id)}")


def signed_download_url(storage_path: str, download_name: str) -> str:
    url, _, bucket = _settings()
    path = quote(storage_path, safe="/")
    data = _request("POST", f"{url}/storage/v1/object/sign/{quote(bucket)}/{path}", json.dumps({"expiresIn": 60, "download": download_name}).encode())
    if not isinstance(data, dict):
        raise RuntimeError("Supabase returned an empty or invalid signed URL response")
    signed = data.get("signedURL") or data.get("signedUrl")
    if not isinstance(signed, str) or not signed:
        raise RuntimeError("Supabase did not return a signed URL")
    return signed if signed.startswith("http") else f"{url}/storage/v1{signed}"


def sync_upload_metadata(document: dict) -> None:
    """Mirror IDs and filename only; keep file bytes in browser storage."""
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        return
    url, _, _ = _settings()
    values = {"document_id": str(document["_id"]), "user_id": str(document["userId"]),
              "file_name": document["originalName"]}
    _request("POST", f"{url}/rest/v1/uploaded_documents?on_conflict=document_id",
             json.dumps(values).encode(), prefer="resolution=merge-duplicates")


def delete_upload_metadata(document_id) -> None:
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        return
    url, _, _ = _settings()
    _request("DELETE", f"{url}/rest/v1/uploaded_documents?document_id=eq.{quote(str(document_id))}")
