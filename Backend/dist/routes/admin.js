"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const db_1 = require("../lib/db");
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../lib/config");
const router = express_1.default.Router();
const BACKUP_DIR = path_1.default.resolve(process.cwd(), 'backups');
if (!fs_1.default.existsSync(BACKUP_DIR)) {
    fs_1.default.mkdirSync(BACKUP_DIR, { recursive: true });
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function findConfigPath() {
    const candidates = [
        '/config/postgres.yml', // Docker container mount
        path_1.default.resolve(process.cwd(), 'postgres.yml'),
        path_1.default.resolve(process.cwd(), '../postgres.yml'),
        path_1.default.resolve(__dirname, '../../../postgres.yml'),
        path_1.default.resolve(__dirname, '../../postgres.yml'),
    ];
    for (const p of candidates) {
        if (fs_1.default.existsSync(p))
            return p;
    }
    return null;
}
async function getPublicIP() {
    try {
        const resp = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
        const data = await resp.json();
        if (data?.ip)
            return data.ip;
    }
    catch { }
    // Fallback: read non-internal IPv4 from os
    try {
        const ifaces = os_1.default.networkInterfaces();
        for (const list of Object.values(ifaces)) {
            for (const iface of (list || [])) {
                if (iface.family === 'IPv4' && !iface.internal)
                    return iface.address;
            }
        }
    }
    catch { }
    return '127.0.0.1';
}
function isDockerContainerRunning(name) {
    try {
        const out = (0, child_process_1.execSync)(`docker inspect --format='{{.State.Running}}' ${name} 2>/dev/null`, { stdio: 'pipe', timeout: 3000 }).toString().trim();
        return out === "'true'" || out === 'true';
    }
    catch {
        return false;
    }
}
function isDockerAvailable() {
    try {
        (0, child_process_1.execSync)('docker ps --quiet --filter name=dbofather-db 2>/dev/null', { stdio: 'pipe', timeout: 3000 });
        return true;
    }
    catch {
        return false;
    }
}
const PROXY_CONTAINER = 'dbofather-proxy';
function isNginxProxyRunning() {
    return isDockerContainerRunning(PROXY_CONTAINER);
}
function dockerComposeProxy(action) {
    const cfgPath = findConfigPath();
    if (!cfgPath)
        return Promise.reject(new Error('postgres.yml not found'));
    const args = action === 'up'
        ? ['compose', '-f', cfgPath, '--profile', 'expose', 'up', '-d', 'dbcraft-proxy']
        : action === 'stop'
            ? ['compose', '-f', cfgPath, 'stop', 'dbcraft-proxy']
            : ['compose', '-f', cfgPath, 'rm', '-f', 'dbcraft-proxy'];
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.stderr.on('data', (d) => { err += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0)
                resolve(out + err);
            else
                reject(new Error(`docker compose exit ${code}: ${(err || out).substring(0, 300)}`));
        });
        proc.on('error', reject);
    });
}
function getDbConfig() {
    const cfg = (0, config_1.loadConfig)();
    const pgService = cfg?.services?.postgres || {};
    const bouncer = cfg?.services?.pgbouncer || {};
    const user = pgService?.environment?.POSTGRES_USER || process.env.PGUSER || 'postgres';
    const password = pgService?.environment?.POSTGRES_PASSWORD || process.env.PGPASSWORD || '';
    const db = pgService?.environment?.POSTGRES_DB || process.env.PGDATABASE || 'postgres';
    const containerName = pgService?.container_name || 'dbofather-db';
    const poolerContainer = bouncer?.container_name || 'dbofather-pooler';
    const directPort = parseInt((pgService?.ports?.[0] || '5432:5432').split(':')[1] || '5432', 10);
    const poolerPort = parseInt((bouncer?.ports?.[0] || '6543:5432').split(':')[1] || '6543', 10);
    return { user, password, db, containerName, poolerContainer, directPort, poolerPort };
}
// ── Backup via docker exec pg_dump → fallback to direct pg_dump ────────────────
router.post('/backup', auth_1.authenticateToken, async (_req, res) => {
    const ts = Date.now();
    const filename = `backup_${ts}.sql`;
    const filepath = path_1.default.join(BACKUP_DIR, filename);
    const useDocker = isDockerAvailable();
    // For docker: use postgres.yml credentials; for direct: use env vars
    const { user: cfgUser, password: cfgPassword, db: cfgDb, containerName } = getDbConfig();
    const host = process.env.PGHOST || '127.0.0.1';
    const port = process.env.PGPORT || '5432';
    const user = useDocker ? cfgUser : (process.env.PGUSER || 'postgres');
    const db = useDocker ? cfgDb : (process.env.PGDATABASE || 'postgres');
    const password = useDocker ? cfgPassword : (process.env.PGPASSWORD || '');
    let proc;
    const env = { ...process.env };
    if (password)
        env.PGPASSWORD = password;
    if (useDocker) {
        proc = (0, child_process_1.spawn)('docker', [
            'exec', containerName,
            'pg_dump', '-U', user, '-d', db, '--no-password',
        ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    else {
        proc = (0, child_process_1.spawn)('pg_dump', [
            '-h', host, '-p', port, '-U', user,
            '-F', 'p', '--no-password', '-f', filepath, db,
        ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    let stderr = '';
    const chunks = [];
    if (useDocker) {
        proc.stdout.on('data', (d) => chunks.push(d));
    }
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({ message: `pg_dump failed: ${stderr}` });
        }
        if (useDocker) {
            fs_1.default.writeFileSync(filepath, Buffer.concat(chunks));
        }
        const stats = fs_1.default.statSync(filepath);
        res.json({
            id: `bk_${ts}`,
            filename,
            label: 'Manual backup',
            time: new Date(ts).toISOString(),
            size: formatBytes(stats.size),
            sizeBytes: stats.size,
            method: useDocker ? 'docker-exec' : 'pg_dump',
        });
    });
    proc.on('error', (err) => {
        res.status(500).json({ message: `Backup failed: ${err.message}` });
    });
});
// ── List backups ───────────────────────────────────────────────────────────────
router.get('/backups', auth_1.authenticateToken, (_req, res) => {
    try {
        if (!fs_1.default.existsSync(BACKUP_DIR))
            return res.json([]);
        const files = fs_1.default.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.sql'))
            .map(f => {
            const fp = path_1.default.join(BACKUP_DIR, f);
            const stats = fs_1.default.statSync(fp);
            const ts = parseInt(f.replace('backup_', '').replace('.sql', ''), 10);
            return {
                id: `bk_${ts || stats.mtimeMs}`,
                filename: f,
                label: 'Manual backup',
                time: new Date(ts || stats.mtimeMs).toISOString(),
                size: formatBytes(stats.size),
                sizeBytes: stats.size,
            };
        })
            .sort((a, b) => b.time.localeCompare(a.time));
        res.json(files);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
// ── Download backup ───────────────────────────────────────────────────────────
router.get('/backups/:id/download', auth_1.authenticateToken, (req, res) => {
    const id = String(req.params.id);
    const filename = `backup_${id.replace('bk_', '')}.sql`;
    const filepath = path_1.default.join(BACKUP_DIR, filename);
    if (!fs_1.default.existsSync(filepath))
        return res.status(404).json({ message: 'Backup not found' });
    res.download(filepath, filename);
});
// ── Delete backup ─────────────────────────────────────────────────────────────
router.delete('/backups/:id', auth_1.authenticateToken, (req, res) => {
    const id = String(req.params.id);
    const filename = `backup_${id.replace('bk_', '')}.sql`;
    const filepath = path_1.default.join(BACKUP_DIR, filename);
    if (!fs_1.default.existsSync(filepath))
        return res.status(404).json({ message: 'Backup not found' });
    fs_1.default.unlinkSync(filepath);
    res.json({ message: 'Backup deleted' });
});
// ── Restore via docker exec psql → fallback to direct psql → fallback statement exec
router.post('/restore', auth_1.authenticateToken, async (req, res) => {
    const { sql } = req.body;
    if (!sql)
        return res.status(400).json({ message: 'SQL content is required' });
    const { user: cfgUser, password: cfgPassword, db: cfgDb, containerName } = getDbConfig();
    const useDocker = isDockerAvailable();
    const host = process.env.PGHOST || '127.0.0.1';
    const port = process.env.PGPORT || '5432';
    const user = useDocker ? cfgUser : (process.env.PGUSER || 'postgres');
    const db = useDocker ? cfgDb : (process.env.PGDATABASE || 'postgres');
    const password = useDocker ? cfgPassword : (process.env.PGPASSWORD || '');
    const env = { ...process.env };
    if (password)
        env.PGPASSWORD = password;
    let proc;
    if (useDocker) {
        proc = (0, child_process_1.spawn)('docker', [
            'exec', '-i', containerName,
            'psql', '-U', user, '-d', db, '--no-password',
        ], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    else {
        proc = (0, child_process_1.spawn)('psql', [
            '-h', host, '-p', port, '-U', user, '-d', db, '--no-password',
        ], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', async (code) => {
        if (code === 0) {
            const stmtCount = sql.split(';').filter((s) => s.trim().length > 0).length;
            return res.json({ executed: stmtCount, errors: [], method: useDocker ? 'docker-exec' : 'psql' });
        }
        // Fallback: execute statements one by one via node-postgres
        const statements = sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
        let executed = 0;
        const errors = [];
        for (const stmt of statements) {
            try {
                await (0, db_1.executeQuery)(stmt);
                executed++;
            }
            catch (e) {
                errors.push(e.message || String(e));
            }
        }
        res.json({ executed, errors, method: 'fallback-node' });
    });
    proc.on('error', async () => {
        const statements = sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
        let executed = 0;
        const errors = [];
        for (const stmt of statements) {
            try {
                await (0, db_1.executeQuery)(stmt);
                executed++;
            }
            catch (e) {
                errors.push(e.message || String(e));
            }
        }
        res.json({ executed, errors, method: 'fallback-node' });
    });
    proc.stdin.write(sql);
    proc.stdin.end();
});
// ── Connection config from postgres.yml ───────────────────────────────────────
router.get('/connection', auth_1.authenticateToken, async (_req, res) => {
    const { user, password, db, containerName, poolerContainer, directPort, poolerPort } = getDbConfig();
    const publicIp = await getPublicIP();
    const exposed = isNginxProxyRunning();
    const encUser = encodeURIComponent(user);
    const encPass = encodeURIComponent(password);
    const dockerRunning = isDockerContainerRunning(containerName);
    res.json({
        user, db, containerName, poolerContainer, directPort, poolerPort,
        serverIp: publicIp,
        dockerRunning,
        directLocal: `postgresql://${encUser}:${encPass}@127.0.0.1:${directPort}/${db}`,
        poolerLocal: `postgresql://${encUser}:${encPass}@127.0.0.1:${poolerPort}/${db}`,
        directPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${directPort}/${db}`,
        poolerPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${poolerPort}/${db}`,
        directPublicPort: directPort,
        poolerPublicPort: poolerPort,
        exposed,
    });
});
// ── Expose Public — starts nginx TCP proxy container ─────────────────────────
router.post('/expose', auth_1.authenticateToken, async (_req, res) => {
    try {
        const { user, password, db, directPort, poolerPort } = getDbConfig();
        const publicIp = await getPublicIP();
        const encUser = encodeURIComponent(user);
        const encPass = encodeURIComponent(password);
        const dockerAvailable = isDockerAvailable();
        if (dockerAvailable) {
            // Start the nginx TCP stream proxy via docker compose --profile expose
            try {
                await dockerComposeProxy('up');
            }
            catch (e) {
                return res.status(500).json({ message: `Could not start proxy: ${e.message}` });
            }
            return res.json({
                exposed: true,
                mode: 'nginx-proxy',
                serverIp: publicIp,
                directPublicPort: directPort,
                poolerPublicPort: poolerPort,
                directPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${directPort}/${db}`,
                poolerPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${poolerPort}/${db}`,
            });
        }
        // Dev fallback: Node.js in-process TCP proxy
        res.json({
            exposed: false,
            mode: 'no-docker',
            note: 'Docker is not running. Start Docker and run: docker compose -f postgres.yml --profile expose up -d dbcraft-proxy',
            serverIp: publicIp,
            directPublicPort: directPort,
            poolerPublicPort: poolerPort,
            directPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${directPort}/${db}`,
            poolerPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${poolerPort}/${db}`,
        });
    }
    catch (err) {
        res.status(500).json({ message: `Failed to expose: ${err.message}` });
    }
});
// ── Remove Public — stops nginx TCP proxy container ───────────────────────────
router.post('/unexpose', auth_1.authenticateToken, async (_req, res) => {
    try {
        await dockerComposeProxy('stop');
        await dockerComposeProxy('rm');
    }
    catch { /* container may not be running */ }
    res.json({ exposed: false, note: 'nginx TCP proxy stopped. Database is local-only.' });
});
// ── Pause database ────────────────────────────────────────────────────────────
router.post('/db/pause', auth_1.authenticateToken, async (_req, res) => {
    try {
        await (0, db_1.executeQuery)(`REVOKE CONNECT ON DATABASE "${process.env.PGDATABASE || 'postgres'}" FROM PUBLIC`);
        await (0, db_1.executeQuery)(`
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
        `);
        res.json({ paused: true, message: 'Database paused — all connections terminated' });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
// ── Resume database ───────────────────────────────────────────────────────────
router.post('/db/resume', auth_1.authenticateToken, async (_req, res) => {
    try {
        await (0, db_1.executeQuery)(`GRANT CONNECT ON DATABASE "${process.env.PGDATABASE || 'postgres'}" TO PUBLIC`);
        res.json({ paused: false, message: 'Database resumed — connections allowed' });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
// ── Reset database ────────────────────────────────────────────────────────────
router.post('/db/reset', auth_1.authenticateToken, async (_req, res) => {
    try {
        const tables = await (0, db_1.executeQuery)(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
        for (const row of tables.rows) {
            await (0, db_1.executeQuery)(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
        }
        res.json({ message: 'Database reset — all tables dropped', dropped: tables.rows.length });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.default = router;
