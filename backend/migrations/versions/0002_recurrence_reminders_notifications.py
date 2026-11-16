"""recurrence reminders notifications

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ADD COLUMN directo, sin modo «batch»: en SQLite el batch recrea la tabla y, con las claves
    # foráneas activas, borrar «users» arrastraría en cascada todas sus tareas y notas.
    # server_default: las filas existentes reciben un valor en las columnas NOT NULL.
    op.add_column('tasks', sa.Column('recurrence', sa.String(length=20), nullable=False, server_default='none'))
    op.add_column('tasks', sa.Column('recurred', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('tasks', sa.Column('reminder_minutes', sa.Integer(), nullable=True))
    op.add_column('tasks', sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tasks', sa.Column('reminder_emailed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('timezone', sa.String(length=64), nullable=False, server_default='UTC'))
    op.add_column('users', sa.Column('email_reminders', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('daily_digest', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('digest_hour', sa.Integer(), nullable=False, server_default='8'))
    op.add_column('users', sa.Column('last_digest_on', sa.Date(), nullable=True))


def downgrade() -> None:
    for col in ('last_digest_on', 'digest_hour', 'daily_digest', 'email_reminders', 'timezone'):
        op.drop_column('users', col)
    for col in ('reminder_emailed_at', 'reminder_sent_at', 'reminder_minutes', 'recurred', 'recurrence'):
        op.drop_column('tasks', col)
