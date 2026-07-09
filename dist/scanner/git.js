import { execSync } from 'child_process';
export function getGitMetadata(projectRoot) {
    try {
        const opts = { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' };
        const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
        const commit = execSync('git rev-parse HEAD', opts).trim();
        let author = null;
        try {
            author = execSync('git log -1 --pretty=%ae', opts).trim();
        }
        catch { /* ignore */ }
        let isDirty = false;
        try {
            const status = execSync('git status --porcelain', opts).trim();
            isDirty = status.length > 0;
        }
        catch { /* ignore */ }
        return { branch, commit, author, isDirty };
    }
    catch {
        // Not a git repo or git not installed
        return null;
    }
}
