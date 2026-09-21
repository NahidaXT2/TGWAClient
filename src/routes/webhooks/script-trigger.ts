import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { scriptWorker } from '../../services/script-worker.service.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('WebhookRoutes');

interface ScriptTriggerParams {
  scriptName: string;
}

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post('/trigger/:scriptName', async (request: FastifyRequest<{ Params: ScriptTriggerParams }>, reply: FastifyReply) => {
    const { scriptName } = request.params;
    const data = request.body;

    logger.info(`Webhook received for script: ${scriptName}`, { data });

    const result = await scriptWorker.executeScript(scriptName, data);

    if (result.success) {
      return reply.send(result);
    } else {
      return reply.status(400).send(result);
    }
  });

  fastify.get('/scripts', async (_request: FastifyRequest, reply: FastifyReply) => {
    const availableScripts = scriptWorker.getAvailableScripts();
    return reply.send({
      scripts: availableScripts,
      count: availableScripts.length,
    });
  });
}
