<p align="center">
  <img src="Frontend/public/white.png" alt="Nextbase" height="60" />
</p>

<p align="center">
  <strong>Self-hosted PostgreSQL database management — built for developers who own their infrastructure.</strong>
</p>

<p align="center">
  <a href="#-features">Features</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-configuration">Configuration</a> ·
  <a href="#-usage-guide">Usage Guide</a> ·
  <a href="#-reset-password">Reset Password</a>
</p>

---

## What is Nextbase?

**Nextbase** is a full-stack, self-hosted PostgreSQL management tool you deploy on your own server. Think of it as a lightweight, privacy-first alternative to Supabase Studio or pgAdmin — running entirely inside Docker on your VPS with no cloud dependency, no data leaving your server, and no subscription fees.

You get a modern web UI to manage your database, browse and edit tables, write SQL, visualize your schema, take backups, and control database access — all from a browser.

---

## Features

| Feature | Description |
|---|---|
| **Dashboard** | Real-time database stats — size, connections, uptime, table count |
| **Table Editor** | Create tables, insert/edit/delete rows with an inline grid |
| **SQL Editor** | Full SQL query editor with syntax highlighting and result pane |
| **Schema Visualizer** | Interactive diagram of all tables with FK relationship lines |
| **Statistics & Charts** | Query performance, connection trends, and database activity graphs |
| **Backup & Restore** | One-click `pg_dump` backups and `pg_restore` — stored on your server |
| **Pause / Resume** | Suspend all external connections (stops pgBouncer + locks DB) |
| **Expose Public** | HAProxy TCP proxy — toggle public access to Postgres on port 5432/6543 |
| **Forgot Password** | Step-by-step SSH reset guide built into the UI |
| **Theme Support** | Dark and light mode with theme-aware logo |
| **Connection Pooling** | pgBouncer sits in front of Postgres for production-grade pooling |

---

## Prerequisites

Before you begin, make sure the following are installed on your server:

- **Docker** ≥ 24 — [Install Docker](https://docs.docker.com/engine/install/)
- **Docker Compose** ≥ 2 (ships with Docker Desktop, or install the plugin)
- **Git**
- An open firewall for port **3000** (web UI) and optionally **5432** / **6543** (database)

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/rehanweb3/Nextbase.git nextbase
cd nextbase
```

### 2. Create your `.env` file

Copy the example and fill in your credentials:

```bash
cp .env.example .env
nano .env
```

```env
# PostgreSQL database
DB_NAME=mydb
DB_USERNAME=myuser
DB_PASSWORD=StrongPassword123!

# Nextbase admin login (web UI)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=SecureAdminPass!

# JWT secret — generate a long random string
JWT_SECRET=replace_with_a_64_char_random_string
```

> **Never commit `.env` to Git.** It is already in `.gitignore`.

### 3. Start everything

```bash
docker compose -f postgres.yml up -d --build
```

Docker Compose will:
- Build and start **PostgreSQL**
- Build and start **pgBouncer** (connection pooler)
- Build and start the **Nextbase backend** (API server)
- Build and start the **Nextbase frontend** (web UI)

### 4. Open the web UI

```
http://your-server-ip:3000
```

Log in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` you set in `.env`.

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │                  Your Server                  │
                    │                                               │
  Browser ─────────►  :3000  Nextbase Frontend  (React / Vite)    │
                    │            │                                  │
                    │            ▼                                  │
                    │  :3001  Nextbase Backend  (Node / Express)   │
                    │            │                                  │
                    │     ┌──────┴──────┐                          │
                    │     ▼             ▼                          │
                    │  :16543        :15432                         │
                    │  pgBouncer     Postgres                       │
                    │  (pooler)      (direct)                       │
                    │                                               │
                    │  [optional]  HAProxy TCP proxy                │
                    │  :5432  ──► Postgres (public)                 │
                    │  :6543  ──► pgBouncer (public)               │
                    └──────────────────────────────────────────────┘
```

| Service | Container | Internal Port | Purpose |
|---|---|---|---|
| Frontend | `dbofather-client` | 3000 | React web UI |
| Backend | `dbofather-server` | 3001 | REST API |
| pgBouncer | `dbofather-pooler` | 16543 | Connection pooler |
| PostgreSQL | `dbofather-db` | 15432 | Database |
| HAProxy | `dbofather-proxy` | 5432 / 6543 | Public TCP proxy (optional) |

---

## Configuration

All configuration lives in **`.env`** in the project root. Docker Compose reads it automatically.

| Variable | Description | Example |
|---|---|---|
| `DB_NAME` | PostgreSQL database name | `mydb` |
| `DB_USERNAME` | PostgreSQL user | `myuser` |
| `DB_PASSWORD` | PostgreSQL password | `StrongPass!` |
| `ADMIN_USERNAME` | Nextbase web UI username | `admin` |
| `ADMIN_PASSWORD` | Nextbase web UI password | `SecurePass!` |
| `JWT_SECRET` | Secret for signing login tokens | 64-char random string |

### Generating a strong JWT secret

```bash
openssl rand -hex 32
```

---

## Usage Guide

### Dashboard

The dashboard shows a live overview of your PostgreSQL instance:
- Database size, number of tables, active connections
- Server uptime and PostgreSQL version
- Recent query activity

### Table Editor

Browse all tables in your database. Select a table to:
- View and scroll through all rows
- **Insert** a new row with an auto-detect form (identity columns and UUIDs are filled automatically)
- **Edit** any cell inline
- **Delete** rows
- **Create** new tables with a column builder (supports all PostgreSQL types, PRIMARY KEY, DEFAULT, NOT NULL)

### SQL Editor

Write and execute raw SQL queries:
- Syntax-highlighted editor
- Results shown in a scrollable grid
- Error messages with line numbers

### Schema Visualizer

An interactive diagram of your entire database schema:
- Each table is a card showing column names, types, and PK/FK badges
- Foreign key relationships are drawn as animated lines with column labels (e.g. `order_id → id`)
- Drag tables to rearrange, zoom and pan freely
- Search box to highlight a specific table

### Statistics

Charts showing database activity over time:
- Active connections graph
- Query throughput
- Cache hit ratio
- Table sizes

### Backup & Restore

- **Create Backup** — runs `pg_dump` inside the container and stores the file in `./backups/`
- **Download** — download any backup file to your local machine
- **Restore** — upload a `.sql` or `.dump` file and run `pg_restore` / `psql`

Backups are plain SQL files and work with any standard PostgreSQL restore tool.

### Pause & Resume Database

**Pause** disconnects all external clients:
1. Sets `ALLOW_CONNECTIONS false` on the database
2. Stops the pgBouncer container so its pool cannot serve clients
3. Terminates any remaining direct connections

**Resume** restores access:
1. Sets `ALLOW_CONNECTIONS true`
2. Restarts pgBouncer

Nextbase's own backend pool stays connected during pause so the UI keeps working.

### Expose Public (HAProxy)

Click **Expose Public** on the dashboard to start the HAProxy TCP proxy:
- Port **5432** — direct PostgreSQL access
- Port **6543** — pgBouncer pooled access

Click **Unexpose** to stop the proxy and close public access.

> Make sure your firewall/security group allows inbound TCP on 5432 and 6543 when exposing.

---

## Updating

Pull the latest changes and rebuild:

```bash
git pull
docker compose -f postgres.yml up -d --build
```

Your data is stored in the `pgdata` Docker volume and is never affected by updates.

---

## Reset Password

If you forget your admin credentials, follow the built-in guide at `/forgot-password` in the UI, or do it manually:

### 1. SSH into your server

```bash
ssh your_user@your-server-ip
```

### 2. Edit `.env`

```bash
cd /path/to/nextbase
nano .env
```

Change `ADMIN_USERNAME` and/or `ADMIN_PASSWORD`.

### 3. Restart

```bash
docker compose -f postgres.yml up -d
```

---

## Stopping & Removing

**Stop all services (keep data):**

```bash
docker compose -f postgres.yml down
```

**Stop and remove all data (irreversible):**

```bash
docker compose -f postgres.yml down -v
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| UI not loading on port 3000 | Check `docker ps` — make sure `dbofather-client` is running |
| Login fails | Verify `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` and restart |
| Database not accepting connections | Check if paused — click **Resume** in the UI |
| Backup fails | Ensure Docker socket `/var/run/docker.sock` is mounted (it is by default) |
| Can't connect from external client | Click **Expose Public** on the dashboard and allow ports 5432/6543 in your firewall |

View logs for any service:

```bash
docker logs dbofather-server   # backend API
docker logs dbofather-client   # frontend
docker logs dbofather-db       # postgres
docker logs dbofather-pooler   # pgbouncer
```

---

## License

This project is licensed under the terms in [LICENSE](./LICENSE).

---

<p align="center">Built with PostgreSQL · pgBouncer · Node.js · React · Docker</p>
