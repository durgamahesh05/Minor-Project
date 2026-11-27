import mongomock

from database_indexes import ensure_indexes


def test_replaces_an_existing_non_unique_email_index(caplog):
    database = mongomock.MongoClient().db
    database.users.create_index([("email", 1)])  # left over from an older schema
    ensure_indexes(database)
    email_index = next(index for index in database.users.index_information().values() if index["key"] == [("email", 1)])
    assert email_index.get("unique") is True
    assert "failed" not in caplog.text


def test_running_twice_keeps_indexes_unchanged():
    database = mongomock.MongoClient().db
    ensure_indexes(database)
    before = database.users.index_information()
    ensure_indexes(database)
    assert database.users.index_information() == before
