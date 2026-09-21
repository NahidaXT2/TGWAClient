import { createLogger } from '../lib/logger.js';
import { ScriptResult } from '../types/index.js';

const logger = createLogger('ExampleScript');

export async function exampleScript(data?: any): Promise<ScriptResult> {
  try {
    logger.info('Example script execution started', { data });

    // Simula algún procesamiento
    const processedData = {
      input: data,
      processed: true,
      timestamp: new Date().toISOString(),
      message: 'This is an example script that processes webhook data',
    };

    logger.info('Example script completed successfully', { processedData });

    return {
      success: true,
      message: 'Example script executed successfully',
      data: processedData,
    };
  } catch (error) {
    logger.error('Example script failed', { error });
    return {
      success: false,
      message: 'Example script failed',
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    };
  }
}
