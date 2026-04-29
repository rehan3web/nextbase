"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const db_1 = require("../lib/db");
const index_1 = require("../index");
const queryTracker_1 = require("../lib/queryTracker");
const router = express_1.default.Router();
// Get db overview for dashboard
router.get('/overview', auth_1.authenticateToken, async (_req, res) => {
    try {
        const sizeResult = await (0, db_1.executeQuery)(`
            SELECT pg_size_pretty(pg_database_size(current_database())) as size_pretty
        `);
        const tablesResult = await (0, db_1.executeQuery)(`
            SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
        `);
        const connectionsResult = await (0, db_1.executeQuery)(`
            SELECT count(*) FROM pg_stat_activity WHERE state = 'active'
        `);
        res.json({
            activeConnections: parseInt(connectionsResult.rows[0].count),
            databaseSize: sizeResult.rows[0].size_pretty,
            tableCount: parseInt(tablesResult.rows[0].count),
        });
    }
    catch (err) {
        res.status(500).json(err);
    }
});
// Get throughput data
router.get('/throughput', auth_1.authenticateToken, (_req, res) => {
    res.json({ dataPoints: (0, queryTracker_1.getThroughput)() });
});
// Get active query activity
router.get('/activity', auth_1.authenticateToken, async (_req, res) => {
    try {
        const result = await (0, db_1.executeQuery)(`
            SELECT
                pid,
                state,
                query,
                query_start,
                now() - query_start AS duration,
                wait_event_type,
                wait_event
            FROM pg_stat_activity
            WHERE state IS NOT NULL
              AND query NOT ILIKE '%pg_stat_activity%'
            ORDER BY query_start DESC NULLS LAST
            LIMIT 20
        `);
        const activities = result.rows.map((row) => ({
            pid: row.pid,
            state: row.state,
            query: row.query,
            startedAt: row.query_start ? row.query_start.toISOString() : new Date().toISOString(),
            duration: row.duration
                ? formatDuration(row.duration)
                : '0ms',
            waitEvent: row.wait_event,
        }));
        res.json({ activities });
    }
    catch (err) {
        res.status(500).json(err);
    }
});
// Tables with row count and size
router.get('/tables-extended', auth_1.authenticateToken, async (_req, res) => {
    try {
        const result = await (0, db_1.executeQuery)(`
            SELECT
                t.table_name AS "tableName",
                COALESCE(s.n_live_tup, 0) AS "rowCount",
                pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) AS "totalSize"
            FROM information_schema.tables t
            LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
            WHERE t.table_schema = 'public'
            ORDER BY t.table_name
        `);
        res.json({ tables: result.rows });
    }
    catch (err) {
        res.status(500).json(err);
    }
});
// Create table
router.post('/tables', auth_1.authenticateToken, async (req, res) => {
    const { tableName, columns } = req.body;
    if (!tableName)
        return res.status(400).json({ message: 'Table name is required' });
    const columnDefs = (columns || []).map((col) => {
        if (!col.name || !col.type)
            return null;
        let def = `"${col.name}" ${col.type}`;
        if (col.primaryKey)
            def += ' PRIMARY KEY';
        else {
            if (col.notNull)
                def += ' NOT NULL';
            if (col.default !== undefined && col.default !== '')
                def += ` DEFAULT ${col.default}`;
        }
        return def;
    }).filter(Boolean);
    if (columnDefs.length === 0)
        columnDefs.push('id SERIAL PRIMARY KEY');
    const sql = `CREATE TABLE "${tableName}" (${columnDefs.join(', ')})`;
    try {
        await (0, db_1.executeQuery)(sql);
        (0, index_1.broadcastSchemaChange)();
        res.json({ message: 'Table created', tableName });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Rename table
router.patch('/tables/:name/rename', auth_1.authenticateToken, async (req, res) => {
    const { newName } = req.body;
    const oldName = req.params.name;
    if (!newName)
        return res.status(400).json({ message: 'New name is required' });
    try {
        await (0, db_1.executeQuery)(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
        (0, index_1.broadcastSchemaChange)();
        res.json({ message: 'Table renamed', newName });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// List all tables
router.get('/tables', auth_1.authenticateToken, async (_req, res) => {
    try {
        const result = await (0, db_1.executeQuery)(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        res.json(result.rows);
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Get table schema
router.get('/tables/:name', auth_1.authenticateToken, async (req, res) => {
    const name = req.params.name;
    try {
        const columns = await (0, db_1.executeQuery)(`
            SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
        `, [name]);
        const constraints = await (0, db_1.executeQuery)(`
            SELECT
                tc.constraint_name, tc.table_name, kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                tc.constraint_type
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                LEFT JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
            WHERE tc.table_name = $1 AND tc.table_schema = 'public';
        `, [name]);
        res.json({
            columns: columns.rows,
            constraints: constraints.rows
        });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Get table data
router.get('/tables/:name/data', auth_1.authenticateToken, async (req, res) => {
    const name = req.params.name;
    const { limit = 50, offset = 0, sortColumn, sortOrder = 'ASC' } = req.query;
    let query = `SELECT * FROM "${name}"`;
    if (sortColumn) {
        query += ` ORDER BY "${sortColumn}" ${sortOrder}`;
    }
    else {
        query += ` ORDER BY 1`;
    }
    query += ` LIMIT ${limit} OFFSET ${offset}`;
    try {
        const result = await (0, db_1.executeQuery)(query);
        const countResult = await (0, db_1.executeQuery)(`SELECT count(*) FROM "${name}"`);
        res.json({
            data: result.rows,
            totalCount: parseInt(countResult.rows[0].count),
            fields: result.fields
        });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Insert row
router.post('/tables/:name/rows', auth_1.authenticateToken, async (req, res) => {
    const name = req.params.name;
    const row = req.body;
    const cleanedRow = {};
    Object.keys(row).forEach(key => {
        if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
            cleanedRow[key] = row[key];
        }
    });
    const columns = Object.keys(cleanedRow);
    const values = Object.values(cleanedRow);
    if (columns.length === 0) {
        try {
            const result = await (0, db_1.executeQuery)(`INSERT INTO "${name}" DEFAULT VALUES RETURNING *`);
            (0, index_1.broadcastTableUpdate)(name);
            return res.json(result.rows[0]);
        }
        catch (error) {
            return res.status(500).json(error);
        }
    }
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const query = `INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`;
    try {
        const result = await (0, db_1.executeQuery)(query, values);
        (0, index_1.broadcastTableUpdate)(name);
        res.json(result.rows[0]);
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Add column
router.post('/tables/:name/columns', auth_1.authenticateToken, async (req, res) => {
    const name = req.params.name;
    const { columnName, dataType, defaultValue, isNullable } = req.body;
    if (!columnName || !dataType) {
        return res.status(400).json({ message: 'Column name and data type are required' });
    }
    let query = `ALTER TABLE "${name}" ADD COLUMN "${columnName}" ${dataType}`;
    if (defaultValue !== undefined && defaultValue !== '') {
        query += ` DEFAULT ${defaultValue}`;
    }
    if (!isNullable) {
        query += ` NOT NULL`;
    }
    try {
        await (0, db_1.executeQuery)(query);
        (0, index_1.broadcastSchemaChange)();
        res.json({ message: 'Column added successfully' });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Update row
router.patch('/tables/:name/rows', auth_1.authenticateToken, async (req, res) => {
    const name = req.params.name;
    const { selection, updates } = req.body;
    const setClause = Object.keys(updates).map((key, i) => `"${key}" = $${i + 1}`).join(', ');
    const whereClause = Object.keys(selection).map((key, i) => `"${key}" = $${Object.keys(updates).length + i + 1}`).join(' AND ');
    const query = `UPDATE "${name}" SET ${setClause} WHERE ${whereClause} RETURNING *`;
    const values = [...Object.values(updates), ...Object.values(selection)];
    try {
        const result = await (0, db_1.executeQuery)(query, values);
        (0, index_1.broadcastTableUpdate)(name);
        res.json(result.rows[0]);
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Delete row
router.delete('/tables/:name/rows', auth_1.authenticateToken, async (req, res) => {
    const name = req.params.name;
    const selection = req.body;
    const whereClause = Object.keys(selection).map((key, i) => `"${key}" = $${i + 1}`).join(' AND ');
    const query = `DELETE FROM "${name}" WHERE ${whereClause}`;
    try {
        await (0, db_1.executeQuery)(query, Object.values(selection));
        (0, index_1.broadcastTableUpdate)(name);
        res.json({ message: 'Row deleted' });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Delete table
router.delete('/tables/:name', auth_1.authenticateToken, async (req, res) => {
    const name = req.params.name;
    try {
        await (0, db_1.executeQuery)(`DROP TABLE "${name}" CASCADE`);
        (0, index_1.broadcastSchemaChange)();
        res.json({ message: 'Table deleted' });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Duplicate table
router.post('/tables/:name/duplicate', auth_1.authenticateToken, async (req, res) => {
    const name = req.params.name;
    const newName = `${name}_copy_${Date.now()}`;
    try {
        await (0, db_1.executeQuery)(`CREATE TABLE "${newName}" (LIKE "${name}" INCLUDING ALL)`);
        await (0, db_1.executeQuery)(`INSERT INTO "${newName}" SELECT * FROM "${name}"`);
        (0, index_1.broadcastSchemaChange)();
        res.json({ message: 'Table duplicated', newTableName: newName });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Get full schema for visualization
router.get('/schema', auth_1.authenticateToken, async (_req, res) => {
    try {
        const columnsResult = await (0, db_1.executeQuery)(`
            SELECT table_name, column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `);
        const constraintsResult = await (0, db_1.executeQuery)(`
            SELECT
                tc.constraint_name, tc.table_name, kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                tc.constraint_type
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                LEFT JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
            WHERE tc.table_schema = 'public';
        `);
        const pkSet = new Set(constraintsResult.rows
            .filter((c) => c.constraint_type === 'PRIMARY KEY')
            .map((c) => `${c.table_name}.${c.column_name}`));
        const fkSet = new Set(constraintsResult.rows
            .filter((c) => c.constraint_type === 'FOREIGN KEY')
            .map((c) => `${c.table_name}.${c.column_name}`));
        const tablesMap = {};
        for (const col of columnsResult.rows) {
            if (!tablesMap[col.table_name]) {
                tablesMap[col.table_name] = { name: col.table_name, columns: [] };
            }
            tablesMap[col.table_name].columns.push({
                name: col.column_name,
                type: col.data_type,
                isPk: pkSet.has(`${col.table_name}.${col.column_name}`),
                isFk: fkSet.has(`${col.table_name}.${col.column_name}`),
            });
        }
        const relations = constraintsResult.rows
            .filter((c) => c.constraint_type === 'FOREIGN KEY')
            .map((c) => ({
            from: c.table_name,
            fromCol: c.column_name,
            to: c.foreign_table_name,
            toCol: c.foreign_column_name,
        }));
        res.json({
            tables: Object.values(tablesMap),
            relations,
            columns: columnsResult.rows,
            constraints: constraintsResult.rows,
        });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Get database stats
router.get('/stats', auth_1.authenticateToken, async (_req, res) => {
    try {
        const tablesResult = await (0, db_1.executeQuery)(`
            SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
        `);
        const rowsResult = await (0, db_1.executeQuery)(`
            SELECT sum(n_live_tup) as total_rows FROM pg_stat_user_tables
        `);
        const sizeResult = await (0, db_1.executeQuery)(`
            SELECT pg_database_size(current_database()) as size_bytes,
                   pg_size_pretty(pg_database_size(current_database())) as size_pretty
        `);
        const connectionsResult = await (0, db_1.executeQuery)(`
            SELECT count(*) FROM pg_stat_activity
        `);
        const throughput = (0, queryTracker_1.getThroughput)();
        res.json({
            totalTables: parseInt(tablesResult.rows[0].count),
            totalRows: parseInt(rowsResult.rows[0].total_rows || '0'),
            dbSize: sizeResult.rows[0].size_pretty,
            dbSizeBytes: parseInt(sizeResult.rows[0].size_bytes),
            activeConnections: parseInt(connectionsResult.rows[0].count),
            throughput
        });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
// Delete column
router.delete('/tables/:name/columns/:column', auth_1.authenticateToken, async (req, res) => {
    const { name, column } = req.params;
    try {
        await (0, db_1.executeQuery)(`ALTER TABLE "${name}" DROP COLUMN "${column}" CASCADE`);
        (0, index_1.broadcastSchemaChange)();
        res.json({ message: 'Column dropped' });
    }
    catch (error) {
        res.status(500).json(error);
    }
});
function formatDuration(interval) {
    if (!interval)
        return '0ms';
    const totalMs = Math.abs((interval.hours || 0) * 3600000 +
        (interval.minutes || 0) * 60000 +
        (interval.seconds || 0) * 1000 +
        (interval.milliseconds || 0));
    if (totalMs < 1000)
        return `${Math.round(totalMs)}ms`;
    if (totalMs < 60000)
        return `${(totalMs / 1000).toFixed(1)}s`;
    return `${Math.floor(totalMs / 60000)}m ${Math.round((totalMs % 60000) / 1000)}s`;
}
exports.default = router;
