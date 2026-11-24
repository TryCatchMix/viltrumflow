"""tcg card collection

Revision ID: 0014
Revises: 0013
"""
import sqlalchemy as sa
from alembic import op

revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'tcg_cards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('name_key', sa.String(length=120), nullable=False),
        sa.Column('number', sa.String(length=20), nullable=False),
        sa.Column('set_name', sa.String(length=80), nullable=False),
        sa.Column('rarity', sa.String(length=40), nullable=False),
        sa.Column('card_type', sa.String(length=40), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('wanted', sa.Boolean(), nullable=False),
        sa.Column('image_id', sa.String(length=32), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['image_id'], ['attachments.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'name_key', 'number', name='uq_tcg_card_user_name_number'),
    )
    op.create_index('ix_tcg_cards_user_id', 'tcg_cards', ['user_id'])
    op.create_table(
        'tcg_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('mode', sa.String(length=10), nullable=False),
        sa.Column('delta', sa.Integer(), nullable=False),
        sa.Column('created_card', sa.Boolean(), nullable=False),
        sa.Column('was_wanted', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['card_id'], ['tcg_cards.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tcg_events_user_id', 'tcg_events', ['user_id'])
    op.create_index('ix_tcg_events_card_id', 'tcg_events', ['card_id'])


def downgrade() -> None:
    op.drop_table('tcg_events')
    op.drop_table('tcg_cards')
