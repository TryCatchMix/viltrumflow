from alembic import context

from app import models  # noqa: F401  (registra las tablas en Base.metadata)
from app.database import Base, engine

target_metadata = Base.metadata


def run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Sin render_as_batch: en SQLite recrearía tablas y el borrado en cascada eliminaría datos.
        # Añadir o quitar columnas funciona con ALTER nativo; para cambios mayores, revisa la migración a mano.
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# La app (init_db) pasa su propia conexión; desde la línea de comandos se abre una nueva.
connection = context.config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    with engine.connect() as conn:
        run(conn)
        conn.commit()
