"""Multimodal RAG: summarize children, retrieve linked original elements."""
import os
import logging
from threading import Lock
from dataclasses import dataclass
from typing import Any

from bson import ObjectId

from embeddings.embedder import Embedder
from ingestion.multimodal import ContentElement, extract_elements
from vectorstore.qdrant import QdrantVectorStore
from rag.resources import resources

logger = logging.getLogger(__name__)

SUMMARY_PROMPT = """Summarize this document element concisely for semantic retrieval.
Preserve names, facts, numbers, and relationships. Return only the summary.

Element type: {kind}
Element:
{content}"""

ANSWER_PROMPT = """Answer the question using only the supplied document context.
If the answer is not supported by the context, say that you could not find it in the uploaded documents.
Cite sources inline using [filename, page N] when a page is available.

Context:
{context}

Question: {question}"""

ROUTER_PROMPT = """Classify the user's message for Synapse AI.
Return exactly DOCUMENT if answering requires the user's uploaded files.
Return exactly GENERAL for greetings, casual conversation, general knowledge, or requests unrelated to uploaded files.

Message: {question}"""

GENERAL_PROMPT = """You are Synapse AI, a helpful and concise study assistant.
Answer the user naturally. Do not claim to have searched uploaded documents.

User: {question}"""


@dataclass(frozen=True)
class RAGAnswer:
    answer: str
    sources: list[dict[str, Any]]


class MultimodalRAG:
    def __init__(self, database):
        from langchain_core.output_parsers import StrOutputParser
        from langchain_core.prompts import ChatPromptTemplate
        from langchain_groq import ChatGroq

        self.database = database
        self.embedder = Embedder()
        self._vectorstore = None
        self._vectorstore_lock = Lock()
        self.text_model = ChatGroq(model=os.getenv("GROQ_TEXT_MODEL", "qwen/qwen3.8-27b"), temperature=0.2, api_key=os.getenv("GROQ_API_KEY"))
        self.vision_model = ChatGroq(model=os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b"), temperature=0.2, api_key=os.getenv("GROQ_API_KEY"))
        self.summary_chain = ChatPromptTemplate.from_template(SUMMARY_PROMPT) | self.text_model | StrOutputParser()

    @property
    def vectorstore(self):
        # General chat does not need to load embeddings or open Qdrant.
        if self._vectorstore is None:
            with self._vectorstore_lock:
                if self._vectorstore is None:
                    probe = self.embedder.embed_query("vector dimension probe")
                    self._vectorstore = QdrantVectorStore(len(probe))
        return self._vectorstore

    @vectorstore.setter
    def vectorstore(self, store):
        self._vectorstore = store

    def _image_summary(self, element: ContentElement) -> str:
        from langchain_core.messages import HumanMessage

        message = HumanMessage(content=[
            {"type": "text", "text": "Describe this document image for retrieval. Include visible text, labels, chart trends, and relationships. Return only the description."},
            {"type": "image_url", "image_url": {"url": f'data:{element.metadata.get("mime_type", "image/jpeg")};base64,{element.content}'}},
        ])
        return str(self.vision_model.invoke([message]).content)

    def _summary(self, element: ContentElement) -> str:
        if element.kind == "image":
            return self._image_summary(element)
        # Text is already chunked for embedding. Avoid a serial network request
        # per chunk; preserve the original wording for semantic retrieval.
        return element.content

    def ingest(self, filename: str, content: bytes, user_id: ObjectId, document_id: ObjectId) -> int:
        logger.info("Extracting document %s (%s)", document_id, filename)
        elements = extract_elements(filename, content)
        if not elements:
            raise ValueError("No readable content was found in this document")
        logger.info("Document %s: summarizing %d extracted elements", document_id, len(elements))
        # Only network-bound image summaries need threads. Keep the original
        # element order so each embedding stays linked to its source payload.
        summaries = [element.content for element in elements]
        image_indices = [index for index, element in enumerate(elements) if element.kind == "image"]
        image_summaries = resources.map(self._summary, (elements[index] for index in image_indices))
        for index, summary in zip(image_indices, image_summaries):
            summaries[index] = summary
        logger.info("Document %s: generating embeddings", document_id)
        vectors = self.embedder.embed(summaries)
        if len(vectors) != len(elements):
            raise ValueError("Embedding count does not match extracted document elements")
        records = []
        mongo_records = []
        for element, summary, vector in zip(elements, summaries, vectors):
            metadata = {**element.metadata, "filename": filename}
            records.append({"id": element.id, "vector": vector, "payload": {"element_id": element.id, "document_id": str(document_id), "user_id": str(user_id), "kind": element.kind, "summary": summary}})
            mongo_records.append({"_id": element.id, "documentId": document_id, "userId": user_id, "kind": element.kind, "content": element.content, "summary": summary, "metadata": metadata})
        self.database.rag_elements.insert_many(mongo_records)
        try:
            logger.info("Document %s: storing %d vectors in Qdrant", document_id, len(records))
            self.vectorstore.upsert(records)
        except Exception:
            self.database.rag_elements.delete_many({"documentId": document_id})
            raise
        logger.info("Document %s: indexed successfully (%d elements)", document_id, len(elements))
        return len(elements)

    def retrieve(self, question: str, user_id: ObjectId, limit: int = 5, document_id: ObjectId | None = None) -> list[dict[str, Any]]:
        points = self.vectorstore.search(self.embedder.embed_query(question), str(user_id), limit, document_id=str(document_id) if document_id else None)
        minimum_score = float(os.getenv("RAG_MIN_SCORE", "0.3"))
        ids = [point.payload["element_id"] for point in points if (document_id is not None or point.score >= minimum_score) and point.payload and point.payload.get("element_id")]
        query = {"_id": {"$in": ids}, "userId": user_id}
        if document_id is not None:
            query["documentId"] = document_id
        found = {item["_id"]: item for item in self.database.rag_elements.find(query)}
        return [found[element_id] for element_id in ids if element_id in found]

    def route(self, question: str) -> str:
        result = str(self.text_model.invoke(ROUTER_PROMPT.format(question=question)).content).strip().upper()
        return "DOCUMENT" if result.startswith("DOCUMENT") else "GENERAL"

    def general_answer(self, question: str) -> RAGAnswer:
        response = self.text_model.invoke(GENERAL_PROMPT.format(question=question))
        return RAGAnswer(str(response.content), [])

    def chat(self, question: str, user_id: ObjectId, document_id: ObjectId | None = None) -> RAGAnswer:
        return self.answer(question, user_id, document_id=document_id) if document_id is not None or self.route(question) == "DOCUMENT" else self.general_answer(question)

    def answer(self, question: str, user_id: ObjectId, document_id: ObjectId | None = None) -> RAGAnswer:
        from langchain_core.messages import HumanMessage

        elements = self.retrieve(question, user_id, document_id=document_id)
        if not elements:
            return RAGAnswer("I could not find relevant information in your uploaded documents.", [])
        context_parts = []
        image_parts = []
        sources = []
        for element in elements:
            metadata = element.get("metadata", {})
            source = {"documentId": str(element["documentId"]), "filename": metadata.get("filename"), "page": metadata.get("page"), "type": element["kind"]}
            if source not in sources:
                sources.append(source)
            if element["kind"] == "image" and len(image_parts) < 3:
                image_parts.append({"type": "image_url", "image_url": {"url": f'data:{metadata.get("mime_type", "image/jpeg")};base64,{element["content"]}'}})
            else:
                label = source["filename"] or "document"
                if source["page"]:
                    label += f", page {source['page']}"
                context_parts.append(f"[{label}; {element['kind']}]\n{element['content']}")
        prompt = ANSWER_PROMPT.format(context="\n\n".join(context_parts), question=question)
        response = self.vision_model.invoke([HumanMessage(content=[{"type": "text", "text": prompt}, *image_parts])]) if image_parts else self.text_model.invoke(prompt)
        return RAGAnswer(str(response.content), sources)

    def delete_document(self, document_id: ObjectId) -> None:
        self.database.rag_elements.delete_many({"documentId": document_id})
        self.vectorstore.delete_document(str(document_id))


_instances: dict[int, MultimodalRAG] = {}
_instance_lock = Lock()


def close_rag_instances() -> None:
    with _instance_lock:
        instances = list(_instances.values())
        _instances.clear()
    for instance in instances:
        instance.embedder.clear_cache()
        if instance._vectorstore is not None:
            instance._vectorstore.client.close()


def get_rag(database) -> MultimodalRAG:
    key = id(database)
    with _instance_lock:
        if key not in _instances:
            if not os.getenv("GROQ_API_KEY"):
                raise RuntimeError("GROQ_API_KEY is not configured")
            logger.info("Initializing embeddings and vector storage")
            _instances[key] = MultimodalRAG(database)
    return _instances[key]


def delete_document_artifacts(database, document_id: ObjectId) -> None:
    database.rag_elements.delete_many({"documentId": document_id})
    instance = _instances.get(id(database))
    if instance and instance._vectorstore is not None:
        try:
            instance.vectorstore.delete_document(str(document_id))
        except Exception:
            # The authoritative parent payload is gone; stale vector hits are
            # ignored by retrieve() if Qdrant is temporarily unavailable.
            pass
