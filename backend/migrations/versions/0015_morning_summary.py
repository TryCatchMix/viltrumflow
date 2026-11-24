"""morning summary notification

Revision ID: 0015
Revises: 0014
"""
import sqlalchemy as sa
from alembic import op

revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('morning_summary', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('morning_summary_hour', sa.Integer(), nullable=False, server_default='8'))
    op.add_column('users', sa.Column('last_morning_summary_on', sa.Date(), nullable=True))


def downgrade() -> None:
    for col in ('last_morning_summary_on', 'morning_summary_hour', 'morning_summary'):
        op.execute(f'ALTER TABLE users DROP COLUMN {col}')
