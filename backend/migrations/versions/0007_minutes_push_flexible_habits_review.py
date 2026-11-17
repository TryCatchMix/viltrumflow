"""estimate in minutes, web push, flexible habits, weekly review

Revision ID: 0007
Revises: 0006
"""
import sqlalchemy as sa
from alembic import op

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Estimación: de horas enteras a minutos (las tareas de menos de una hora no se podían estimar)
    op.add_column('tasks', sa.Column('estimated_minutes', sa.Integer(), nullable=True))
    op.execute('UPDATE tasks SET estimated_minutes = estimated_hours * 60 WHERE estimated_hours IS NOT NULL')
    op.execute('ALTER TABLE tasks DROP COLUMN estimated_hours')  # SQL directo: sin modo batch (ver env.py)

    op.add_column('habits', sa.Column('target_count', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('habits', sa.Column('unit', sa.String(length=20), nullable=False, server_default=''))
    op.add_column('habits', sa.Column('weekly_target', sa.Integer(), nullable=True))
    op.add_column('habits', sa.Column('remind', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('habits', sa.Column('last_reminded_on', sa.Date(), nullable=True))
    op.add_column('habit_checks', sa.Column('count', sa.Integer(), nullable=False, server_default='1'))

    op.add_column('users', sa.Column('pomodoro_ends_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('pomodoro_phase', sa.String(length=10), nullable=True))
    op.create_index('ix_users_pomodoro_ends_at', 'users', ['pomodoro_ends_at'])

    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('endpoint', sa.String(length=1000), nullable=False),
        sa.Column('p256dh', sa.String(length=200), nullable=False),
        sa.Column('auth', sa.String(length=100), nullable=False),
        sa.Column('user_agent', sa.String(length=300), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('endpoint'),
    )
    op.create_index('ix_push_subscriptions_user_id', 'push_subscriptions', ['user_id'])
    op.create_table(
        'server_keys',
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('name'),
    )
    op.create_table(
        'weekly_reviews',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column('goals', sa.Text(), nullable=False),
        sa.Column('reflection', sa.Text(), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'week_start', name='uq_review_user_week'),
    )
    op.create_index('ix_weekly_reviews_user_id', 'weekly_reviews', ['user_id'])


def downgrade() -> None:
    op.drop_table('weekly_reviews')
    op.drop_table('server_keys')
    op.drop_table('push_subscriptions')
    op.drop_index('ix_users_pomodoro_ends_at', 'users')
    op.drop_column('users', 'pomodoro_phase')
    op.drop_column('users', 'pomodoro_ends_at')
    op.drop_column('habit_checks', 'count')
    for col in ('last_reminded_on', 'remind', 'weekly_target', 'unit', 'target_count'):
        op.drop_column('habits', col)
    op.add_column('tasks', sa.Column('estimated_hours', sa.Integer(), nullable=True))
    op.execute('UPDATE tasks SET estimated_hours = (estimated_minutes + 59) / 60 WHERE estimated_minutes IS NOT NULL')
    op.execute('ALTER TABLE tasks DROP COLUMN estimated_minutes')
