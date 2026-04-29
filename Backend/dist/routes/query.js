"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const db_1 = require("../lib/db");
const router = express_1.default.Router();
router.post('/run', auth_1.authenticateToken, async (req, res) => {
    const { sql, params } = req.body;
    if (!sql)
        return res.status(400).json({ message: 'SQL query is required' });
    try {
        const result = await (0, db_1.executeQuery)(sql, params);
        res.json(result);
    }
    catch (error) {
        res.status(400).json(error);
    }
});
exports.default = router;
