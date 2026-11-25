from pathlib import Path
from sqlmodel import SQLModel, create_engine, Session, text
from app.config import DATABASE_URL

# Ensure parent directory exists for SQLite file paths
if DATABASE_URL.startswith("sqlite:///"):
    db_file = DATABASE_URL.replace("sqlite:///", "", 1)
    if db_file and db_file != ":memory:":
        Path(db_file).parent.mkdir(parents=True, exist_ok=True)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def create_db_and_tables() -> None:
    if DATABASE_URL.startswith("sqlite"):
        with engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL;"))
            conn.execute(text("PRAGMA foreign_keys=ON;"))
            conn.commit()
    SQLModel.metadata.create_all(engine)
    if DATABASE_URL.startswith("sqlite"):
        with engine.connect() as conn:
            migrations = [
                ("application", "token_encrypted", "TEXT NOT NULL DEFAULT ''"),
                ("appphonecontact", "active_start_est", "TEXT NOT NULL DEFAULT ''"),
                ("appphonecontact", "active_end_est", "TEXT NOT NULL DEFAULT ''"),
                ("urlmonitor", "expected_body_mode", "TEXT NOT NULL DEFAULT 'contains'"),
                ("urlmonitor", "max_latency_ms", "INTEGER NOT NULL DEFAULT 0"),
            ]
            for table, col, definition in migrations:
                cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
                if cols and col not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {definition}"))
            conn.commit()


def get_session():
    with Session(engine) as session:
        yield session
