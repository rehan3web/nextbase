import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import net from 'net';
import { authenticateToken } from '../middleware/auth';
import { emitToUser } from '../lib/socket';

const router = express.Router();

const DEPLOY_ROOT = path.resolve(process.cwd(), '.nextbase-deploys');
if (!fs.existsSync(DEPLOY_ROOT)) {
    fs.mkdirSync(DEPLOY_ROOT, { recursive: true });
}

// Find the last EXPOSE port in a Dockerfile (handles multi-stage builds).
function parseExposedPort(dockerfilePath: string): number | null {
    try {
        const lines = fs.readFileSync(dockerfilePath, 'utf8').split('\n');
        let last: number | null = null;
        for (const line of lines) {
            const m = line.trim().match(/^EXPOSE\s+(\d+)/i);
            if (m) last = parseInt(m[1], 10);
        }
        return last;
    } catch {
        return null;
    }
}

// Find a free host port starting from `start`, incrementing until one binds.
function findFreePort(start = 8000): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(start, '0.0.0.0', () => {
            const addr = server.address() as net.AddressInfo;
            server.close(() => resolve(addr.port));
        });
        server.on('error', () => {
            if (start >= 9999) return reject(new Error('No free port found in 8000-9999'));
            findFreePort(start + 1).then(resolve).catch(reject);
        });
    });
}

interface DeployRecord {
    id: string;
    repo: string;
    name: string;
    ownerId: string;
    status: 'pending' | 'cloning' | 'building' | 'running' | 'failed' | 'success';
    startedAt: number;
    finishedAt?: number;
    error?: string;
    hostPort?: number;
    containerPort?: number;
    containerName?: string;
    logs: { stream: 'stdout' | 'stderr' | 'system'; chunk: string; timestamp: number }[];
}

const deployments = new Map<string, DeployRecord>();

function emitLog(id: string, stream: 'stdout' | 'stderr' | 'system', chunk: string) {
    const entry = { stream, chunk, timestamp: Date.now() };
    const rec = deployments.get(id);
    if (rec) {
        rec.logs.push(entry);
        if (rec.logs.length > 1000) rec.logs.shift();
    }
    // Scoped emission: only the deploy owner's per-user room. Avoiding the
    // generic `deploy-<id>` room keeps an attacker who learns/guesses an id
    // from joining the room and observing logs.
    if (rec?.ownerId) emitToUser(rec.ownerId, 'deploy-log', { id, ...entry });
}

function emitStatus(id: string, status: DeployRecord['status'], extra?: Record<string, any>) {
    const rec = deployments.get(id);
    if (rec) rec.status = status;
    if (rec?.ownerId) emitToUser(rec.ownerId, 'deploy-status', { id, status, ...extra });
}

function runStreamed(id: string, command: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve) => {
        emitLog(id, 'system', `\n$ ${command} ${args.join(' ')}\n`);
        const child = spawn(command, args, { cwd });
        child.stdout.on('data', (d) => emitLog(id, 'stdout', d.toString()));
        child.stderr.on('data', (d) => emitLog(id, 'stderr', d.toString()));
        child.on('error', (err) => {
            emitLog(id, 'stderr', `\n[spawn error: ${err.message}]\n`);
            resolve(-1);
        });
        child.on('close', (code) => resolve(code ?? -1));
    });
}

function deriveProjectName(repo: string): string {
    try {
        const cleaned = repo.replace(/\.git$/i, '').replace(/\/+$/g, '');
        return cleaned.split('/').pop() || 'project';
    } catch {
        return 'project';
    }
}

function safeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'project';
}

function dockerAvailable(): boolean {
    try {
        return fs.existsSync('/var/run/docker.sock');
    } catch {
        return false;
    }
}

function ownerIdFromReq(req: express.Request): string {
    const u = (req as any).user;
    return String(u?.id ?? u?.username ?? 'anonymous');
}

router.get('/list', authenticateToken, (req, res) => {
    const ownerId = ownerIdFromReq(req);
    res.json({
        deployments: Array.from(deployments.values())
            .filter(d => d.ownerId === ownerId)
            .map(d => ({
                id: d.id,
                repo: d.repo,
                name: d.name,
                status: d.status,
                startedAt: d.startedAt,
                finishedAt: d.finishedAt,
                error: d.error,
                hostPort: d.hostPort,
                containerPort: d.containerPort,
                containerName: d.containerName,
            })),
    });
});

router.get('/:id', authenticateToken, (req, res) => {
    const rec = deployments.get(String(req.params.id));
    if (!rec) return res.status(404).json({ message: 'Deployment not found' });
    if (rec.ownerId !== ownerIdFromReq(req)) {
        return res.status(403).json({ message: 'Forbidden' });
    }
    res.json(rec);
});

router.post('/github', authenticateToken, async (req, res) => {
    const { repo } = req.body || {};
    if (!repo || typeof repo !== 'string' || !/^https?:\/\//i.test(repo)) {
        return res.status(400).json({ message: 'A valid HTTP(S) Git repository URL is required.' });
    }

    const id = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const projectName = safeName(deriveProjectName(repo));
    const cloneDir = path.join(DEPLOY_ROOT, `${projectName}-${id}`);
    const imageTag = `nextbase-${projectName}-${id}`.toLowerCase();
    const containerName = `nb-${projectName}-${id}`.toLowerCase();

    const record: DeployRecord = {
        id,
        repo,
        name: projectName,
        ownerId: ownerIdFromReq(req),
        status: 'pending',
        startedAt: Date.now(),
        logs: [],
    };
    deployments.set(id, record);

    res.json({ id, name: projectName });

    // ── Run deploy pipeline asynchronously ─────────────────────────────────────
    (async () => {
        try {
            emitStatus(id, 'cloning');
            emitLog(id, 'system', `Cloning ${repo} into ${cloneDir}\n`);
            const cloneCode = await runStreamed(id, 'git', ['clone', '--depth', '1', repo, cloneDir], DEPLOY_ROOT);
            if (cloneCode !== 0) {
                record.status = 'failed';
                record.error = `git clone exited with code ${cloneCode}`;
                record.finishedAt = Date.now();
                emitStatus(id, 'failed', { error: record.error });
                return;
            }

            const dockerfilePath = path.join(cloneDir, 'Dockerfile');
            if (!fs.existsSync(dockerfilePath)) {
                record.status = 'failed';
                record.error = 'Dockerfile not detected. Deployment failed.';
                record.finishedAt = Date.now();
                emitLog(id, 'stderr', '\n[Dockerfile not detected. Deployment failed.]\n');
                emitStatus(id, 'failed', { error: record.error });
                return;
            }

            if (!dockerAvailable()) {
                record.status = 'failed';
                record.error = 'Docker is not available on this host. Install Docker on your VPS to enable deployments.';
                record.finishedAt = Date.now();
                emitLog(id, 'stderr', `\n[${record.error}]\n`);
                emitStatus(id, 'failed', { error: record.error });
                return;
            }

            // Detect EXPOSE port from Dockerfile and find a free host port
            const containerPort = parseExposedPort(dockerfilePath);
            let hostPort: number | null = null;
            if (containerPort) {
                try {
                    hostPort = await findFreePort(8000);
                    record.containerPort = containerPort;
                    record.hostPort = hostPort;
                    emitLog(id, 'system', `\nDetected EXPOSE ${containerPort} → mapping to host port ${hostPort}\n`);
                } catch (portErr: any) {
                    emitLog(id, 'system', `\nWarning: ${portErr.message} — starting without port mapping\n`);
                }
            } else {
                emitLog(id, 'system', '\nNo EXPOSE found in Dockerfile — starting without port mapping\n');
            }

            emitStatus(id, 'building');
            emitLog(id, 'system', `\nBuilding image ${imageTag}\n`);
            const buildCode = await runStreamed(id, 'docker', ['build', '-t', imageTag, '.'], cloneDir);
            if (buildCode !== 0) {
                record.status = 'failed';
                record.error = `docker build exited with code ${buildCode}`;
                record.finishedAt = Date.now();
                emitStatus(id, 'failed', { error: record.error });
                return;
            }

            emitStatus(id, 'running');
            emitLog(id, 'system', `\nStarting container ${containerName}\n`);
            record.containerName = containerName;
            const portArgs = (hostPort && containerPort)
                ? ['-p', `${hostPort}:${containerPort}`]
                : [];
            const runCode = await runStreamed(id, 'docker', ['run', '-d', '--name', containerName, ...portArgs, imageTag], cloneDir);
            if (runCode !== 0) {
                record.status = 'failed';
                record.error = `docker run exited with code ${runCode}`;
                record.finishedAt = Date.now();
                emitStatus(id, 'failed', { error: record.error });
                return;
            }

            record.status = 'success';
            record.finishedAt = Date.now();
            const portMsg = hostPort ? ` — exposed on host port ${hostPort}` : '';
            emitLog(id, 'system', `\nDeployment successful: container ${containerName} is running${portMsg}.\n`);
            emitStatus(id, 'success', { containerName, imageTag, hostPort, containerPort });
        } catch (err: any) {
            record.status = 'failed';
            record.error = err?.message || String(err);
            record.finishedAt = Date.now();
            emitLog(id, 'stderr', `\n[deploy failed: ${record.error}]\n`);
            emitStatus(id, 'failed', { error: record.error });
        }
    })();
});

export default router;
