"""Shared environment defaults for tests that mock external services."""

import os


# main.py constructs a MongoClient during import. Tests patch the constructor,
# so a local placeholder URI is enough and never opens a database connection.
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
