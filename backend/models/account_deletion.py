from datetime import datetime, timezone
from pydantic import Field
from .common import MongoModel


class AccountDeletion(MongoModel):
    email: str
    deleted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="deletedAt")
