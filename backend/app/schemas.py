"""Pydantic request/response models for the board API.

The response shape (BoardResponse, ColumnSummary, CardSummary) matches
``frontend/src/lib/kanban.ts#BoardData`` byte-for-byte so the existing
client can swap from in-memory state to API state with no shape changes.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ColumnSummary(BaseModel):
    id: str
    title: str
    cardIds: list[str] = Field(default_factory=list)


class CardSummary(BaseModel):
    id: str
    title: str
    details: str


class BoardResponse(BaseModel):
    columns: list[ColumnSummary]
    cards: dict[str, CardSummary]


class RenameColumnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1, max_length=120)


class CreateCardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    column_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1, max_length=200)
    details: str = Field(default="", max_length=4000)


class UpdateCardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    details: str | None = Field(default=None, max_length=4000)
    column_id: str | None = Field(default=None, min_length=1)
    position: int | None = Field(default=None, ge=0)
