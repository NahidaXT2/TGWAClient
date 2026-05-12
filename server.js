import express from 'express';
import { spawn } from 'child_process';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 7860;

// Global variable to track the Node.js process
let telegramProcess = null;

function startTelegramListener() {
    if (telegramProcess) {
        telegramProcess.kill();
    }

    telegramProcess = spawn('node', ['index.js'], {
        stdio: 'inherit',
        cwd: __dirname
    });

    telegramProcess.on('error', (error) => {
        console.error('Error starting Telegram listener:', error);
    });

    telegramProcess.on('exit', (code) => {
        console.log(`Telegram listener exited with code ${code}`);
    });
}

// Middleware
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        message: 'Telegram Webhook Listener is running'
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

/*app.post('/restart', (req, res) => {
    try {
        startTelegramListener();
        res.json({ status: 'restarted', message: 'Telegram listener restarted' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});*/

// Start the Telegram listener
startTelegramListener();

// Start the Express server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    if (telegramProcess) {
        telegramProcess.kill();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Shutting down...');
    if (telegramProcess) {
        telegramProcess.kill();
    }
    process.exit(0);
});
