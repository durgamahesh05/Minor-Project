"""Multimodal RAG: summarize children, retrieve linked original elements."""
import os
import logging
from threading import Lock
from time import perf_counter
from dataclasses import dataclass
from typing import Any

from bson import ObjectId
from pydantic import SecretStr

from embeddings.embedder import Embedder
from ingestion.multimodal import ContentElement, extract_elements
from vectorstore.qdrant import QdrantVectorStore
from vectorstore.chroma import ChromaVectorStore
from vectorstore.supabase import SupabaseVectorStore
from rag.resources import resources
from rag.response_policy import ResponseLevel, language_name, response_policy

logger = logging.getLogger(__name__)

NOT_FOUND = {
    "English": "I could not find relevant information in your uploaded documents.",
    "Hindi": "मुझे आपके अपलोड किए गए दस्तावेज़ों में इससे जुड़ी जानकारी नहीं मिली।",
    "Telugu": "మీరు అప్‌లోడ్ చేసిన పత్రాల్లో సంబంధిత సమాచారం దొరకలేదు.",
    "Spanish": "No encontré información relevante en tus documentos subidos.",
    "French": "Je n'ai trouvé aucune information pertinente dans vos documents importés.",
}


def not_found_message(language: str | None = None) -> str:
    return NOT_FOUND.get(language_name(language) or "English", NOT_FOUND["English"])

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


DEFAULT_FALLBACK_MODELS = "openai/gpt-oss-120b,openai/gpt-oss-20b"


def _groq(model: str, **options):
    from langchain_groq import ChatGroq

    key = os.getenv("GROQ_API_KEY")
    return ChatGroq(model=model, temperature=0.2, api_key=SecretStr(key) if key else None, **options)


def build_text_model():
    """Primary Groq model, handing off to other models when it is rate limited.

    Groq limits are per model; on the free tier one model allows only ~1000
    output tokens per minute, so retrying the same model waits 40s+. Switching
    to a fallback model answers in about a second instead.
    """
    primary = os.getenv("GROQ_TEXT_MODEL", "qwen/qwen3.8-27b")
    names = [name.strip() for name in os.getenv("GROQ_FALLBACK_MODELS", DEFAULT_FALLBACK_MODELS).split(",")]
    names = list(dict.fromkeys(name for name in names if name and name != primary))
    if not names:
        return _groq(primary)
    import groq

    models = [_groq(primary, max_retries=0)]
    for position, name in enumerate(names):
        last = position == len(names) - 1
        # gpt-oss models reason before answering; low effort keeps them fast and cheap.
        options = {"reasoning_effort": "low"} if name.startswith("openai/gpt-oss") else {}
        models.append(_groq(name, max_retries=2 if last else 0, **options))
    handled = (groq.RateLimitError, groq.InternalServerError, groq.APIConnectionError, groq.APITimeoutError)
    return models[0].with_fallbacks(models[1:], exceptions_to_handle=handled)


def with_language(prompt: str, language: str | None) -> str:
    """Repeat an explicit language choice last, where the model weighs it most."""
    name = language_name(language)
    return f"{prompt}\n\nWrite your entire answer in {name}." if name else prompt


@dataclass(frozen=True)
class RAGAnswer:
    answer: str
    sources: list[dict[str, Any]]


class MultimodalRAG:
    def __init__(self, database):
        from langchain_core.output_parsers import StrOutputParser
        from langchain_core.prompts import ChatPromptTemplate

        self.database = database
        self.embedder = Embedder()
        self._vectorstore = None
        self._vectorstore_lock = Lock()
        self.text_model = build_text_model()
        self.vision_model = _groq(os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b"), timeout=30, max_retries=1)
        self.summary_chain = ChatPromptTemplate.from_template(SUMMARY_PROMPT) | self.text_model | StrOutputParser()

    @property
    def vectorstore(self):
        # General chat does not need to load embeddings or open Qdrant.
        if self._vectorstore is None:
            with self._vectorstore_lock:
                if self._vectorstore is None:
                    dimension = getattr(self, "_vector_dimension", None)
                    if dimension is None:
                        dimension = len(self.embedder.embed_query("vector dimension probe"))
                    provider = os.getenv("VECTOR_STORE", "supabase").lower()
                    stores = {"chroma": ChromaVectorStore, "qdrant": QdrantVectorStore, "supabase": SupabaseVectorStore}
                    if provider not in stores:
                        raise ValueError("VECTOR_STORE must be supabase, chroma, or qdrant")
                    store_type = stores[provider]
                    self._vectorstore = store_type(dimension)
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
        return str(self.vision_model.bind(max_tokens=512).invoke([message]).content)

    def _summary(self, element: ContentElement) -> str:
        if element.kind == "image":
            return self._image_summary(element)
        # Text is already chunked for embedding. Avoid a serial network request
        # per chunk; preserve the original wording for semantic retrieval.
        return element.content

    def ingest(self, filename: str, content: bytes, user_id: ObjectId, document_id: ObjectId) -> int:
        started = perf_counter()
        logger.info("Extracting document %s (%s)", document_id, filename)
        elements = extract_elements(filename, content)
        extracted = perf_counter()
        logger.info("Document %s: extraction/OCR took %.2fs", document_id, extracted-started)
        if not elements:
            raise ValueError("No readable content was found in this document")
        logger.info("Document %s: summarizing %d extracted elements", document_id, len(elements))
        # Only network-bound image summaries need threads. Keep the original
        # element order so each embedding stays linked to its source payload.
        summaries = [element.content for element in elements]
        image_indices = [index for index, element in enumerate(elements) if element.kind == "image"]
        # Repeated PDF logos/figures need only one vision request per upload.
        unique_images = {}
        for index in image_indices:
            element = elements[index]
            unique_images.setdefault((element.content, element.metadata.get("mime_type")), element)
        image_summaries = dict(zip(unique_images, resources.map(self._summary, unique_images.values())))
        for index in image_indices:
            element = elements[index]
            summaries[index] = image_summaries[(element.content, element.metadata.get("mime_type"))]
        summarized = perf_counter()
        logger.info("Document %s: image summaries took %.2fs", document_id, summarized-extracted)
        logger.info("Document %s: generating embeddings", document_id)
        unique_summaries = list(dict.fromkeys(summaries))
        unique_vectors = self.embedder.embed(unique_summaries)
        if len(unique_vectors) != len(unique_summaries):
            raise ValueError("Embedding count does not match extracted document elements")
        self._vector_dimension = len(unique_vectors[0])
        embedded = perf_counter()
        logger.info("Document %s: embedding %d unique chunks took %.2fs", document_id, len(unique_summaries), embedded-summarized)
        vector_by_summary = dict(zip(unique_summaries, unique_vectors))
        vectors = [vector_by_summary[summary] for summary in summaries]
        records = []
        mongo_records = []
        for element, summary, vector in zip(elements, summaries, vectors):
            metadata = {**element.metadata, "filename": filename}
            records.append({"id": element.id, "vector": vector, "payload": {"element_id": element.id, "document_id": str(document_id), "user_id": str(user_id), "kind": element.kind, "summary": summary}})
            mongo_records.append({"_id": element.id, "documentId": document_id, "userId": user_id, "kind": element.kind, "content": element.content, "summary": summary, "metadata": metadata})
        self.database.rag_elements.insert_many(mongo_records)
        try:
            logger.info("Document %s: storing %d vectors in configured vector store", document_id, len(records))
            self.vectorstore.upsert(records)
        except Exception:
            self.database.rag_elements.delete_many({"documentId": document_id})
            raise
        finished = perf_counter()
        logger.info("Document %s: indexed %d elements in %.2fs (storage %.2fs)", document_id, len(elements), finished-started, finished-embedded)
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

    def general_answer(self, question: str, response_level: ResponseLevel = "simple", language: str | None = None) -> RAGAnswer:
        from langchain_core.messages import SystemMessage, HumanMessage
        policy = response_policy(question, response_level, language)
        response = self.text_model.bind(max_tokens=policy.max_tokens).invoke([SystemMessage(content=policy.instruction), HumanMessage(content=with_language(GENERAL_PROMPT.format(question=question), language))])
        return RAGAnswer(str(response.content), [])

    def chat(self, question: str, user_id: ObjectId, document_id: ObjectId | None = None, response_level: ResponseLevel = "simple", language: str | None = None) -> RAGAnswer:
        if document_id is not None or self.route(question) == "DOCUMENT":
            return self.answer(question, user_id, document_id=document_id, response_level=response_level, language=language)
        return self.general_answer(question, response_level=response_level, language=language)

    def answer(self, question: str, user_id: ObjectId, document_id: ObjectId | None = None, response_level: ResponseLevel = "simple", document_ids: list[ObjectId] | None = None, language: str | None = None) -> RAGAnswer:
        from langchain_core.messages import HumanMessage

        if document_ids:
            # Give every attachment context space; keep user/document filters on each query.
            groups = resources.map(lambda ident: self.retrieve(question, user_id, limit=3, document_id=ident), document_ids)
            elements = [element for group in groups for element in group]
        else:
            elements = self.retrieve(question, user_id, document_id=document_id)
        if not elements:
            return RAGAnswer(not_found_message(language), [])
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
                text = element.get("summary", "Image") if element["kind"] == "image" else element["content"]
                context_parts.append(f"[{label}; {element['kind']}]\n{text}")
        prompt = with_language(ANSWER_PROMPT.format(context="\n\n".join(context_parts), question=question), language)
        from langchain_core.messages import SystemMessage
        policy = response_policy(question, response_level, language)
        model = self.vision_model if image_parts else self.text_model
        content = [{"type": "text", "text": prompt}, *image_parts] if image_parts else prompt
        response = model.bind(max_tokens=policy.max_tokens).invoke([SystemMessage(content=policy.instruction), HumanMessage(content=content)])
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
            close = getattr(instance._vectorstore, "close", None)
            if not callable(close):
                close = getattr(getattr(instance._vectorstore, "client", None), "close", None)
            if callable(close):
                close()


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
    owns_store = False
    if instance and instance._vectorstore is not None:
        store = instance.vectorstore
    elif os.getenv("VECTOR_STORE", "supabase").lower() == "chroma":
        store = ChromaVectorStore(0)
    elif os.getenv("VECTOR_STORE", "supabase").lower() == "supabase":
        store = SupabaseVectorStore(int(os.getenv("SUPABASE_VECTOR_DIMENSIONS", "384")))
        owns_store = True
    else:
        store = None
    if store is not None:
        try:
            store.delete_document(str(document_id))
        except Exception:
            # The authoritative parent payload is gone; stale vector hits are
            # ignored by retrieve() if Qdrant is temporarily unavailable.
            pass
        finally:
            close = getattr(store, "close", None)
            if owns_store and callable(close):
                close()
