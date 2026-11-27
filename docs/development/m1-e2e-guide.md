# M1 本地三角色闭环联调与验收指南

本文档用于复现 M1（总部 PC + 店长 H5 + 员工 H5 + FastAPI + MySQL 8.4）本地端到端联调与全部实库自动化验收套件。

## 1. 启动临时 MySQL 8.4 实例

```bash
docker run -d --name shouke-mysql-t008 \
  -e MYSQL_ROOT_PASSWORD=root_dev \
  -e MYSQL_DATABASE=shouke \
  -e MYSQL_USER=shouke \
  -e MYSQL_PASSWORD=shouke_dev \
  -p 127.0.0.1:13308:3306 \
  mysql:8.4
```

等待数据库就绪后，设置连接环境变量并完成空库迁移、检查与幂等播种：

```bash
cd backend
export DATABASE_URL="mysql+aiomysql://shouke:shouke_dev@127.0.0.1:13308/shouke?charset=utf8mb4"
export ALEMBIC_DATABASE_URL="mysql+pymysql://shouke:shouke_dev@127.0.0.1:13308/shouke?charset=utf8mb4"

uv run alembic upgrade head
uv run alembic check
uv run alembic downgrade base
uv run alembic upgrade head
uv run python -m app.seed
```

## 2. 运行 MySQL 8.4 实库验收套件

T003、T005、T008 的 MySQL 实库测试均会从空发布库起步，**运行每套前请先重建干净的 `shouke` 库并重新迁移播种**：

```bash
# 重建空库与种子（每次运行实库用例前执行）
docker exec shouke-mysql-t008 mysql -uroot -proot_dev -e \
  "DROP DATABASE IF EXISTS shouke; CREATE DATABASE shouke CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
cd backend
uv run alembic upgrade head && uv run python -m app.seed

# 1) T003 课程并发发布与幂等重放回归
SHOUKE_TEST_MYSQL_URL="$DATABASE_URL" uv run pytest -v -rA tests/test_course_publish_mysql.py

# 2) 重建后运行 T005 店长首次补训并发回归
SHOUKE_TEST_MYSQL_URL="$DATABASE_URL" uv run pytest -v -rA tests/test_manager_mysql.py

# 3) 重建后运行 T008 M1 三角色跨模块全流程端到端回归
SHOUKE_TEST_MYSQL_URL="$DATABASE_URL" uv run pytest -v -rA tests/test_m1_e2e_mysql.py
```

默认 SQLite 单元/接口回归（自动跳过需要外部 MySQL 库的 3 个实库测试）：

```bash
cd backend
uv run python -m compileall -q app tests alembic
uv run pytest -ra
```

## 3. 启动真实全栈服务（Vue Real API + FastAPI + MySQL 8.4）

先按第 2 节重建干净空库并播种，然后分别启动后端和前端：

### 后端（监听 `127.0.0.1:8000`）

```bash
cd backend
APP_ENV=development \
DEV_AUTH_ENABLED=true \
APP_ORIGINS="http://localhost:5173,http://127.0.0.1:5173" \
DATABASE_URL="mysql+aiomysql://shouke:shouke_dev@127.0.0.1:13308/shouke?charset=utf8mb4" \
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 前端（监听 `http://localhost:5173`，代理 `/api` 至 `127.0.0.1:8000`）

```bash
cd frontend
npm install
npm run dev:real
```

### 试点开发身份账号

| 角色 | 姓名 | `user_id` | 所属门店 | 入口路径 |
| --- | --- | --- | --- | --- |
| 总部运营 | 林敏 | `usr_linmin` | 总部 | `/hq` |
| 店长 | 李明 | `usr_liming` | 北京路旗舰店 (`store_bj`) | `/manager` |
| 店长 | 张涛 | `usr_zhangtao` | 北京路旗舰店 (`store_bj`) | `/manager` |
| 门店 A 员工 | 林小美 | `usr_linxiaomei` | 北京路旗舰店 (`store_bj`) | `/staff` |
| 门店 A 员工 | 陈阿杰 | `usr_chenajie` | 北京路旗舰店 (`store_bj`) | `/staff` |
| 门店 B 员工 | 周琳 | `usr_zhoulin` | 佛山祖庙百货店 (`store_fs`) | `/staff` |

## 4. 清理临时容器

```bash
docker rm -f shouke-mysql-t008
```
