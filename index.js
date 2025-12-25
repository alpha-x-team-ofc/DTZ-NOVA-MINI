const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 8000;
global.__path = process.cwd();

// Increase event listeners
require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__path));

// Import routes
const pairRoute = require('./pair');

// Routes
app.use('/code', pairRoute);
app.use('/pair', (req, res) => {
    res.sendFile(path.join(__path, 'pair.html'));
});
app.use('/', (req, res) => {
    res.sendFile(path.join(__path, 'main.html'));
});

// Create required directories and files
const initFiles = () => {
    // Create directories
    const dirs = ['./session', './temp'];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created directory: ${dir}`);
        }
    });
    
    // Create required files
    const files = [
        { path: './admin.json', content: '["94752978237"]' },
        { path: './numbers.json', content: '[]' },
        { path: './anuwh.jpg', createIfMissing: true }
    ];
    
    files.forEach(file => {
        if (!fs.existsSync(file.path) && file.content) {
            fs.writeFileSync(file.path, file.content);
            console.log(`Created file: ${file.path}`);
        }
    });
};

// Initialize files
initFiles();

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ 
        error: 'Internal Server Error', 
        message: err.message 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not Found', 
        message: 'Route not found' 
    });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║        DTZ NOVA X MD WHATSAPP BOT           ║
║                                              ║
╠══════════════════════════════════════════════╣
║                                              ║
║   ✅ Server is running on port: ${PORT}       ║
║   🌐 Local: http://localhost:${PORT}          ║
║   🌐 Network: http://0.0.0.0:${PORT}          ║
║                                              ║
║   🔗 Endpoints:                              ║
║   • /code?number=XXXXXXXXXX                  ║
║   • /pair                                    ║
║   • /                                        ║
║                                              ║
╚══════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Terminating server...');
    server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
    });
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
