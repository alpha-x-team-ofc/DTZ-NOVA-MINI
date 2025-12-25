const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

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

if (!fs.existsSync('./session')) {
    fs.mkdirSync('./session', { recursive: true });
}

if (!fs.existsSync('./admin.json')) {
    fs.writeFileSync('./admin.json', JSON.stringify(["94752978237"]));
}

if (!fs.existsSync('./numbers.json')) {
    fs.writeFileSync('./numbers.json', JSON.stringify([]));
}

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║        DTZ NOVA X MD WHATSAPP BOT           ║
║                                              ║
╠══════════════════════════════════════════════╣
║                                              ║
║   ✅ Server running on port: ${PORT}         ║
║   🌐 Local: http://localhost:${PORT}        ║
║   🌐 Network: http://0.0.0.0:${PORT}        ║
║                                              ║
╚══════════════════════════════════════════════╝
    `);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

module.exports = app;
