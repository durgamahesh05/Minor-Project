"""Indexes for the ownership filters and ordering used by the API."""
import logging


def ensure_indexes(database):
    indexes = {
        "users": [[("email", 1)]],
        "documents": [[("userId", 1), ("status", 1), ("createdAt", -1)]],
        "rag_elements": [[("userId", 1), ("documentId", 1)], [("documentId", 1)]],
        "messages": [[("conversationId", 1), ("createdAt", 1)]],
        "conversations": [[("userId", 1), ("updatedAt", -1)]],
        "quizzes": [[("userId", 1), ("createdAt", -1)]],
        "flashcardsets": [[("userId", 1), ("createdAt", -1)]],
    }
    for collection, definitions in indexes.items():
        for keys in definitions:
            try:
                existing = database[collection].index_information().values()
                if not any(list(index["key"]) == keys for index in existing):
                    database[collection].create_index(keys)
            except Exception as error:
                logging.warning("Index setup for %s failed (%s)", collection, type(error).__name__)
