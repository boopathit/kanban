from fastapi import FastAPI

from app.config import Settings, get_settings
from app.db import init_db, make_engine, make_session_factory
from app.routes import auth, board, health
from app.static import SPAStaticFiles


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Project Management MVP")

    # Pin the active Settings instance so deps that resolve it (e.g. auth) see
    # the same one the app was built with — important for tests that inject a
    # custom Settings via create_app(settings).
    app.dependency_overrides[get_settings] = lambda: settings

    # Build the engine once per app and seed the demo data eagerly so the
    # very first request hits a populated database.
    engine = make_engine(settings)
    init_db(engine)
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(board.router)

    settings.STATIC_DIR.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/",
        SPAStaticFiles(directory=str(settings.STATIC_DIR), html=True),
        name="static",
    )

    return app


app = create_app()
