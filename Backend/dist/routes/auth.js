"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const config_1 = require("../lib/config");
const router = express_1.default.Router();
router.get('/config', (req, res) => {
    res.json({ username: process.env.ADMIN_USERNAME });
});
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const config = (0, config_1.loadConfig)();
    // Fallback: Check process.env first, then postgres.yml anchors
    const envUser = (process.env.ADMIN_USERNAME || config?.['x-admin-user'] || '').toString().trim();
    const envPass = (process.env.ADMIN_PASSWORD || config?.['x-admin-pass'] || '').toString().trim();
    const inputUser = (username || '').toString().trim();
    const inputPass = (password || '').toString().trim();
    console.log('Login debug:', {
        inputUser,
        expectedUser: envUser,
        configKeys: config ? Object.keys(config) : 'null',
        inputUserLen: inputUser.length,
        expectedUserLen: envUser.length,
        inputPassLen: inputPass.length,
        expectedPassLen: envPass.length,
        match: inputUser === envUser && inputPass === envPass
    });
    if (inputUser === envUser && inputPass === envPass) {
        const token = (0, auth_1.generateToken)({ username: inputUser });
        return res.json({ token, user: { username: inputUser } });
    }
    res.status(401).json({ message: 'Invalid credentials' });
});
router.post('/change-password', auth_1.authenticateToken, async (req, res) => {
    res.status(400).json({ message: 'Password changes are managed via postgres.yml (x-admin-pass).' });
});
router.get('/me', auth_1.authenticateToken, (req, res) => {
    res.json({ user: req.user });
});
exports.default = router;
