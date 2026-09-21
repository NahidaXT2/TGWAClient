import { FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from './logger.js';

const logger = createLogger('AuthMiddleware');

const API_KEYS = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];

export async function verifyApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (API_KEYS.length === 0) {
    logger.debug('No API keys configured, skipping authentication (development mode)');
    return;
  }

  const apiKey = request.headers['x-api-key'] as string;

  if (!apiKey || !API_KEYS.includes(apiKey)) {
    logger.warn('Invalid or missing API key', { ip: request.ip });
    reply.status(401).header('WWW-Authenticate', 'Bearer').send({
      detail: 'Clave API inválida o faltante',
    });
    return;
  }

  logger.debug('API key validated successfully');
}
