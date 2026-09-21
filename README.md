---
title: Tools
emoji: 🐠
colorFrom: gray
colorTo: red
sdk: docker
pinned: false
---

# Node.js Tools Space for n8n Integration

This Space provides a Node.js + TypeScript server optimized for n8n integrations with REST APIs, webhook-triggered scripts, and ZIP file extraction capabilities.

## Features

- **REST API Endpoints**: Classic REST APIs for direct integration with n8n
- **Webhook Triggers**: Execute background scripts via webhooks from n8n
- **ZIP Extraction**: Download and extract ZIP files from URLs with security limits
- **TypeScript**: Type-safe development with modern JavaScript
- **Fastify**: High-performance HTTP framework with excellent TypeScript support
- **Modular Architecture**: Easy to add new tools and scripts
- **API Key Authentication**: Optional API key protection for sensitive endpoints

## Available Endpoints

### Health Check
```
GET /api/health
```
Returns server status, uptime, and version information.

### ZIP Extraction

#### Extract ZIP from URL
```
POST /api/zip/extract?url_to_unzip=<URL>
```
Downloads and extracts a ZIP file from a URL. Requires API key authentication (unless in development mode).

**Limits:**
- Max file size: 500MB
- Max extraction size: 1GB
- Max files: 1000
- File expiration: 24 hours

**Example:**
```bash
curl -X POST "https://your-space.hf.space/api/zip/extract?url_to_unzip=https://example.com/file.zip" \
  -H "x-api-key: your-api-key"
```

**Response:**
```json
{
  "status": "success",
  "extraction_id": "uuid",
  "files": [
    {
      "filename": "file.txt",
      "original_filename": "file.txt",
      "size": 1024,
      "path": "file.txt",
      "url": "https://your-space.hf.space/api/zip/download/uuid/file.txt"
    }
  ],
  "file_count": 1,
  "total_size": 1024,
  "downloaded_size": 2048,
  "delete_url": "https://your-space.hf.space/api/zip/cleanup/uuid",
  "expires_at": "2026-09-22T19:00:00.000Z",
  "limits": {
    "max_file_size_mb": 500,
    "max_extraction_size_mb": 1024,
    "max_files": 1000
  }
}
```

#### Clean Up Extraction
```
DELETE /api/zip/cleanup/:extraction_id
```
Deletes temporary files for a specific extraction. Requires API key authentication.

#### Browse Extracted Files
```
GET /api/zip/browse/:extraction_id
```
Returns a list of files in an extraction for browsing.

#### Download Specific File
```
GET /api/zip/download/:extraction_id/:file_path
```
Downloads a specific file from an extraction.

### Webhook Script Trigger
```
POST /webhooks/trigger/:scriptName
```
Triggers a specific script via webhook. The script name should be passed as a URL parameter.

**Example:**
```bash
curl -X POST https://your-space.hf.space/webhooks/trigger/example-script \
  -H "Content-Type: application/json" \
  -d '{"data": "your data here"}'
```

### List Available Scripts
```
GET /webhooks/scripts
```
Returns a list of all registered scripts that can be triggered via webhooks.

## Architecture

```
src/
├── index.ts              # Entry point
├── server.ts             # Server configuration
├── routes/               # API endpoints
│   ├── api/             # REST API routes
│   │   ├── health.ts    # Health check
│   │   ├── zip.ts       # ZIP extraction endpoints
│   │   └── download.ts  # File download endpoints
│   └── webhooks/        # Webhook routes
│       └── script-trigger.ts
├── services/            # Business logic
│   ├── script-worker.service.ts  # Script execution engine
│   ├── zip-extractor.service.ts  # ZIP extraction logic
│   └── file-storage.service.ts   # File storage management
├── scripts/             # Background scripts
│   └── example-script.ts
├── lib/                 # Shared utilities
│   ├── logger.ts
│   ├── file-utils.ts
│   └── auth-middleware.ts
└── types/               # TypeScript types
    ├── index.ts
    └── zip.types.ts
```

## Adding New Scripts

1. Create a new script in `src/scripts/`:
```typescript
import { createLogger } from '../lib/logger.js';
import { ScriptResult } from '../types/index.js';

const logger = createLogger('YourScript');

export async function yourScript(data?: any): Promise<ScriptResult> {
  try {
    // Your script logic here
    return {
      success: true,
      message: 'Script executed successfully',
      data: { /* your results */ },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Script failed',
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    };
  }
}
```

2. Register the script in `src/server.ts`:
```typescript
import { yourScript } from './scripts/your-script.js';

// In buildServer function:
scriptWorker.registerScript('your-script', yourScript);
```

3. Trigger via webhook:
```bash
POST /webhooks/trigger/your-script
```

## Development

### Local Development
```bash
# Install dependencies
npm install

# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Type checking
npm run type-check
```

### Docker Build
```bash
docker build -t tools-space .
docker run -p 7860:7860 tools-space
```

## Configuration

### Environment Variables

- `PORT`: Server port (default: 7860)
- `HOST`: Server host (default: 0.0.0.0)
- `API_KEYS`: Comma-separated list of API keys for authentication (optional, disables auth if empty)
- `UPLOAD_DIR`: Directory for temporary file storage (default: /tmp/zip-extractor)
- `MAX_FILE_SIZE`: Maximum file size in bytes (default: 524288000 = 500MB)
- `MAX_EXTRACTION_SIZE`: Maximum extraction size in bytes (default: 1073741824 = 1GB)
- `MAX_FILES`: Maximum number of files (default: 1000)
- `FILE_EXPIRATION_HOURS`: File expiration time in hours (default: 24)

### Hugging Face Spaces Configuration

The server runs on port 7860 by default (Hugging Face Spaces standard). Files are stored temporarily and will be lost when the Space restarts.

## n8n Integration

### Using Webhook Trigger Node
1. Add a Webhook node in n8n
2. Set method to POST
3. Set URL to: `https://your-space.hf.space/webhooks/trigger/your-script`
4. Send any data in the request body
5. The script will execute and return results

### Using HTTP Request Node for ZIP Extraction
1. Add an HTTP Request node in n8n
2. Set method to POST
3. Set URL to: `https://your-space.hf.space/api/zip/extract?url_to_unzip=<URL>`
4. Add header: `x-api-key: your-api-key` (if configured)
5. Use the returned file URLs for further processing

### Using HTTP Request Node for Health Check
1. Add an HTTP Request node in n8n
2. Set method to GET
3. Set URL to: `https://your-space.hf.space/api/health`
4. Use for health checks or API calls

## Security Features

- **API Key Authentication**: Optional protection for sensitive endpoints
- **File Size Limits**: Prevents excessive resource usage
- **Directory Traversal Prevention**: Protects against path traversal attacks
- **File Expiration**: Automatic cleanup of old files
- **Input Validation**: Comprehensive validation of URLs and file paths

## License

MIT
