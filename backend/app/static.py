from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


class SPAStaticFiles(StaticFiles):
    """StaticFiles that falls back to index.html for unknown extensionless paths.

    A Next.js static export ships both `404.html` and `_not-found.html`.
    Starlette's StaticFiles, when ``html=True``, returns ``404.html`` with HTTP
    404 on a miss instead of raising HTTPException. This subclass intercepts
    both forms of "not found" and either falls back to ``index.html`` (for SPA
    routes like ``/login``) or lets the 404 stand (for ``/api/*`` and
    extensioned asset paths like ``/_next/static/missing.js``).
    """

    async def get_response(self, path: str, scope: Scope):
        response = None
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise

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

        return await super().get_response("index.html", scope)
