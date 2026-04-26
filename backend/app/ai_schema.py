"""Structured-output schema + validation models for chat replies."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class RenameColumnOp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["rename_column"]
    column_id: str
    title: str


class CreateCardOp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["create_card"]
    column_id: str
    title: str
    details: str


class DeleteCardOp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["delete_card"]
    card_id: str


class UpdateCardOp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["update_card"]
    card_id: str
    title: str | None = None
    details: str | None = None
    column_id: str | None = None
    position: int | None = Field(default=None, ge=0)


BoardOp = Annotated[
    RenameColumnOp | CreateCardOp | DeleteCardOp | UpdateCardOp,
    Field(discriminator="op"),
]


class BoardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operations: list[BoardOp] = Field(default_factory=list)


class ChatModelResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str
    board_update: BoardUpdate | None = None


CHAT_RESPONSE_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reply"],
    "properties": {
        "reply": {"type": "string"},
        "board_update": {
            "type": ["object", "null"],
            "additionalProperties": False,
            "required": ["operations"],
            "properties": {
                "operations": {
                    "type": "array",
                    "items": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["op", "column_id", "title"],
                                "properties": {
                                    "op": {"const": "rename_column"},
                                    "column_id": {"type": "string"},
                                    "title": {"type": "string"},
                                },
                            },
                            {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["op", "column_id", "title", "details"],
                                "properties": {
                                    "op": {"const": "create_card"},
                                    "column_id": {"type": "string"},
                                    "title": {"type": "string"},
                                    "details": {"type": "string"},
                                },
                            },
                            {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["op", "card_id"],
                                "properties": {
                                    "op": {"const": "delete_card"},
                                    "card_id": {"type": "string"},
                                },
                            },
                            {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["op", "card_id"],
                                "properties": {
                                    "op": {"const": "update_card"},
                                    "card_id": {"type": "string"},
                                    "title": {"type": "string"},
                                    "details": {"type": "string"},
                                    "column_id": {"type": "string"},
                                    "position": {"type": "integer", "minimum": 0},
                                },
                            },
                        ]
                    },
                }
            },
        },
    },
}


def openrouter_response_format() -> dict:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "chat_response",
            "strict": True,
            "schema": CHAT_RESPONSE_SCHEMA,
        },
    }


def parse_chat_model_json(raw_json: str) -> ChatModelResponse:
    return TypeAdapter(ChatModelResponse).validate_json(raw_json)
