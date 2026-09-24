"""Local embeddings keep the RAG pipeline independent of paid embedding APIs."""
import os
from collections import OrderedDict
from hashlib import sha256
from threading import RLock


class Embedder:
    def __init__(self, model_name: str | None = None, cache_size: int = 128):
        self._model_name = model_name or os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
        self._model = None
        self._lock = RLock()
        self._cache_size = max(0, cache_size)
        self._query_cache: OrderedDict[str, tuple[float, ...]] = OrderedDict()

    def _load_model(self):
        if self._model is not None:
            return self._model
        try:
            from fastembed import TextEmbedding
        except ImportError as error:
            raise RuntimeError("Install fastembed to generate document embeddings") from error
        self._model = TextEmbedding(model_name=self._model_name)
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        # Serialize model initialization/inference across FastAPI worker threads.
        with self._lock:
            return [vector.tolist() for vector in self._load_model().embed(texts)]

    def embed_query(self, text: str) -> list[float]:
        key = sha256(text.encode("utf-8")).hexdigest()
        with self._lock:
            if key in self._query_cache:
                self._query_cache.move_to_end(key)
                return list(self._query_cache[key])
            vector = self.embed([text])[0]
            if self._cache_size:
                self._query_cache[key] = tuple(vector)
                if len(self._query_cache) > self._cache_size:
                    self._query_cache.popitem(last=False)
            return vector

    def clear_cache(self) -> None:
        with self._lock:
            self._query_cache.clear()
