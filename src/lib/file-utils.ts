import fs from 'fs';
import path from 'path';

export function sanitizeFilename(filename: string): string {
  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/g;
  return filename.replace(invalidChars, '_');
}

export function getFilesRecursively(dir: string, baseDir: string): Array<{
  name: string;
  size: number;
  modified: string;
  url: string;
}> {
  const results: Array<{
    name: string;
    size: number;
    modified: string;
    url: string;
  }> = [];

  const list = fs.readdirSync(dir);

  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat && stat.isDirectory()) {
      results.push(...getFilesRecursively(fullPath, baseDir));
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push({
        name: relPath,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        url: `/download/${path.basename(path.dirname(baseDir))}/${encodeURIComponent(relPath)}`,
      });
    }
  });

  return results;
}

export function preventDirectoryTraversal(extractDir: string, filePath: string): boolean {
  const fullPath = path.resolve(extractDir, filePath);
  const relative = path.relative(path.resolve(extractDir), fullPath);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
  }
}

export function cleanupDirectory(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
