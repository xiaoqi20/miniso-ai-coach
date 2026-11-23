"""add roleplay scoring lease

Revision ID: 9d3f2a7c1b45
Revises: 0c76def51a04
Create Date: 2026-11-23 20:10:00.000000

评分进程在写入轮次后、写入成绩前退出时，轮次会停在 scoring。
该列记录本轮最后一次评分认领时间，租约过期后允许同一 client_round_id
重新认领；历史行保持 NULL，由应用回退到 submitted_at 计算租约。
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision: str = "9d3f2a7c1b45"
down_revision: Union[str, Sequence[str], None] = "0c76def51a04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "roleplay_rounds",
        sa.Column("scoring_started_at", mysql.DATETIME(fsp=3), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("roleplay_rounds", "scoring_started_at")