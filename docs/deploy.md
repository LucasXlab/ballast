# 部署

Ballast 是单机服务，默认只允许本机访问。不要把它直接暴露到公网。

## Docker Compose（推荐）

```bash
docker compose up -d --build
# 打开 http://127.0.0.1:8787
```

- 端口映射固定为 `127.0.0.1:8787:8787`，局域网不能访问。
- 数据在 named volume `ballast-data`，容器重建不丢。
- 容器内设置 `BALLAST_HOST=0.0.0.0`、`BALLAST_DOCKER=1`；裸机不要设置这两个值。
- 升级：`docker compose build --pull && docker compose up -d`。
- 备份：设置页下载，或 `docker run --rm -v ballast-data:/data -v "$PWD":/out alpine cp /data/ballast.sqlite /out/ballast-backup.sqlite`。
- 恢复：停止容器，把备份写回 volume 的 `ballast.sqlite`，再启动。

## 裸机

```bash
npm ci
npm run build
BALLAST_DATA_DIR=/var/lib/ballast BALLAST_PORT=8787 npm start
```

用 systemd 或 launchd 托管；只绑定 `127.0.0.1`。如果必须远程访问，用 SSH 隧道，不要把端口开到 `0.0.0.0`，也不要在前面加公网反向代理。

## 目录与权限

- 数据目录 0700；`ballast.sqlite` 和备份 0600。
- 迁移前自动备份，保留最近 `BALLAST_BACKUP_KEEP`（默认 7）个。
- 不要手工编辑 SQLite；需要迁移时先备份。

## 环境变量

见 `.env.example`。服务不自动读取 `.env`；Docker Compose 用 `environment`，裸机用 shell 或进程管理器。
