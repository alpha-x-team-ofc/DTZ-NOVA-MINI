const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 8000;

global.__path = process.cwd();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__path));

// Create required directories
if (!fs.existsSync('./session')) {
    fs.mkdirSync('./session', { recursive: true });
}

if (!fs.existsSync('./admin.json')) {
    fs.writeFileSync('./admin.json', JSON.stringify(["94752978237"]));
}

if (!fs.existsSync('./numbers.json')) {
    fs.writeFileSync('./numbers.json', JSON.stringify([]));
}

// Import routes
const pairRoute = require('./pair');
app.use('/code', pairRoute);

app.get('/pair', (req, res) => {
    res.sendFile(path.join(__path, 'pair.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__path, 'main.html'));
});

app.get('/ping', (req, res) => {
    res.json({ status: 'active', message: 'Server is running' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════╗
║      DTZ NOVA X MD BOT            ║
╠════════════════════════════════════╣
║                                    ║
║  ✅ Server running on port: ${PORT} ║
║  🔗 http://0.0.0.0:${PORT}          ║
║                                    ║
╚════════════════════════════════════╝
`);
    
    console.log('\n📱 WAITING FOR WHATSAPP CONNECTION...');
    console.log('📲 Open http://your-render-url/code?number=YOUR_NUMBER');
});

module.exports = app;
