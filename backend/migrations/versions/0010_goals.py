"""long-term goals with milestones and links

Revision ID: 0010
Revises: 0009
"""
import sqlalchemy as sa
from alembic import op

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'goals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(length=7), nullable=False),
        sa.Column('deadline', sa.Date(), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_goals_user_id', 'goals', ['user_id'])
    op.create_table(
        'goal_milestones',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('goal_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('done', sa.Boolean(), nullable=False),
        sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['goal_id'], ['goals.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_goal_milestones_goal_id', 'goal_milestones', ['goal_id'])
    op.create_table(
        'goal_links',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('goal_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('ref_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['goal_id'], ['goals.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('goal_id', 'kind', 'ref_id', name='uq_goal_link'),
    )
    op.create_index('ix_goal_links_goal_id', 'goal_links', ['goal_id'])


def downgrade() -> None:
    op.drop_table('goal_links')
    op.drop_table('goal_milestones')
    op.drop_table('goals')
