"""habits, experience and pomodoro

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'habits',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('days', sa.String(length=7), nullable=False),
        sa.Column('target_time', sa.String(length=5), nullable=True),
        sa.Column('difficulty', sa.Integer(), nullable=False),
        sa.Column('color', sa.String(length=7), nullable=False),
        sa.Column('is_archived', sa.Boolean(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('start_day', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_habits_user_id', 'habits', ['user_id'])
    op.create_table(
        'habit_checks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('habit_id', sa.Integer(), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['habit_id'], ['habits.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('habit_id', 'day', name='uq_habit_day'),
    )
    op.create_index('ix_habit_checks_habit_id', 'habit_checks', ['habit_id'])
    op.create_index('ix_habit_checks_day', 'habit_checks', ['day'])
    op.create_table(
        'xp_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('ref', sa.String(length=60), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('detail', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('kind', 'ref', name='uq_xp_kind_ref'),
    )
    op.create_index('ix_xp_events_user_id', 'xp_events', ['user_id'])
    op.create_index('ix_xp_events_created_at', 'xp_events', ['created_at'])
    op.create_table(
        'pomodoro_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=True),
        sa.Column('seconds', sa.Integer(), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_pomodoro_sessions_user_id', 'pomodoro_sessions', ['user_id'])
    op.create_index('ix_pomodoro_sessions_ended_at', 'pomodoro_sessions', ['ended_at'])
    op.add_column('tasks', sa.Column('difficulty', sa.Integer(), nullable=False, server_default='2'))
    op.add_column('users', sa.Column('pomodoro', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'pomodoro')
    op.drop_column('tasks', 'difficulty')
    op.drop_table('pomodoro_sessions')
    op.drop_table('xp_events')
    op.drop_table('habit_checks')
    op.drop_table('habits')
