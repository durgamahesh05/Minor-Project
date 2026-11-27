import os
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, Iterator

from psycopg2 import sql
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import Json


class SupabaseVectorStore:
    def __init__(self, vector_size: int):
        self.dimension = int(os.getenv("SUPABASE_VECTOR_DIMENSIONS", "384"))
        if vector_size != self.dimension:
            raise ValueError(f"Supabase vector table expects {self.dimension} dimensions, received {vector_size}")
        database_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DIRECT_URL") or os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("Set SUPABASE_DB_URL to use Supabase vectors")
        self.pool = ThreadedConnectionPool(1, 10, dsn=database_url)
        self.vector_schema = ""
        try:
            self._ensure_schema()
        except Exception:
            self.pool.closeall()
            raise

    @contextmanager
    def connection(self) -> Iterator[Any]:
        connection = self.pool.getconn()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            self.pool.putconn(connection)

    def _ensure_schema(self) -> None:
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
            self.vector_schema = extension_schema[0]
            vector_type = sql.SQL("{}.vector({})").format(sql.Identifier(self.vector_schema), sql.Literal(self.dimension))
            vector_operator = sql.Identifier(self.vector_schema, "vector_cosine_ops")
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

    def upsert(self, records: list[dict[str, Any]]) -> None:
        statement = sql.SQL(
            "INSERT INTO public.document_vectors (id, user_id, document_id, embedding, payload) "
            "VALUES (%s, %s, %s, %s::{}.vector({}), %s) "
            "ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, "
            "document_id = EXCLUDED.document_id, embedding = EXCLUDED.embedding, payload = EXCLUDED.payload"
        ).format(sql.Identifier(self.vector_schema), sql.Literal(self.dimension))
        with self.connection() as connection, connection.cursor() as cursor:
            for offset in range(0, len(records), 100):
                batch = records[offset:offset + 100]
                rows = [(
                    record["id"],
                    record["payload"]["user_id"],
                    record["payload"]["document_id"],
                    self._vector_literal(record["vector"]),
                    Json(record["payload"]),
                ) for record in batch]
                cursor.executemany(statement, rows)

    def search(self, vector: list[float], user_id: str, limit: int = 5, document_id: str | None = None):
        if limit <= 0:
            return []
        statement = sql.SQL(
            "SELECT id, payload, 1 - (embedding OPERATOR({}.<=>) %s::{}.vector({})) AS score "
            "FROM public.document_vectors WHERE user_id = %s "
            "AND (%s IS NULL OR document_id = %s) "
            "ORDER BY embedding OPERATOR({}.<=>) %s::{}.vector({}) LIMIT %s"
        ).format(
            sql.Identifier(self.vector_schema),
            sql.Literal(self.dimension),
            sql.Identifier(self.vector_schema),
            sql.Literal(self.dimension),
            sql.Identifier(self.vector_schema),
            sql.Literal(self.dimension),
        )
        value = self._vector_literal(vector)
        with self.connection() as connection, connection.cursor() as cursor:
            cursor.execute(statement, (value, user_id, document_id, document_id, value, limit))
            return [SimpleNamespace(id=identifier, payload=payload, score=float(score))
                    for identifier, payload, score in cursor.fetchall()]

    def delete_document(self, document_id: str) -> None:
        with self.connection() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM public.document_vectors WHERE document_id = %s", (document_id,))

    def close(self) -> None:
        self.pool.closeall()

    def _vector_literal(self, vector: list[float]) -> str:
        if len(vector) != self.dimension:
            raise ValueError(f"Expected {self.dimension} vector values, received {len(vector)}")
        return "[" + ",".join(format(value, ".9g") for value in vector) + "]"
