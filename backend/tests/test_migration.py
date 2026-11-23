import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_alembic_accepts_percent_encoded_database_url():
    # --sql 只渲染迁移，不连接数据库；仍会经过 env.py 的 URL 配置步骤，
    # 因此能捕获 ConfigParser 对 %40 等百分号编码的插值错误。
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "development",
            "DEV_AUTH_ENABLED": "true",
            "ALEMBIC_DATABASE_URL": (
                "mysql+pymysql://user:p%40ss@127.0.0.1:3306/shouke"
            ),
        }
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head", "--sql"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert "invalid interpolation syntax" not in result.stderr
    assert "CREATE TABLE stores" in result.stdout