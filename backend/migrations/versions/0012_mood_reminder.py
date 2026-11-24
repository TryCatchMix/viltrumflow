"""evening reminder for the mood journal

Revision ID: 0012
Revises: 0011
"""
import sqlalchemy as sa
from alembic import op

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('mood_reminder', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('mood_reminder_hour', sa.Integer(), nullable=False, server_default='21'))
    op.add_column('users', sa.Column('last_mood_reminded_on', sa.Date(), nullable=True))


def downgrade() -> None:
    for col in ('last_mood_reminded_on', 'mood_reminder_hour', 'mood_reminder'):
        op.execute(f'ALTER TABLE users DROP COLUMN {col}')
