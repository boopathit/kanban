from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


class SPAStaticFiles(StaticFiles):
    """StaticFiles that falls back to index.html for unknown extensionless paths.

    This lets a Next.js static export power client-side routing: a request for
    /some-route that has no matching file is served the SPA shell so the
    in-browser router can take over. Requests for missing files with an
    extension (e.g. /missing.js) still 404, and /api/* is never touched here
    because the API routers are registered before this mount.
    """

    async def get_response(self, path: str, scope: Scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            normalized = path.replace("\\", "/")
            if normalized == "api" or normalized.startswith("api/"):
                raise
            last_segment = normalized.rsplit("/", 1)[-1]
            if "." in last_segment:
                raise
            return await super().get_response("index.html", scope)
