"""Minimal async client for OpenRouter chat completions."""

from __future__ import annotations

from typing import Any

import httpx

CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-oss-120b:free"


class OpenRouterError(Exception):
    """Upstream OpenRouter returned a non-success status or an unusable body."""

    def __init__(self, status_code: int, message: str = "OpenRouter request failed") -> None:
        self.status_code = status_code
        super().__init__(message)


async def chat(
    *,
    api_key: str,
    messages: list[dict[str, Any]],
    model: str = DEFAULT_MODEL,
    response_format: dict[str, Any] | None = None,
    timeout: float = 120.0,
) -> dict[str, Any]:
    """POST ``/chat/completions`` and return the parsed JSON body.

    ``response_format`` is forwarded when set (Structured Outputs in Part 9+).
    Never logs the API key or raw upstream bodies on failure.
    """

    if not api_key.strip():
        raise OpenRouterError(401, "Missing OpenRouter API key")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body: dict[str, Any] = {"model": model, "messages": messages}
    if response_format is not None:
        body["response_format"] = response_format

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(CHAT_COMPLETIONS_URL, headers=headers, json=body)

    if response.status_code >= 400:
        raise OpenRouterError(response.status_code)

    try:
        return response.json()
    except ValueError as exc:
        raise OpenRouterError(502, "OpenRouter returned non-JSON body") from exc


def assistant_text(data: dict[str, Any]) -> str:
    """First choice ``message.content``, stripped, or empty string."""

    try:
        choices = data["choices"]
        if not choices:
            return ""
        msg = choices[0].get("message") or {}
        raw = msg.get("content")
        if raw is None:
            return ""
        return str(raw).strip()
    except (KeyError, TypeError, IndexError):
        return ""
