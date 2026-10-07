import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from qdrant_client.models import Condition


class QdrantVectorStore:
    """Qdrant summary index used by the multivector retriever."""

    def __init__(self, vector_size: int):
        try:
            from qdrant_client import QdrantClient, models
        except ImportError as error:
            raise RuntimeError("Install qdrant-client to enable vector storage") from error
        url = os.getenv("QDRANT_URL")
        self.models = models
        self.collection = os.getenv("QDRANT_COLLECTION", "synapse_documents")
        self.client = QdrantClient(url=url, api_key=os.getenv("QDRANT_API_KEY") or None) if url else QdrantClient(path=str(Path(__file__).resolve().parents[1] / "qdrant_data"))
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(collection_name=self.collection, vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE))

    def upsert(self, records: list[dict[str, Any]]) -> None:
        points = [self.models.PointStruct(id=item["id"], vector=item["vector"], payload=item["payload"]) for item in records]
        if points:
            self.client.upsert(collection_name=self.collection, points=points, wait=True)

    def search(self, vector: list[float], user_id: str, limit: int = 5, document_id: str | None = None):
        conditions: list[Condition] = [self.models.FieldCondition(key="user_id", match=self.models.MatchValue(value=user_id))]
        if document_id:
            conditions.append(self.models.FieldCondition(key="document_id", match=self.models.MatchValue(value=document_id)))
        user_filter = self.models.Filter(must=conditions)
        return self.client.query_points(collection_name=self.collection, query=vector, query_filter=user_filter, limit=limit).points

    def delete_document(self, document_id: str) -> None:
        selector = self.models.FilterSelector(filter=self.models.Filter(must=[self.models.FieldCondition(key="document_id", match=self.models.MatchValue(value=document_id))]))
        self.client.delete(collection_name=self.collection, points_selector=selector, wait=True)
