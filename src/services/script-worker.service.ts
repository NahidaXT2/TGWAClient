import { createLogger } from '../lib/logger.js';
import { ScriptResult } from '../types/index.js';

const logger = createLogger('ScriptWorker');

export type ScriptFunction = (data?: any) => Promise<ScriptResult>;

class ScriptWorker {
  private scripts: Map<string, ScriptFunction> = new Map();

  registerScript(name: string, scriptFn: ScriptFunction): void {
    this.scripts.set(name, scriptFn);
    logger.info(`Script registered: ${name}`);
  }

  async executeScript(scriptName: string, data?: any): Promise<ScriptResult> {
    const script = this.scripts.get(scriptName);

    if (!script) {
      logger.error(`Script not found: ${scriptName}`);
      return {
        success: false,
        message: `Script not found: ${scriptName}`,
        error: 'SCRIPT_NOT_FOUND',
      };
    }

    try {
      logger.info(`Executing script: ${scriptName}`, { data });
      const result = await script(data);
      logger.info(`Script completed: ${scriptName}`, { result });
      return result;
    } catch (error) {
      logger.error(`Script execution failed: ${scriptName}`, { error });
      return {
        success: false,
        message: `Script execution failed: ${scriptName}`,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      };
    }
  }

  getAvailableScripts(): string[] {
    return Array.from(this.scripts.keys());
  }
}

export const scriptWorker = new ScriptWorker();
