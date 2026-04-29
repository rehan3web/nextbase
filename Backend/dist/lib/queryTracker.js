"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackQuery = trackQuery;
exports.getThroughput = getThroughput;
const BUCKET_MS = 5000;
const MAX_BUCKETS = 30;
let buckets = [];
let current = { timestamp: Date.now(), queries: 0, inserts: 0, updates: 0, deletes: 0 };
function classify(sql) {
    const s = sql.trimStart().toUpperCase();
    if (s.startsWith('INSERT'))
        return 'insert';
    if (s.startsWith('UPDATE'))
        return 'update';
    if (s.startsWith('DELETE'))
        return 'delete';
    return 'query';
}
function trackQuery(sql = '') {
    const now = Date.now();
    if (now - current.timestamp >= BUCKET_MS) {
        buckets.push({ ...current });
        if (buckets.length > MAX_BUCKETS)
            buckets.shift();
        current = { timestamp: now, queries: 0, inserts: 0, updates: 0, deletes: 0 };
    }
    const type = classify(sql);
    current.queries++;
    if (type === 'insert')
        current.inserts++;
    else if (type === 'update')
        current.updates++;
    else if (type === 'delete')
        current.deletes++;
}
function getThroughput() {
    const all = [...buckets, current];
    const divisor = BUCKET_MS / 1000;
    return all.map(b => ({
        timestamp: b.timestamp,
        queries: Math.round(b.queries / divisor),
        inserts: Math.round(b.inserts / divisor),
        updates: Math.round(b.updates / divisor),
        deletes: Math.round(b.deletes / divisor),
    }));
}
