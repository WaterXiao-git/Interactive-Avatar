from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8f3f4d75e5f1"
down_revision: Union[str, None] = "62da9e0b15c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_recordings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("model_id", sa.Integer(), nullable=True),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("file_url", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["model_id"], ["user_models.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["interaction_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_user_recordings_id"), "user_recordings", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_user_recordings_user_id"), "user_recordings", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_user_recordings_model_id"),
        "user_recordings",
        ["model_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_recordings_session_id"),
        "user_recordings",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_recordings_created_at"),
        "user_recordings",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_user_recordings_created_at"), table_name="user_recordings")
    op.drop_index(op.f("ix_user_recordings_session_id"), table_name="user_recordings")
    op.drop_index(op.f("ix_user_recordings_model_id"), table_name="user_recordings")
    op.drop_index(op.f("ix_user_recordings_user_id"), table_name="user_recordings")
    op.drop_index(op.f("ix_user_recordings_id"), table_name="user_recordings")
    op.drop_table("user_recordings")
