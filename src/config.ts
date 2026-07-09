import fs from 'fs';
import path from 'path';

export interface PromptLogConfig {
  project: {
    name: string;
  };
  scanner: {
    include: string[];
    exclude: string[];
    confidenceThreshold: 'high' | 'medium' | 'low';
  };
  ui: {
    defaultPort: number;
    autoFallback: boolean;
    openBrowser: boolean;
  };
  storage: {
    sqlitePath: string;
    snapshotPrompts: boolean;
    appendOnly: boolean;
  };
  exports: {
    markdown: {
      enabled: boolean;
      onChange: boolean;
      path: string;
    };
    json: {
      enabled: boolean;
      onChange: boolean;
      path: string;
    };
  };
  intelligence: {
    mode: 'host-agent' | 'none';
    requireUserConfirmation: boolean;
    sendFullPromptByDefault: boolean;
  };
}

export const defaultConfig: PromptLogConfig = {
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

export function initConfig(projectRoot: string): PromptLogConfig {
  const configPath = path.join(projectRoot, '.promptlog', 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
    return defaultConfig;
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function getConfig(projectRoot: string): PromptLogConfig | null {
  const configPath = path.join(projectRoot, '.promptlog', 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return null;
}
