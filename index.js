const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");
const fs = require('fs');
const PORT = process.env.PORT || 8000;

global.__path = process.cwd();

require('events').EventEmitter.defaultMaxListeners = 500;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__path));

const pairRoute = require('./pair');
app.use('/code', pairRoute);

app.use('/pair', (req, res) => {
    res.sendFile(path.join(__path, 'pair.html'));
});

app.use('/', (req, res) => {
    res.sendFile(path.join(__path, 'main.html'));
});

app.get('/api/active', (req, res) => {
    const pair = require('./pair');
    const activeRoute = pair.stack.find(layer => layer.route && layer.route.path === '/active');
    if (activeRoute) {
        return activeRoute.handle(req, res);
    }
    res.json({ count: 0, numbers: [] });
});

app.get('/api/ping', (req, res) => {
    res.json({
        status: 'active',
        message: '👻 DTZ NOVA X FREE BOT is running',
        timestamp: new Date().toISOString()
    });
});

app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(__path, 'main.html'));
});

const directories = ['./session', './temp'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
    }
});

const requiredFiles = ['./admin.json', './numbers.json'];
requiredFiles.forEach(file => {
    if (!fs.existsSync(file)) {
        if (file === './admin.json') {
            fs.writeFileSync(file, JSON.stringify(["94752978237"]));
        } else if (file === './numbers.json') {
            fs.writeFileSync(file, JSON.stringify([]));
        }
        console.log(`Created file: ${file}`);
    }
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║   Don't Forget To Give Star ‼️                ║
║                                              ║
║   𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 DTZ NOVA X MD                   ║
║                                              ║
╠══════════════════════════════════════════════╣
║                                              ║
║   Server running on:                         ║
║   http://0.0.0.0:${PORT}                         ║
║   http://localhost:${PORT}                      ║
║                                              ║
║   API Endpoints:                             ║
║   • /code?number=XXXXXXXXXX                  ║
║   • /api/ping                                ║
║   • /api/active                              ║
║                                              ║
╚══════════════════════════════════════════════╝
    `);
});

process.on('SIGINT', () => {
    console.log('\nShutting down server gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\nTerminating server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
