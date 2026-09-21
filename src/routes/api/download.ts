import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';
import { fileStorageService } from '../../services/file-storage.service.js';
import { preventDirectoryTraversal } from '../../lib/file-utils.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('DownloadRoutes');

interface DownloadParams {
  extraction_id: string;
  '*': string;
}

export async function downloadRoutes(fastify: FastifyInstance) {
  // GET /api/zip/download/:extraction_id/* - Download specific file
  fastify.get<{ Params: DownloadParams }>(
    '/download/:extraction_id/*',
    async (request: FastifyRequest<{ Params: DownloadParams }>, reply: FastifyReply) => {
      const { extraction_id, '*': filePath } = request.params;

      const info = fileStorageService.getExtraction(extraction_id);
      if (!info) {
        return reply.status(404).send({ detail: 'ID de extracción no encontrado' });
      }

      const extractDir = path.join(info.path, 'extracted');
      const fullPath = path.resolve(extractDir, filePath);

      // Prevención Directory Traversal
      if (preventDirectoryTraversal(extractDir, filePath)) {
        logger.warn(`Directory traversal attempt detected: ${filePath}`, { extraction_id });
        return reply.status(400).send({ detail: 'Ruta de archivo inválida' });
      }

      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        return reply.status(404).send({ detail: 'Archivo no encontrado' });
      }

      const fileName = path.basename(fullPath);
      logger.info(`File download requested: ${fileName}`, { extraction_id, filePath });

      const fileStream = fs.createReadStream(fullPath);
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      reply.header('Content-Type', 'application/octet-stream');
      return reply.send(fileStream);
    },
  );
}
