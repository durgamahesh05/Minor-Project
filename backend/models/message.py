from typing import Literal
from pydantic import Field
from .common import MongoModel


class Message(MongoModel):
    conversation_id: object = Field(alias="conversationId")
    role: Literal["user", "assistant"]
    text: str
