from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


class SPAStaticFiles(StaticFiles):
    """StaticFiles tuned for Next.js static export.

    Next emits flat HTML files like ``login.html`` next to ``index.html`` for
    every page, plus its own ``404.html``. Starlette's StaticFiles, when
    ``html=True``, only auto-resolves ``<path>`` and ``<path>/index.html`` and
    returns ``404.html`` with HTTP 404 on a miss instead of raising
    HTTPException. This subclass:

    1. Handles both forms of "not found" (response and exception).
    2. Re-raises true 404s for ``/api/*`` so API consumers never get HTML.
    3. Lets extensioned-asset 404s stand (e.g. ``/_next/static/missing.js``).
    4. Tries ``<path>.html`` for extensionless paths so ``/login`` resolves to
       ``login.html``.
    5. Falls back to ``index.html`` for any other unmatched extensionless path
       so client-side routing still works for routes Next didn't pre-render.
    """

    async def get_response(self, path: str, scope: Scope):
        response = await self._safe_get(path, scope)
        if response is not None and response.status_code != 404:
            return response

        normalized = path.replace("\\", "/")
        if normalized == "api" or normalized.startswith("api/"):
            raise HTTPException(status_code=404)

        last_segment = normalized.rsplit("/", 1)[-1]
        if "." in last_segment:
            if response is not None:
                return response
            raise HTTPException(status_code=404)

        html_response = await self._safe_get(f"{normalized}.html", scope)
        if html_response is not None and html_response.status_code != 404:
            return html_response

        return await super().get_response("index.html", scope)

    async def _safe_get(self, path: str, scope: Scope):
        """Return the StaticFiles response, or None if it raised a 404."""
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            return None
