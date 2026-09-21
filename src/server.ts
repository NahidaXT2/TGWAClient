import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createLogger } from './lib/logger.js';
import { healthRoutes } from './routes/api/health.js';
import { webhookRoutes } from './routes/webhooks/script-trigger.js';
import { zipRoutes } from './routes/api/zip.js';
import { downloadRoutes } from './routes/api/download.js';
import { scriptWorker } from './services/script-worker.service.js';
import { exampleScript } from './scripts/example-script.js';

const logger = createLogger('Server');

export async function buildServer() {
  const fastify = Fastify({
    logger: false,
  });

  await fastify.register(cors, {
    origin: true,
  });

  await fastify.register(helmet);

  await fastify.register(healthRoutes, { prefix: '/api' });
  await fastify.register(zipRoutes, { prefix: '/api/zip' });
  await fastify.register(downloadRoutes, { prefix: '/api/zip' });
  await fastify.register(webhookRoutes, { prefix: '/webhooks' });

  scriptWorker.registerScript('example-script', exampleScript);

  fastify.setErrorHandler((error, request, reply) => {
    logger.error('Request error', { error, url: request.url });
    reply.status(error.statusCode || 500).send({
      error: error.message,
      statusCode: error.statusCode || 500,
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
    });
  });

  return fastify;
}
