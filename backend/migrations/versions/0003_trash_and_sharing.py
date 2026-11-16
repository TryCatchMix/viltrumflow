"""trash and project sharing

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'project_members',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=10), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'user_id', name='uq_project_member'),
    )
    op.create_index('ix_project_members_project_id', 'project_members', ['project_id'])
    op.create_index('ix_project_members_user_id', 'project_members', ['user_id'])

    op.add_column('notes', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_notes_deleted_at', 'notes', ['deleted_at'])
    op.add_column('tasks', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_tasks_deleted_at', 'tasks', ['deleted_at'])
    op.add_column('tasks', sa.Column('assigned_notified_at', sa.DateTime(timezone=True), nullable=True))
    # SQL directo: la clave foránea va en la propia columna, que es la única forma que admite SQLite
    # (y evita el modo batch, que recrearía la tabla; ver migrations/env.py)
    op.execute('ALTER TABLE tasks ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL')
    op.create_index('ix_tasks_assignee_id', 'tasks', ['assignee_id'])


def downgrade() -> None:
    op.drop_index('ix_tasks_assignee_id', 'tasks')
    op.drop_column('tasks', 'assignee_id')
    op.drop_column('tasks', 'assigned_notified_at')
    op.drop_index('ix_tasks_deleted_at', 'tasks')
    op.drop_column('tasks', 'deleted_at')
    op.drop_index('ix_notes_deleted_at', 'notes')
    op.drop_column('notes', 'deleted_at')
    op.drop_table('project_members')
