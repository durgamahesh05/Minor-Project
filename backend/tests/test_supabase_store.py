from types import SimpleNamespace
from unittest.mock import MagicMock

import psycopg2
import pytest

from vectorstore import supabase


class FakeCursor:
    def __init__(self, log, fail=None):
        self.log, self.fail = log, fail
        self.connection = SimpleNamespace(encoding="UTF8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, statement, parameters=None):
        if self.fail:
            error, self.fail = self.fail, None
            raise error
        self.log.append(("execute", statement, parameters))

    def fetchall(self):
        return [("element", {"element_id": "element"}, 0.9)]


def make_store(monkeypatch, fail=None):
    log = []
    connections = []

    def new_connection():
        connection = MagicMock(closed=0)
        connection.cursor.return_value = FakeCursor(log, fail if not connections else None)
        connections.append(connection)
        return connection

    pool = MagicMock()
    pool.getconn.side_effect = new_connection
    store = supabase.SupabaseVectorStore.__new__(supabase.SupabaseVectorStore)
    store.dimension, store.vector_schema, store.pool = 2, "extensions", pool
    return store, log, pool


def test_upsert_sends_rows_in_batches(monkeypatch):
    store, _, _ = make_store(monkeypatch)
    calls = []
    monkeypatch.setattr(supabase, "execute_values", lambda cursor, statement, rows, template, page_size: calls.append((rows, page_size)))
    monkeypatch.setattr(supabase.sql.Composed, "as_string", lambda self, context: "sql", raising=False)
    monkeypatch.setattr(supabase.sql.SQL, "as_string", lambda self, context: "sql", raising=False)
    records = [{"id": str(i), "vector": [0.1, 0.2], "payload": {"user_id": "u", "document_id": "d"}} for i in range(450)]
    store.upsert(records)
    assert len(calls) == 1 and len(calls[0][0]) == 450 and calls[0][1] == supabase._BATCH_SIZE


def test_search_ranks_only_the_users_rows(monkeypatch):
    store, log, _ = make_store(monkeypatch)
    hits = store.search([0.1, 0.2], "user-1", 3, document_id="doc-1")
    statement, parameters = log[0][1], log[0][2]
    text = repr(statement)
    assert "MATERIALIZED" in text and "user_id = %(user_id)s" in text
    assert parameters["user_id"] == "user-1" and parameters["document_id"] == "doc-1" and parameters["limit"] == 3
    assert hits[0].id == "element" and hits[0].score == 0.9


def test_dropped_connection_is_discarded_and_retried(monkeypatch):
    store, log, pool = make_store(monkeypatch, fail=psycopg2.OperationalError("server closed the connection"))
    store.delete_document("doc-1")
    assert len(log) == 1  # second attempt succeeded
    first_release = pool.putconn.call_args_list[0]
    assert first_release.kwargs.get("close") is True


def test_vector_dimension_is_validated(monkeypatch):
    store, _, _ = make_store(monkeypatch)
    with pytest.raises(ValueError):
        store.search([0.1], "user", 1)
