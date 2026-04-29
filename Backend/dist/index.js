"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastTableUpdate = exports.broadcastSchemaChange = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = __importDefault(require("./routes/auth"));
const db_1 = __importDefault(require("./routes/db"));
const query_1 = __importDefault(require("./routes/query"));
const admin_1 = __importDefault(require("./routes/admin"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.use('/api/auth', auth_1.default);
app.use('/api/db', db_1.default);
app.use('/api/query', query_1.default);
app.use('/api/admin', admin_1.default);
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('subscribe-table', (tableName) => {
        socket.join(`table-${tableName}`);
    });
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});
const broadcastSchemaChange = () => {
    io.emit('schema-changed');
};
exports.broadcastSchemaChange = broadcastSchemaChange;
const broadcastTableUpdate = (tableName) => {
    io.to(`table-${tableName}`).emit('table-updated', { tableName });
};
exports.broadcastTableUpdate = broadcastTableUpdate;
const PORT = process.env.BACKEND_PORT || 3001;
server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Backend running on port ${PORT}`);
});
