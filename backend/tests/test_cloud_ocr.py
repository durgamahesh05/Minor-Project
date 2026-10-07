from ingestion import cloud_ocr


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "IsErroredOnProcessing": False,
            "ParsedResults": [{"ParsedText": "First page"}, {"ParsedText": "Second page"}],
        }


def test_cloud_ocr_parses_all_pages(monkeypatch):
    monkeypatch.setenv("OCR_KEY", "test-key")
    monkeypatch.setattr(cloud_ocr.resources.http, "post", lambda *args, **kwargs: FakeResponse())

    assert cloud_ocr.extract_text(b"image", "image/jpeg") == "First page\n\nSecond page"


def test_ocr_timeout_is_configurable_and_bounded(monkeypatch):
    from unittest.mock import Mock
    monkeypatch.setenv("OCR_KEY", "test-key")
    request = Mock(return_value=FakeResponse())
    monkeypatch.setattr(cloud_ocr.resources.http, "post", request)
    monkeypatch.delenv("OCR_TIMEOUT_SECONDS", raising=False)
    cloud_ocr.extract_text(b"image")
    assert request.call_args.kwargs["timeout"] == 12
    monkeypatch.setenv("OCR_TIMEOUT_SECONDS", "90")
    cloud_ocr.extract_text(b"image")
    assert request.call_args.kwargs["timeout"] == 45
