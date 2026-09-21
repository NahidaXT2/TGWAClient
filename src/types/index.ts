export interface WebhookPayload {
  scriptName: string;
  data?: any;
  timestamp?: string;
}

export interface ScriptResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export * from './zip.types.js';
