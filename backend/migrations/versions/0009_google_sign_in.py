"""sign in with Google

Revision ID: 0009
Revises: 0008
"""
import sqlalchemy as sa
from alembic import op

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Identificador estable de la cuenta de Google (claim «sub»); el email de Google puede cambiar
    op.add_column('users', sa.Column('google_sub', sa.String(length=255), nullable=True))
    op.create_index('ix_users_google_sub', 'users', ['google_sub'], unique=True)
    # Falso en cuentas creadas con Google que aún no han elegido contraseña
    op.add_column('users', sa.Column('password_set', sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    op.drop_index('ix_users_google_sub', table_name='users')
    op.execute('ALTER TABLE users DROP COLUMN password_set')
    op.execute('ALTER TABLE users DROP COLUMN google_sub')
