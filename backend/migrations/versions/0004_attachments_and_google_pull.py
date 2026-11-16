"""attachments and google pull marker

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'attachments',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('note_id', sa.Integer(), nullable=True),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=50), nullable=False),
        sa.Column('size', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['note_id'], ['notes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_attachments_owner_id', 'attachments', ['owner_id'])
    op.create_index('ix_attachments_note_id', 'attachments', ['note_id'])
    op.add_column('google_accounts', sa.Column('last_pull_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('google_accounts', 'last_pull_at')
    op.drop_table('attachments')
