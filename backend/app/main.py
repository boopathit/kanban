from fastapi import FastAPI

from app.config import Settings, get_settings
from app.routes import health
from app.static import SPAStaticFiles


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Project Management MVP")

    app.include_router(health.router)

    settings.STATIC_DIR.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/",
        SPAStaticFiles(directory=str(settings.STATIC_DIR), html=True),
        name="static",
    )

    return app


app = create_app()
