import subprocess
import threading
import time
import os
from flask import Flask, jsonify, request
import signal
import sys

app = Flask(__name__)

# Global variable to track the Node.js process
node_process = None

def run_telegram_listener():
    """Run the Node.js Telegram listener"""
    global node_process
    try:
        # Start the Node.js process with UTF-8 encoding
        node_process = subprocess.Popen(['node', 'index.js'], 
                                      stdout=subprocess.PIPE, 
                                      stderr=subprocess.STDOUT,
                                      text=True,
                                      bufsize=1,
                                      universal_newlines=True,
                                      encoding='utf-8',
                                      errors='replace')
        
        # Print output in real-time
        for line in iter(node_process.stdout.readline, ''):
            if line.strip():
                # Fix encoding issues by replacing problematic characters
                clean_line = line.encode('utf-8', errors='replace').decode('utf-8')
                print(f"[Telegram] {clean_line.strip()}")
                sys.stdout.flush()
                
    except Exception as e:
        print(f"Error starting Telegram listener: {e}")
    finally:
        if node_process:
            node_process.terminate()

@app.route('/')
def home():
    """Home endpoint"""
    return jsonify({
        "status": "running",
        "message": "Telegram Webhook Listener is running",
        "endpoints": {
            "/": "Status endpoint",
            "/logs": "View logs",
            "/restart": "Restart the listener"
        }
    })

@app.route('/logs')
def logs():
    """Return recent logs"""
    return jsonify({
        "status": "logs endpoint - check console for real-time logs",
        "message": "Logs are being printed to console"
    })

@app.route('/restart', methods=['POST'])
def restart():
    """Restart the Telegram listener"""
    global node_process
    try:
        if node_process:
            node_process.terminate()
            node_process.wait(timeout=5)
        
        # Start new process
        thread = threading.Thread(target=run_telegram_listener, daemon=True)
        thread.start()
        
        return jsonify({"status": "restarted", "message": "Telegram listener restarted"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy"})

def signal_handler(sig, frame):
    """Handle shutdown signals"""
    print('Shutting down...')
    global node_process
    if node_process:
        node_process.terminate()
    sys.exit(0)

if __name__ == '__main__':
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start the Telegram listener in a background thread
    thread = threading.Thread(target=run_telegram_listener, daemon=True)
    thread.start()
    
    # Start Flask app
    port = int(os.environ.get('PORT', 7860))
    app.run(host='0.0.0.0', port=port)
