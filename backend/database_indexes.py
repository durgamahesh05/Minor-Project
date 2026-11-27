"""Indexes for the ownership filters and ordering used by the API."""
import logging


def ensure_indexes(database):
    indexes = {
        "users": [([("email", 1)], {"unique": True})],
        "pendingregistrations": [([("email", 1)], {"unique": True}), ([ ("otpExpiresAt", 1)], {"expireAfterSeconds": 0})],
        "accountdeletions": [([("email", 1)], {}), ([ ("deletedAt", 1)], {"expireAfterSeconds": 2592000})],
        "passwordresetotps": [([("expiresAt", 1)], {"expireAfterSeconds": 0})],
        "documents": [([("userId", 1), ("status", 1), ("createdAt", -1)], {})],
        "rag_elements": [([("userId", 1), ("documentId", 1)], {}), ([ ("documentId", 1)], {})],
        "messages": [([("conversationId", 1), ("createdAt", 1)], {})],
        "conversations": [([("userId", 1), ("updatedAt", -1)], {})],
        "quizzes": [([("userId", 1), ("createdAt", -1)], {})],
        "flashcardsets": [([("userId", 1), ("createdAt", -1)], {})],
    }
    for collection, definitions in indexes.items():
        for keys, options in definitions:
            try:
                existing_indexes = database[collection].index_information()
                matching = next((index for index in existing_indexes.values() if list(index["key"]) == keys), None)
                if matching and all(matching.get(key) == value for key, value in options.items()):
                    continue
                if matching and matching["name"] != "_id_":
                    database[collection].drop_index(matching["name"])
                database[collection].create_index(keys, **options)
            except Exception as error:
                logging.warning("Index setup for %s failed (%s)", collection, type(error).__name__)
