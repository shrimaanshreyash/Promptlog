import fs from 'fs';
import path from 'path';
export const defaultConfig = {
    project: {
        name: path.basename(process.cwd()) || 'untitled-project'
    },
    scanner: {
        include: ["src/**/*", "server/**/*", "lib/**/*", "app/**/*", "prompts/**/*", "**/*.py", "*.md"],
        exclude: ["node_modules/**", ".git/**", "dist/**", "build/**"],
        confidenceThreshold: "low"
    },
    ui: {
        defaultPort: 4319,
        autoFallback: true,
        openBrowser: true
    },
    storage: {
        sqlitePath: ".promptlog/promptlog.sqlite",
        snapshotPrompts: true,
        appendOnly: true
    },
    exports: {
        markdown: {
            enabled: true,
            onChange: true,
            path: ".promptlog/exports/markdown"
        },
        json: {
            enabled: true,
            onChange: false,
            path: ".promptlog/exports/json"
        }
    },
    intelligence: {
        mode: "host-agent",
        requireUserConfirmation: true,
        sendFullPromptByDefault: false
    }
};
export function initConfig(projectRoot) {
    const configPath = path.join(projectRoot, '.promptlog', 'config.json');
    if (!fs.existsSync(configPath)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
        return defaultConfig;
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
export function getConfig(projectRoot) {
    const configPath = path.join(projectRoot, '.promptlog', 'config.json');
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return null;
}
