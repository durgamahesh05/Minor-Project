from pydantic import Field
from .common import MongoModel


class Conversation(MongoModel):
    user_id: object = Field(alias="userId")
    title: str = "New chat"
