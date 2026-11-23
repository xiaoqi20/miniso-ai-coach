#!/usr/bin/env bash
# 本地隔离的 MySQL 8.4 开发实例，默认 127.0.0.1:3307。
# 不修改系统 MySQL 服务，数据目录位于 backend/.mysql-data。
#
# 注意：部分 macOS + MySQL 8.4.8 组合在自定义 datadir 启动时会报
# "Can't create UNDO tablespace ... undo_001 already exists"。
# 这属于本机 MySQL 安装问题，不是迁移脚本问题；遇到时可用 README 中的
# Docker 启动方式验证同一套迁移。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MYSQLD="${MYSQLD:-/usr/local/mysql/bin/mysqld}"
MYSQL="${MYSQL:-/usr/local/mysql/bin/mysql}"
MYSQLADMIN="${MYSQLADMIN:-/usr/local/mysql/bin/mysqladmin}"
DATA_DIR="${MYSQL_DATA_DIR:-$ROOT/.mysql-data}"
INIT_LOG="${MYSQL_INIT_LOG:-$ROOT/.mysql-init.log}"
SOCKET="${MYSQL_SOCKET:-/tmp/shouke-mysql.sock}"
PORT="${MYSQL_PORT:-3307}"
DB_NAME="${MYSQL_DB:-shouke}"
DB_USER="${MYSQL_USER:-shouke}"
DB_PASSWORD="${MYSQL_PASSWORD:-shouke_dev}"

ping() {
  "$MYSQLADMIN" --socket="$SOCKET" -uroot ping >/dev/null 2>&1
}

start_server() {
  if ping; then
    echo "MySQL 已在 $SOCKET 运行"
    return
  fi
  if [ ! -d "$DATA_DIR/mysql" ]; then
    echo "数据目录尚未初始化，请先运行: $0 init" >&2
    exit 1
  fi
  # 使用 --no-defaults，避免系统 my.cnf 把 datadir/undo 目录指到别的实例。
  nohup "$MYSQLD" \
    --no-defaults \
    --basedir=/usr/local/mysql \
    --datadir="$DATA_DIR" \
    --port="$PORT" \
    --socket="$SOCKET" \
    --bind-address=127.0.0.1 \
    --pid-file="$DATA_DIR/mysqld.pid" \
    --log-error="$DATA_DIR/mysqld.log" \
    --character-set-server=utf8mb4 \
    --collation-server=utf8mb4_0900_ai_ci \
    --default-time-zone=+00:00 \
    >/dev/null 2>&1 &
  for _ in $(seq 1 60); do
    if ping; then
      echo "MySQL 已启动: 127.0.0.1:$PORT (socket $SOCKET)"
      return
    fi
    sleep 0.5
  done
  echo "MySQL 启动失败，请查看 $DATA_DIR/mysqld.log" >&2
  exit 1
}

init_db() {
  if [ ! -d "$DATA_DIR/mysql" ]; then
    mkdir -p "$DATA_DIR"
    # 初始化与启动必须使用同一组 --no-defaults/--datadir 参数。
    "$MYSQLD" \
      --no-defaults \
      --initialize-insecure \
      --basedir=/usr/local/mysql \
      --datadir="$DATA_DIR" \
      --log-error="$INIT_LOG"
    echo "已初始化数据目录: $DATA_DIR"
  fi
  start_server
  # 只授予 dev 库所需的 DML/DDL 权限，不授予全局权限。
  # 生产环境应使用独立的迁移账号和运行时账号。
  "$MYSQL" --socket="$SOCKET" -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
  echo "已准备数据库 $DB_NAME 与用户 $DB_USER"
}

case "${1:-}" in
  init)
    init_db
    ;;
  start)
    start_server
    ;;
  stop)
    "$MYSQLADMIN" --socket="$SOCKET" -uroot shutdown
    echo "MySQL 已停止"
    ;;
  status)
    if ping; then
      echo "running: 127.0.0.1:$PORT"
    else
      echo "stopped"
      exit 1
    fi
    ;;
  url)
    echo "DATABASE_URL=mysql+aiomysql://$DB_USER:$DB_PASSWORD@127.0.0.1:$PORT/$DB_NAME?charset=utf8mb4"
    echo "ALEMBIC_DATABASE_URL=mysql+pymysql://$DB_USER:$DB_PASSWORD@127.0.0.1:$PORT/$DB_NAME?charset=utf8mb4"
    ;;
  *)
    echo "用法: $0 {init|start|stop|status|url}" >&2
    exit 1
    ;;
esac