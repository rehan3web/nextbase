"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
function resolveConfigPath() {
    const candidates = [
        '/config/postgres.yml', // Docker container mount
        path_1.default.resolve(process.cwd(), 'postgres.yml'), // CWD (local dev)
        path_1.default.resolve(process.cwd(), '../postgres.yml'), // One level up
        path_1.default.resolve(__dirname, '../../../postgres.yml'), // Relative to dist/
        path_1.default.resolve(__dirname, '../../postgres.yml'),
        path_1.default.resolve(__dirname, '../postgres.yml'),
    ];
    for (const p of candidates) {
        if (fs_1.default.existsSync(p))
            return p;
    }
    return candidates[1];
}
let CONFIG_PATH = resolveConfigPath();
function loadConfig() {
    try {
        const fileContents = fs_1.default.readFileSync(CONFIG_PATH, 'utf8');
        const data = js_yaml_1.default.load(fileContents);
        return data;
    }
    catch (e) {
        console.error('Error loading postgres.yml:', e);
        return null;
    }
}
function saveConfig(services) {
    try {
        const data = { name: 'custom-supabase', services };
        const yamlStr = js_yaml_1.default.dump(data);
        fs_1.default.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
        return true;
    }
    catch (e) {
        console.error('Error saving postgres.yml:', e);
        return false;
    }
}
