import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HealthResponse } from '../../types/index.js';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const uptime = process.uptime();
    const response: HealthResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime,
      version: process.env.npm_package_version || '1.0.0',
    };

    return reply.send(response);
  });
}
