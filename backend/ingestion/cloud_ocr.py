"""Optional OCR.space client used before the Groq vision fallback."""
import base64
import os

import httpx
from rag.resources import resources


class CloudOCRError(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.getenv("OCR_KEY", "").strip())


def extract_text(content: bytes, mime_type: str = "image/jpeg") -> str:
    key = os.getenv("OCR_KEY", "").strip()
    if not key:
        raise CloudOCRError("OCR_KEY is not configured")

    endpoint = os.getenv("OCR_API_URL", "https://api.ocr.space/parse/image")
    try:
        timeout = max(1, min(45, float(os.getenv("OCR_TIMEOUT_SECONDS", "12"))))
    except ValueError as error:
        raise CloudOCRError("OCR_TIMEOUT_SECONDS must be a number") from error
    encoded = base64.b64encode(content).decode("ascii")
    try:
        response = resources.http.post(
            endpoint,
            headers={"apikey": key},
            data={
                "base64Image": f"data:{mime_type};base64,{encoded}",
                "language": os.getenv("OCR_LANGUAGE", "auto"),
                "isOverlayRequired": "false",
                "OCREngine": "2",
            },
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise CloudOCRError(f"Cloud OCR request failed: {error}") from error

    if payload.get("IsErroredOnProcessing"):
        messages = payload.get("ErrorMessage") or payload.get("ErrorDetails") or ["OCR processing failed"]
        if isinstance(messages, str):
            messages = [messages]
        raise CloudOCRError("; ".join(str(message) for message in messages))

    pages = payload.get("ParsedResults") or []
    return "\n\n".join(str(page.get("ParsedText", "")).strip() for page in pages if page.get("ParsedText")).strip()
