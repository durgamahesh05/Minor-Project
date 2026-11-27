import os
from pymongo import MongoClient


def create_mongo_client(uri: str | None = None) -> MongoClient:
    connection_string = uri or os.getenv("MONGODB_URI")
    if not connection_string:
        raise RuntimeError("MONGODB_URI is not set. Copy .env.example to .env and fill it in.")
    return MongoClient(
        connection_string,
        tz_aware=True,
        maxPoolSize=50,
        minPoolSize=0,
        waitQueueTimeoutMS=10000,
    )


def get_database(client: MongoClient, name: str | None = None):
    return client.get_database(name or os.getenv("MONGODB_DATABASE", "SynapseAI"))
