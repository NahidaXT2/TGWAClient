import axios from 'axios';
import yauzl from 'yauzl';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../lib/logger.js';
import { sanitizeFilename, preventDirectoryTraversal, ensureDirectoryExists } from '../lib/file-utils.js';
import { fileStorageService } from './file-storage.service.js';
import { ExtractedFile, ExtractionError } from '../types/zip.types.js';

const logger = createLogger('ZipExtractor');

class ZipExtractorService {
  async downloadZipArchive(url: string, savePath: string): Promise<{ success: boolean; downloadedSize: number }> {
    try {
      if (!url.toLowerCase().endsWith('.zip')) {
        throw { status: 400, message: 'El archivo debe tener extensión .zip' } as ExtractionError;
      }

      ensureDirectoryExists(path.dirname(savePath));

      const limits = fileStorageService.getLimits();

      // Verificar tamaño con solicitud HEAD
      try {
        const headRes = await axios.head(url, { timeout: 10000, maxRedirects: 3 });
        const contentLength = parseInt((headRes.headers['content-length'] as string) || '0', 10);
        if (contentLength > limits.max_file_size) {
          throw {
            status: 400,
            message: `El archivo es demasiado grande. Tamaño máximo: ${(limits.max_file_size / (1024 * 1024)).toFixed(1)}MB`,
          } as ExtractionError;
        }
      } catch (headErr) {
        const error = headErr as ExtractionError;
        if (error.status) throw error;
        // Si falla HEAD, se continúa con el GET
      }

      // Descargar usando streaming
      const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        timeout: 300000,
        maxRedirects: 3,
      });

      if (response.status !== 200) {
        throw {
          status: 400,
          message: `Error al descargar el archivo. Código: ${response.status}`,
        } as ExtractionError;
      }

      let downloadedSize = 0;
      const writer = fs.createWriteStream(savePath);

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length;
          if (downloadedSize > limits.max_file_size) {
            writer.destroy();
            if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
            reject({
              status: 400,
              message: 'El archivo excede el tamaño máximo durante la descarga',
            } as ExtractionError);
          }
        });

        response.data.pipe(writer);

        writer.on('finish', () => resolve({ success: true, downloadedSize }));
        writer.on('error', (err: Error) =>
          reject({
            status: 400,
            message: `Error guardando archivo: ${err.message}`,
          } as ExtractionError),
        );
      });
    } catch (err) {
      const error = err as ExtractionError;
      if (error.status) throw error;
      return { success: false, downloadedSize: 0 };
    }
  }

  extractZipStreaming(
    zipPath: string,
    extractTo: string,
    baseUrl: string,
    // password: string | null = null, // Password support not implemented in yauzl
  ): Promise<{ fileUrls: ExtractedFile[]; totalSize: number }> {
    return new Promise((resolve, reject) => {
      ensureDirectoryExists(extractTo);

      const limits = fileStorageService.getLimits();

      yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, strictFileNames: false }, (err, zipfile) => {
        if (err) {
          return reject({
            status: 400,
            message: `El archivo no es un ZIP válido: ${err.message}`,
          } as ExtractionError);
        }

        const fileUrls: ExtractedFile[] = [];
        let totalFiles = 0;
        let totalSize = 0;
        let totalUncompressed = 0;

        zipfile.readEntry();

        zipfile.on('entry', (entry) => {
          // Omitir directorios
          if (/\/$/.test(entry.fileName)) {
            zipfile.readEntry();
            return;
          }

          totalUncompressed += entry.uncompressedSize;
          if (totalUncompressed > limits.max_extraction_size) {
            zipfile.close();
            return reject({
              status: 400,
              message: `El tamaño total de extracción excede el límite de ${(limits.max_extraction_size / (1024 * 1024)).toFixed(1)}MB`,
            } as ExtractionError);
          }

          totalFiles++;
          if (totalFiles > limits.max_files) {
            zipfile.close();
            return reject({
              status: 400,
              message: `Se excedió el número máximo de archivos permitidos (${limits.max_files})`,
            } as ExtractionError);
          }

          const safeFilename = sanitizeFilename(entry.fileName);
          const filePath = path.resolve(extractTo, safeFilename);

          // Prevención de Directory Traversal
          if (preventDirectoryTraversal(extractTo, safeFilename)) {
            logger.warn(`Directory traversal attempt detected: ${entry.fileName}`);
            zipfile.readEntry();
            return;
          }

          ensureDirectoryExists(path.dirname(filePath));

          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr) {
              zipfile.close();
              return reject({
                status: 400,
                message: `Error leyendo archivo ZIP: ${streamErr.message}`,
              } as ExtractionError);
            }

            const writeStream = fs.createWriteStream(filePath);
            readStream.pipe(writeStream);

            writeStream.on('finish', () => {
              fs.chmodSync(filePath, 0o644);
              const stats = fs.statSync(filePath);
              const fileSize = stats.size;
              totalSize += fileSize;

              const cleanFileName = safeFilename.replace('#', '%23').replace(/ /g, '%20');
              const parentDir = path.basename(path.dirname(extractTo));

              fileUrls.push({
                filename: safeFilename,
                original_filename: entry.fileName,
                size: fileSize,
                path: safeFilename,
                url: baseUrl ? `${baseUrl}/api/zip/download/${parentDir}/${cleanFileName}` : null,
              });

              zipfile.readEntry();
            });

            writeStream.on('error', (wErr: Error) => {
              zipfile.close();
              reject({
                status: 500,
                message: `Error escribiendo archivo: ${wErr.message}`,
              } as ExtractionError);
            });
          });
        });

        zipfile.on('end', () => {
          resolve({ fileUrls, totalSize });
        });

        zipfile.on('error', (zErr: Error) => {
          reject({
            status: 400,
            message: `Error procesando ZIP: ${zErr.message}`,
          } as ExtractionError);
        });
      });
    });
  }

  async extractFromUrl(url: string, baseUrl: string = ''): Promise<{
    extractionId: string;
    fileUrls: ExtractedFile[];
    totalSize: number;
    downloadedSize: number;
  }> {
    const { id, path: tempDir, expiresAt } = fileStorageService.createExtraction();

    fileStorageService.updateExtraction(id, {
      base_url: baseUrl,
    });

    try {
      fileStorageService.updateExtraction(id, { status: 'downloading', started_at: new Date().toISOString() });

      const zipPath = path.join(tempDir, 'archive.zip');
      const { success, downloadedSize } = await this.downloadZipArchive(url, zipPath);

      if (!success) {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        throw {
          status: 400,
          message: 'No se pudo descargar el archivo desde la URL proporcionada',
        } as ExtractionError;
      }

      fileStorageService.updateExtraction(id, {
        status: 'extracting',
        downloaded_size: downloadedSize,
      });

      const extractDir = path.join(tempDir, 'extracted');
      const { fileUrls, totalSize } = await this.extractZipStreaming(zipPath, extractDir, baseUrl);

      fileStorageService.updateExtraction(id, {
        status: 'completed',
        file_count: fileUrls.length,
        total_size: totalSize,
        completed_at: new Date().toISOString(),
        extraction_successful: true,
      });

      // Remove the zip file after extraction
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

      logger.info(`Extraction ${id} completed successfully`, {
        fileCount: fileUrls.length,
        totalSize,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        extractionId: id,
        fileUrls,
        totalSize,
        downloadedSize,
      };
    } catch (err) {
      const error = err as ExtractionError;
      fileStorageService.deleteExtraction(id);
      throw error;
    }
  }
}

export const zipExtractorService = new ZipExtractorService();
