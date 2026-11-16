from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app.database import Base, engine, init_db


def _reset():
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))


def test_migrations_match_models(client):
    """Tras `upgrade head` no debe quedar ninguna diferencia con los modelos (migración olvidada)."""
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
        if conn.dialect.name == "sqlite":
            # tasks.assignee_id se añadió con REFERENCES en la propia columna (única forma en SQLite) y la
            # reflexión de SQLAlchemy no lee su ON DELETE: se descarta ese falso positivo y se comprueba con PRAGMA.
            diff = [d for d in diff if not (d[0] in ("add_fk", "remove_fk") and [c.name for c in d[1].columns] == ["assignee_id"])]
            rules = {r[3]: r[6] for r in conn.execute(text("PRAGMA foreign_key_list('tasks')"))}
            assert rules["assignee_id"] == "SET NULL"
    assert diff == []


def test_upgrade_keeps_existing_rows():
    """Una base en la versión 2.0 (línea base) se actualiza sin perder datos y con valores por defecto."""
    _reset()
    cfg = Config("alembic.ini")
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "0001")
        conn.execute(text(
            "INSERT INTO users (id, email, username, hashed_password, is_active, theme, language, created_at, updated_at) "
            "VALUES (1, 'a@example.com', 'ana', 'x', true, 'auto', 'es', '2026-01-01', '2026-01-01')"))
        conn.execute(text(
            "INSERT INTO tasks (id, title, status, priority, all_day, tags, position, user_id, created_at, updated_at) "
            "VALUES (1, 'Antigua', 'todo', 'medium', true, '', 0, 1, '2026-01-01', '2026-01-01')"))
    init_db()
    with engine.connect() as conn:
        assert conn.execute(text("SELECT recurrence, recurred, reminder_minutes FROM tasks")).one() == ("none", False, None)
        assert conn.execute(text("SELECT timezone, digest_hour, daily_digest FROM users")).one() == ("UTC", 8, False)


def test_legacy_database_without_version_table_is_stamped():
    """Bases creadas con create_all antes de las migraciones: se marcan como línea base y se actualizan."""
    _reset()
    cfg = Config("alembic.ini")
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "0001")
        conn.execute(text("DROP TABLE alembic_version"))
    init_db()
    with engine.connect() as conn:
        assert "recurrence" in {c["name"] for c in inspect(conn).get_columns("tasks")}
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0003"
