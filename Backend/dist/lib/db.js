"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConnection = getConnection;
exports.executeQuery = executeQuery;
const pg_1 = require("pg");
const queryTracker_1 = require("./queryTracker");
let pool = null;
async function getConnection() {
    if (pool)
        return pool;
    if (process.env.DATABASE_URL) {
        pool = new pg_1.Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        });
    }
    else {
        pool = new pg_1.Pool({
            user: process.env.PGUSER || process.env.DB_USER || 'postgres',
            host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
            database: process.env.PGDATABASE || process.env.DATABASE || 'postgres',
            password: process.env.PGPASSWORD || process.env.PASSWORD || 'postgres',
            port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
        });
    }
    return pool;
}
async function executeQuery(query, params = []) {
    const p = await getConnection();
    const start = Date.now();
    (0, queryTracker_1.trackQuery)(query);
    try {
        const result = await p.query(query, params);
        const duration = Date.now() - start;
        return {
            rows: result.rows,
            fields: result.fields,
            rowCount: result.rowCount,
            duration,
        };
    }
    catch (error) {
        console.error('Database Query Error:', {
            query,
            params,
            errorMessage: error.message,
            detail: error.detail
        });
        throw {
            message: error.message,
            detail: error.detail,
            position: error.position,
            duration: Date.now() - start,
        };
    }
}
