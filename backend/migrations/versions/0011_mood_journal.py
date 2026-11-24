"""mood and energy journal

Revision ID: 0011
Revises: 0010
"""
import sqlalchemy as sa
from alembic import op

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'mood_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('mood', sa.Integer(), nullable=False),
        sa.Column('energy', sa.Integer(), nullable=False),
        sa.Column('factors', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'day', name='uq_mood_user_day'),
    )
    op.create_index('ix_mood_entries_user_id', 'mood_entries', ['user_id'])


def downgrade() -> None:
    op.drop_table('mood_entries')
