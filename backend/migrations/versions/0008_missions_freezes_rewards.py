"""weekly missions, streak freezes, coins and rewards

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('streak_freezes', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('freezes_checked_on', sa.Date(), nullable=True))
    op.create_table(
        'habit_freezes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('habit_id', sa.Integer(), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['habit_id'], ['habits.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('habit_id', 'day', name='uq_habit_freeze_day'),
    )
    op.create_index('ix_habit_freezes_habit_id', 'habit_freezes', ['habit_id'])
    op.create_table(
        'weekly_missions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column('key', sa.String(length=30), nullable=False),
        sa.Column('target', sa.Integer(), nullable=False),
        sa.Column('reward_xp', sa.Integer(), nullable=False),
        sa.Column('reward_coins', sa.Integer(), nullable=False),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'week_start', 'key', name='uq_mission_user_week_key'),
    )
    op.create_index('ix_weekly_missions_user_id', 'weekly_missions', ['user_id'])
    op.create_table(
        'coin_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=20), nullable=False),
        sa.Column('ref', sa.String(length=60), nullable=False),
        sa.Column('detail', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_coin_entries_user_id', 'coin_entries', ['user_id'])
    op.create_index('ix_coin_entries_created_at', 'coin_entries', ['created_at'])
    op.create_table(
        'rewards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=False),
        sa.Column('cost', sa.Integer(), nullable=False),
        sa.Column('emoji', sa.String(length=16), nullable=False),
        sa.Column('repeatable', sa.Boolean(), nullable=False),
        sa.Column('is_archived', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_rewards_user_id', 'rewards', ['user_id'])


def downgrade() -> None:
    op.drop_table('rewards')
    op.drop_table('coin_entries')
    op.drop_table('weekly_missions')
    op.drop_table('habit_freezes')
    op.drop_column('users', 'freezes_checked_on')
    op.drop_column('users', 'streak_freezes')
