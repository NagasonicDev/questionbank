"""
Database engine + session management.

Local-first by design: a single SQLite file under /data/db. WAL mode is
enabled for better concurrent read/write behaviour when the frontend dev
server and backend are both hitting it locally.
"""
import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATA_DIR = Path(os.environ.get("QB_DATA_DIR", Path(__file__).resolve().parents[2] / "data"))
DB_DIR = DATA_DIR / "db"
ASSETS_DIR = DATA_DIR / "assets"
DB_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DB_DIR / "questionbank.sqlite"
DATABASE_URL = f"sqlite:///{DB_PATH}"

UPLOADS_DIR = ASSETS_DIR / "_uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

EXPORTS_DIR = DATA_DIR / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
