"""pgvector storage in Supabase Postgres.

Vectors live in public.document_vectors, one row per document element, always
scoped by user_id. Searches rank only the requesting user's rows, so results
can never be crowded out by (or leak from) other users' documents.
"""
import logging
import os
from contextlib import contextmanager
from threading import Lock
from types import SimpleNamespace
from typing import Any, Callable, Iterator, TypeVar

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json, execute_values
from psycopg2.pool import ThreadedConnectionPool

logger = logging.getLogger(__name__)
T = TypeVar("T")

# Schema setup runs once per process for each database/dimension pair.
_schema_ready: dict[tuple[str, int], str] = {}
_schema_lock = Lock()

# Supabase's pooler drops idle connections; keepalives detect that early.
_KEEPALIVE = {"keepalives": 1, "keepalives_idle": 30, "keepalives_interval": 10, "keepalives_count": 3}
_RETRYABLE = (psycopg2.OperationalError, psycopg2.InterfaceError)
_BATCH_SIZE = 200


def _database_url() -> str:
    database_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DIRECT_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("Set SUPABASE_DB_URL to use Supabase vectors")
    return database_url


class SupabaseVectorStore:
    def __init__(self, vector_size: int):
        self.dimension = int(os.getenv("SUPABASE_VECTOR_DIMENSIONS", "384"))
        if vector_size != self.dimension:
            raise ValueError(f"Supabase vector table expects {self.dimension} dimensions, received {vector_size}")
        database_url = _database_url()
        max_connections = max(2, int(os.getenv("SUPABASE_POOL_SIZE", "10")))
        self.pool = ThreadedConnectionPool(1, max_connections, dsn=database_url, connect_timeout=10, **_KEEPALIVE)
        self.vector_schema = ""
        try:
            key = (database_url, self.dimension)
            with _schema_lock:
                if key not in _schema_ready:
                    _schema_ready[key] = self._ensure_schema()
                self.vector_schema = _schema_ready[key]
        except Exception:
            self.pool.closeall()
            raise

    @contextmanager
    def connection(self) -> Iterator[Any]:
        connection = self.pool.getconn()
        broken = False
        try:
            if connection.closed:
                # The server closed it while idle; replace it before use.
                self.pool.putconn(connection, close=True)
                connection = self.pool.getconn()
            yield connection
            connection.commit()
        except _RETRYABLE:
            broken = True
            raise
        except Exception:
            if not connection.closed:
                connection.rollback()
            raise
        finally:
            self.pool.putconn(connection, close=broken or bool(connection.closed))

    def _run(self, operation: Callable[[Any], T]) -> T:
        """Run an idempotent statement, retrying once on a dropped connection."""
        for attempt in range(2):
            try:
                with self.connection() as connection, connection.cursor() as cursor:
                    return operation(cursor)
            except _RETRYABLE:
                if attempt:
                    raise
                logger.warning("Supabase connection was dropped; retrying once")
        raise AssertionError("unreachable")

    def _ensure_schema(self) -> str:
        with self.connection() as connection, connection.cursor() as cursor:
            cursor.execute("CREATE SCHEMA IF NOT EXISTS extensions")
            cursor.execute("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions")
            cursor.execute(
                "SELECT namespace.nspname FROM pg_extension "
                "JOIN pg_namespace AS namespace ON namespace.oid = pg_extension.extnamespace "
                "WHERE pg_extension.extname = 'vector'"
            )
            extension_schema = cursor.fetchone()
            if extension_schema is None:
                raise RuntimeError("The Supabase vector extension could not be enabled")
            vector_schema = extension_schema[0]
            vector_type = sql.SQL("{}.vector({})").format(sql.Identifier(vector_schema), sql.Literal(self.dimension))
            vector_operator = sql.Identifier(vector_schema, "vector_cosine_ops")
            cursor.execute(sql.SQL(
                "CREATE TABLE IF NOT EXISTS public.document_vectors ("
                "id text PRIMARY KEY, user_id text NOT NULL, document_id text NOT NULL, "
                "embedding {} NOT NULL, payload jsonb NOT NULL)"
            ).format(vector_type))
            cursor.execute(sql.SQL(
                "CREATE INDEX IF NOT EXISTS document_vectors_embedding_hnsw_idx "
                "ON public.document_vectors USING hnsw (embedding {})"
            ).format(vector_operator))
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS document_vectors_owner_document_idx "
                "ON public.document_vectors (user_id, document_id)"
            )
            cursor.execute("ALTER TABLE public.document_vectors ENABLE ROW LEVEL SECURITY")
            cursor.execute("REVOKE ALL ON public.document_vectors FROM PUBLIC, anon, authenticated")
            cursor.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_vectors TO service_role")
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS public.uploaded_documents ("
                "document_id text PRIMARY KEY, user_id text NOT NULL, file_name text NOT NULL)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS uploaded_documents_user_id_idx "
                "ON public.uploaded_documents (user_id)"
            )
            cursor.execute("ALTER TABLE public.uploaded_documents ENABLE ROW LEVEL SECURITY")
            cursor.execute("REVOKE ALL ON public.uploaded_documents FROM PUBLIC, anon, authenticated")
            cursor.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON public.uploaded_documents TO service_role")
        return vector_schema

    def upsert(self, records: list[dict[str, Any]]) -> None:
        if not records:
            return
        statement = sql.SQL(
            "INSERT INTO public.document_vectors (id, user_id, document_id, embedding, payload) VALUES %s "
            "ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, "
            "document_id = EXCLUDED.document_id, embedding = EXCLUDED.embedding, payload = EXCLUDED.payload"
        )
        template = sql.SQL("(%s, %s, %s, %s::{}.vector({}), %s)").format(
            sql.Identifier(self.vector_schema), sql.Literal(self.dimension))
        rows = [(
            record["id"],
            record["payload"]["user_id"],
            record["payload"]["document_id"],
            self._vector_literal(record["vector"]),
            Json(record["payload"]),
        ) for record in records]

        def write(cursor) -> None:
            statement_text = statement.as_string(cursor)
            template_text = template.as_string(cursor)
            # One round trip per batch instead of one per row (Supabase is remote).
            execute_values(cursor, statement_text, rows, template=template_text, page_size=_BATCH_SIZE)

        # All rows commit together, so a retry after a dropped connection is safe.
        self._run(write)

    def search(self, vector: list[float], user_id: str, limit: int = 5, document_id: str | None = None):
        if limit <= 0:
            return []
        distance = sql.SQL("embedding OPERATOR({}.<=>) %(query)s::{}.vector({})").format(
            sql.Identifier(self.vector_schema), sql.Identifier(self.vector_schema), sql.Literal(self.dimension))
        # Rank exactly within the user's own rows (served by the user_id index).
        # A global approximate index scan filtered afterwards can return fewer
        # than `limit` matches, or none, once many users share the table.
        statement = sql.SQL(
            "WITH candidates AS MATERIALIZED ("
            "SELECT id, payload, embedding FROM public.document_vectors "
            "WHERE user_id = %(user_id)s AND (%(document_id)s::text IS NULL OR document_id = %(document_id)s)) "
            "SELECT id, payload, 1 - ({distance}) AS score FROM candidates ORDER BY {distance} LIMIT %(limit)s"
        ).format(distance=distance)
        parameters = {"query": self._vector_literal(vector), "user_id": user_id, "document_id": document_id, "limit": limit}

        def query(cursor):
            cursor.execute(statement, parameters)
            return [SimpleNamespace(id=identifier, payload=payload, score=float(score))
                    for identifier, payload, score in cursor.fetchall()]

        return self._run(query)

    def delete_document(self, document_id: str) -> None:
        self._run(lambda cursor: cursor.execute("DELETE FROM public.document_vectors WHERE document_id = %s", (document_id,)))

    def close(self) -> None:
        self.pool.closeall()

    def _vector_literal(self, vector: list[float]) -> str:
        if len(vector) != self.dimension:
            raise ValueError(f"Expected {self.dimension} vector values, received {len(vector)}")
        return "[" + ",".join(format(value, ".9g") for value in vector) + "]"
