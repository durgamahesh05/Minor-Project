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
