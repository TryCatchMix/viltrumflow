"""initial schema

Revision ID: 0001
Revises: 
"""
import sqlalchemy as sa
from alembic import op


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('username', sa.String(length=50), nullable=False),
    sa.Column('full_name', sa.String(length=100), nullable=True),
    sa.Column('hashed_password', sa.String(length=255), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('avatar_url', sa.String(length=500), nullable=True),
    sa.Column('bio', sa.Text(), nullable=True),
    sa.Column('last_login', sa.DateTime(timezone=True), nullable=True),
    sa.Column('theme', sa.String(length=10), nullable=False),
    sa.Column('language', sa.String(length=5), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)
        batch_op.create_index(batch_op.f('ix_users_username'), ['username'], unique=True)

    op.create_table('google_accounts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('access_token_enc', sa.Text(), nullable=False),
    sa.Column('refresh_token_enc', sa.Text(), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('calendar_id', sa.String(length=255), nullable=False),
    sa.Column('auto_sync', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('notes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('folder', sa.String(length=300), nullable=False),
    sa.Column('tags', sa.String(length=1000), nullable=False),
    sa.Column('is_pinned', sa.Boolean(), nullable=False),
    sa.Column('is_daily', sa.Boolean(), nullable=False),
    sa.Column('owner_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('owner_id', 'title', name='uq_note_owner_title')
    )
    with op.batch_alter_table('notes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_notes_owner_id'), ['owner_id'], unique=False)

    op.create_table('projects',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('color', sa.String(length=7), nullable=False),
    sa.Column('is_archived', sa.Boolean(), nullable=False),
    sa.Column('owner_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_projects_owner_id'), ['owner_id'], unique=False)

    op.create_table('note_links',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('source_id', sa.Integer(), nullable=False),
    sa.Column('target_id', sa.Integer(), nullable=True),
    sa.Column('target_title', sa.String(length=200), nullable=False),
    sa.ForeignKeyConstraint(['source_id'], ['notes.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['target_id'], ['notes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('note_links', schema=None) as batch_op:
        batch_op.create_index('idx_notelink_target_title', ['target_title'], unique=False)
        batch_op.create_index(batch_op.f('ix_note_links_source_id'), ['source_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_note_links_target_id'), ['target_id'], unique=False)

    op.create_table('tasks',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.Enum('todo', 'in_progress', 'review', 'completed', 'archived', name='status', native_enum=False, length=20), nullable=False),
    sa.Column('priority', sa.Enum('low', 'medium', 'high', 'urgent', name='priority', native_enum=False, length=20), nullable=False),
    sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('all_day', sa.Boolean(), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('estimated_hours', sa.Integer(), nullable=True),
    sa.Column('tags', sa.String(length=500), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('google_event_id', sa.String(length=255), nullable=True),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=True),
    sa.Column('parent_task_id', sa.Integer(), nullable=True),
    sa.Column('note_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['note_id'], ['notes.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_task_id'], ['tasks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tasks_due_date'), ['due_date'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_parent_task_id'), ['parent_task_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_user_id'), ['user_id'], unique=False)

    op.create_table('comments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('author_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('comments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_comments_task_id'), ['task_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('comments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_comments_task_id'))

    op.drop_table('comments')
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tasks_user_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_status'))
        batch_op.drop_index(batch_op.f('ix_tasks_project_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_parent_task_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_due_date'))

    op.drop_table('tasks')
    with op.batch_alter_table('note_links', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_note_links_target_id'))
        batch_op.drop_index(batch_op.f('ix_note_links_source_id'))
        batch_op.drop_index('idx_notelink_target_title')

    op.drop_table('note_links')
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_projects_owner_id'))

    op.drop_table('projects')
    with op.batch_alter_table('notes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_notes_owner_id'))

    op.drop_table('notes')
    op.drop_table('google_accounts')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_username'))
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
