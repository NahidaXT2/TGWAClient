import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { createLogger } from '../lib/logger.js';
import { ExtractionInfo, ZipLimits } from '../types/zip.types.js';
import { ensureDirectoryExists, cleanupDirectory } from '../lib/file-utils.js';

const logger = createLogger('FileStorage');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/zip-extractor';
const FILE_EXPIRATION_HOURS = parseInt(process.env.FILE_EXPIRATION_HOURS || '24', 10);

const ZIP_LIMITS: ZipLimits = {
  max_file_size: parseInt(process.env.MAX_FILE_SIZE || '524288000', 10), // 500MB
  max_extraction_size: parseInt(process.env.MAX_EXTRACTION_SIZE || '1073741824', 10), // 1GB
  max_files: parseInt(process.env.MAX_FILES || '1000', 10),
  file_expiration_hours: FILE_EXPIRATION_HOURS,
};

class FileStorageService {
  private extractions: Map<string, ExtractionInfo> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    ensureDirectoryExists(UPLOAD_DIR);
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredExtractions();
    }, 60 * 60 * 1000); // Check every hour
  }

  private cleanupExpiredExtractions(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [id, info] of this.extractions.entries()) {
      const expiresAt = new Date(info.expires_at);
      if (now > expiresAt) {
        this.deleteExtraction(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired extractions`);
    }
  }

  createExtraction(): { id: string; path: string; expiresAt: Date } {
    const id = uuidv4();
    const tempDir = path.join(UPLOAD_DIR, id);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + FILE_EXPIRATION_HOURS * 60 * 60 * 1000);

    ensureDirectoryExists(tempDir);

    const extractionInfo: ExtractionInfo = {
      path: tempDir,
      expires_at: expiresAt.toISOString(),
      status: 'starting',
      created_at: now.toISOString(),
      base_url: '',
    };

    this.extractions.set(id, extractionInfo);

    logger.info(`Created extraction ${id}`, { expiresAt: expiresAt.toISOString() });

    return { id, path: tempDir, expiresAt };
  }

  getExtraction(id: string): ExtractionInfo | undefined {
    return this.extractions.get(id);
  }

  updateExtraction(id: string, updates: Partial<ExtractionInfo>): void {
    const existing = this.extractions.get(id);
    if (existing) {
      this.extractions.set(id, { ...existing, ...updates });
    }
  }

  deleteExtraction(id: string): boolean {
    const info = this.extractions.get(id);
    if (info) {
      cleanupDirectory(info.path);
      this.extractions.delete(id);
      logger.info(`Deleted extraction ${id}`);
      return true;
    }
    return false;
  }

  getExtractions(): Array<{ id: string; info: ExtractionInfo }> {
    return Array.from(this.extractions.entries()).map(([id, info]) => ({ id, info }));
  }

  getLimits(): ZipLimits {
    return ZIP_LIMITS;
  }

  getUploadDir(): string {
    return UPLOAD_DIR;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clean up all extractions
    for (const [id] of this.extractions.entries()) {
      this.deleteExtraction(id);
    }
  }
}

export const fileStorageService = new FileStorageService();
