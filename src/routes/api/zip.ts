import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';
import { verifyApiKey } from '../../lib/auth-middleware.js';
import { zipExtractorService } from '../../services/zip-extractor.service.js';
import { fileStorageService } from '../../services/file-storage.service.js';
import { getFilesRecursively } from '../../lib/file-utils.js';
import { createLogger } from '../../lib/logger.js';
import { ExtractionResult, BrowseResult } from '../../types/zip.types.js';

const logger = createLogger('ZipRoutes');

interface ExtractQuery {
  url_to_unzip: string;
}

interface CleanupParams {
  extraction_id: string;
}

interface BrowseParams {
  extraction_id: string;
}

export async function zipRoutes(fastify: FastifyInstance) {
  // POST /api/zip/extract - Download and extract ZIP
  fastify.post<{ Querystring: ExtractQuery }>(
    '/extract',
    { preHandler: verifyApiKey },
    async (request: FastifyRequest<{ Querystring: ExtractQuery }>, reply: FastifyReply) => {
      const { url_to_unzip } = request.query;

      if (!url_to_unzip) {
        return reply.status(400).send({ detail: "El parámetro 'url_to_unzip' es requerido" });
      }

      const baseUrl = `${request.protocol}://${request.headers.host}`;
      const limits = fileStorageService.getLimits();

      try {
        const { extractionId, fileUrls, totalSize, downloadedSize } = await zipExtractorService.extractFromUrl(
          url_to_unzip,
          baseUrl,
        );

        const extractionInfo = fileStorageService.getExtraction(extractionId);
        if (!extractionInfo) {
          return reply.status(500).send({ detail: 'Error recuperando información de extracción' });
        }

        const result: ExtractionResult = {
          status: 'success',
          extraction_id: extractionId,
          files: fileUrls,
          file_count: fileUrls.length,
          total_size: totalSize,
          downloaded_size: downloadedSize,
          delete_url: `${baseUrl}/api/zip/cleanup/${extractionId}`,
          expires_at: extractionInfo.expires_at,
          limits: {
            max_file_size_mb: limits.max_file_size / (1024 * 1024),
            max_extraction_size_mb: limits.max_extraction_size / (1024 * 1024),
            max_files: limits.max_files,
          },
        };

        logger.info(`ZIP extraction completed: ${extractionId}`, { fileCount: fileUrls.length, totalSize });

        return reply.send(result);
      } catch (err: any) {
        const statusCode = err.status || 500;
        const detail = err.message || 'Ocurrió un error al procesar el archivo.';
        logger.error('ZIP extraction failed', { error: err, url: url_to_unzip });
        return reply.status(statusCode).send({ detail });
      }
    },
  );

  // DELETE /api/zip/cleanup/:extraction_id - Clean up temporary files
  fastify.delete<{ Params: CleanupParams }>(
    '/cleanup/:extraction_id',
    { preHandler: verifyApiKey },
    async (request: FastifyRequest<{ Params: CleanupParams }>, reply: FastifyReply) => {
      const { extraction_id } = request.params;

      if (!fileStorageService.getExtraction(extraction_id)) {
        return reply.status(404).send({ detail: 'ID de extracción no encontrado' });
      }

      const success = fileStorageService.deleteExtraction(extraction_id);

      if (success) {
        logger.info(`Extraction ${extraction_id} cleaned up`);
        return reply.send({ status: 'success', message: `Extracción ${extraction_id} eliminada` });
      } else {
        return reply.status(500).send({ detail: 'Error al eliminar la extracción' });
      }
    },
  );

  // GET /api/zip/browse/:extraction_id - Browse extracted files
  fastify.get<{ Params: BrowseParams }>(
    '/browse/:extraction_id',
    async (request: FastifyRequest<{ Params: BrowseParams }>, reply: FastifyReply) => {
      const { extraction_id } = request.params;

      const info = fileStorageService.getExtraction(extraction_id);
      if (!info) {
        return reply.status(404).send(`
          <html>
            <body>
              <h2>No extractions found or extraction has expired</h2>
              <p>Please upload a new ZIP file to begin.</p>
            </body>
          </html>
        `);
      }

      const extractDir = path.join(info.path, 'extracted');

      if (!fs.existsSync(extractDir)) {
        return reply.status(404).send({ detail: 'No se encontraron archivos para esta extracción' });
      }

      const files = getFilesRecursively(extractDir, extractDir);
      files.sort((a, b) => a.name.localeCompare(b.name));

      const totalSize = files.reduce((acc, f) => acc + f.size, 0);

      const result: BrowseResult = {
        extraction_id,
        files,
        file_count: files.length,
        total_size: totalSize,
        expires_at: info.expires_at,
      };

      return reply.send(result);
    },
  );
}
