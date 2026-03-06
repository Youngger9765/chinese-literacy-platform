import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routes import stories, learning, users, auth, classrooms, schools, organizations, roles

logger = logging.getLogger(__name__)

app = FastAPI(
    title="LingoLeap AI Reading Tutor API",
    description="Backend API for the LingoLeap AI Reading Tutor platform",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stories.router, prefix="/api")
app.include_router(learning.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(classrooms.router, prefix="/api")
app.include_router(schools.router, prefix="/api")
app.include_router(organizations.router, prefix="/api")
app.include_router(roles.router, prefix="/api")


@app.on_event("startup")
def seed_default_data():
    """Insert default school if the schools table is empty.

    Wrapped in try/except so it doesn't crash during tests where the
    production database is not available.
    """
    from .database import SessionLocal
    from .models.school import School
    try:
        db = SessionLocal()
        try:
            if db.query(School).count() == 0:
                db.add(School(name="預設學校", is_active=True))
                db.commit()
                logger.info("Seeded default school: 預設學校")
        finally:
            db.close()
    except Exception:
        logger.debug("Skipping seed_default_data (DB not available)")


@app.get("/")
def root():
    return {"status": "ok", "service": "lingoleap-api"}
