import 'dotenv/config';
import { buildServer } from './server.js';
import { createLogger } from './lib/logger.js';

const logger = createLogger('App');

async function start() {
  try {
    const server = await buildServer();

    const port = parseInt(process.env.PORT || '7860', 10);
    const host = process.env.HOST || '0.0.0.0';

    await server.listen({ port, host });

    logger.info(`Server listening on ${host}:${port}`);
    logger.info('Available endpoints:');
    logger.info('  GET  /api/health - Health check');
    logger.info('  POST /api/zip/extract - Download and extract ZIP');
    logger.info('  DELETE /api/zip/cleanup/:id - Clean up extraction');
    logger.info('  GET  /api/zip/browse/:id - Browse extracted files');
    logger.info('  GET  /api/zip/download/:id/:file - Download specific file');
    logger.info('  POST /webhooks/trigger/:scriptName - Trigger script via webhook');
    logger.info('  GET  /webhooks/scripts - List available scripts');
  } catch (error) {
    logger.error('Failed to start server', { error, message: error instanceof Error ? error.message : 'Unknown error' });
    console.error('Detailed error:', error);
    process.exit(1);
  }
}

start();
