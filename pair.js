const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { sms } = require('./msg');

const activeSockets = new Map();
const SESSION_PATH = './session';

// Ensure session directory exists
if (!fs.existsSync(SESSION_PATH)) {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
}

// Load admins from file
function loadAdmins() {
    try {
        if (fs.existsSync('./admin.json')) {
            const data = fs.readFileSync('./admin.json', 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Failed to load admins:', error);
    }
    return [];
}

// Format message for sending
function formatMessage(title, content, footer = 'DTZ NOVA X MD') {
    return `*${title}*\n\n${content}\n\n_${footer}_`;
}

// Create WhatsApp connection
async function createWhatsAppConnection(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionFolder = path.join(SESSION_PATH, `session_${sanitizedNumber}`);
    
    console.log(`📱 Creating connection for: ${sanitizedNumber}`);
    
    try {
        // Create auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
        
        // Get latest version
        const { version } = await fetchLatestBaileysVersion();
        
        // Create socket
        const socket = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: state.keys,
            },
            printQRInTerminal: true,
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            defaultQueryTimeoutMs: 60000
        });
        
        // Store active socket
        activeSockets.set(sanitizedNumber, socket);
        
        // Handle QR code
        socket.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;
            
            // Show QR code in terminal
            if (qr) {
                console.log(`\n📲 QR Code for ${sanitizedNumber}:`);
                qrcode.generate(qr, { small: true });
                
                // Send QR code via API if requested
                if (res && !res.headersSent) {
                    res.json({ 
                        qr: qr,
                        message: 'Scan QR code to connect',
                        number: sanitizedNumber
                    });
                }
            }
            
            // Handle connection
            if (connection === 'open') {
                console.log(`✅ Connected successfully: ${sanitizedNumber}`);
                
                // Save credentials update
                socket.ev.on('creds.update', saveCreds);
                
                // Setup message handler
                socket.ev.on('messages.upsert', async ({ messages }) => {
                    const msg = messages[0];
                    if (!msg.message) return;
                    
                    const m = sms(socket, msg);
                    
                    // Simple command handler
                    if (m.body && m.body.startsWith('.')) {
                        const command = m.body.slice(1).toLowerCase().trim();
                        
                        switch (command) {
                            case 'ping':
                            case 'alive':
                                await m.reply('✅ DTZ NOVA X MD is alive!');
                                break;
                            case 'menu':
                                const menuText = formatMessage(
                                    'DTZ NOVA X MD MENU',
                                    'Available commands:\n\n' +
                                    '• .ping - Check if bot is alive\n' +
                                    '• .menu - Show this menu\n' +
                                    '• .owner - Contact owner\n' +
                                    '• .delete - Delete your session'
                                );
                                await m.reply(menuText);
                                break;
                            case 'owner':
                                await m.reply('👑 Owner: +94752978237\n📢 Contact for support');
                                break;
                            case 'delete':
                                // Delete session
                                if (fs.existsSync(sessionFolder)) {
                                    fs.removeSync(sessionFolder);
                                }
                                activeSockets.delete(sanitizedNumber);
                                await socket.logout();
                                await m.reply('✅ Your session has been deleted');
                                break;
                            default:
                                await m.reply('❌ Unknown command. Type .menu for help');
                        }
                    }
                });
                
                // Send welcome message
                const welcomeMsg = formatMessage(
                    'WELCOME TO DTZ NOVA X MD',
                    `✅ Connected successfully!\n\n` +
                    `📱 Your number: ${sanitizedNumber}\n` +
                    `🤖 Bot is ready to use\n\n` +
                    `Type .menu for commands`
                );
                
                await socket.sendMessage(
                    `${sanitizedNumber}@s.whatsapp.net`,
                    { text: welcomeMsg }
                );
                
                // Notify admins
                const admins = loadAdmins();
                for (const admin of admins) {
                    try {
                        await socket.sendMessage(
                            `${admin}@s.whatsapp.net`,
                            { text: `✅ New connection: ${sanitizedNumber}` }
                        );
                    } catch (error) {
                        console.error(`Failed to notify admin ${admin}:`, error);
                    }
                }
            }
            
            // Handle disconnection
            if (connection === 'close') {
                console.log(`❌ Disconnected: ${sanitizedNumber}`);
                activeSockets.delete(sanitizedNumber);
                
                // Try to reconnect after 5 seconds
                setTimeout(() => {
                    if (!activeSockets.has(sanitizedNumber)) {
                        console.log(`🔄 Attempting to reconnect: ${sanitizedNumber}`);
                        createWhatsAppConnection(number);
                    }
                }, 5000);
            }
        });
        
        // Handle pairing code (for non-QR login)
        if (!state.creds.registered) {
            try {
                const code = await socket.requestPairingCode(sanitizedNumber);
                console.log(`🔑 Pairing code: ${code}`);
                
                if (res && !res.headersSent) {
                    res.json({ 
                        code: code,
                        message: 'Use this code to pair',
                        number: sanitizedNumber
                    });
                }
            } catch (error) {
                console.error('Pairing code error:', error);
                if (res && !res.headersSent) {
                    res.status(500).json({ 
                        error: 'Failed to get pairing code',
                        message: error.message 
                    });
                }
            }
        } else {
            // Already registered
            if (res && !res.headersSent) {
                res.json({ 
                    message: 'Already connected',
                    number: sanitizedNumber,
                    status: 'connected'
                });
            }
        }
        
        return socket;
        
    } catch (error) {
        console.error('Connection error:', error);
        
        if (res && !res.headersSent) {
            res.status(500).json({ 
                error: 'Connection failed',
                message: error.message 
            });
        }
        
        return null;
    }
}

// API Routes
router.get('/', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ 
            error: 'Number is required',
            example: '/code?number=94712345678'
        });
    }
    
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    
    if (sanitizedNumber.length < 10) {
        return res.status(400).json({ 
            error: 'Invalid number format',
            message: 'Number should be at least 10 digits'
        });
    }
    
    // Check if already connected
    if (activeSockets.has(sanitizedNumber)) {
        return res.json({ 
            message: 'Already connected',
            number: sanitizedNumber,
            status: 'connected'
        });
    }
    
    // Create new connection
    await createWhatsAppConnection(sanitizedNumber, res);
});

router.get('/active', (req, res) => {
    res.json({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys()),
        status: 'success'
    });
});

router.get('/ping', (req, res) => {
    res.json({
        status: 'active',
        message: 'DTZ NOVA X MD WhatsApp Bot',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        activeConnections: activeSockets.size
    });
});

router.get('/reconnect', async (req, res) => {
    try {
        // Load numbers from file
        let numbers = [];
        if (fs.existsSync('./numbers.json')) {
            numbers = JSON.parse(fs.readFileSync('./numbers.json', 'utf8'));
        }
        
        const results = [];
        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                await createWhatsAppConnection(number);
                results.push({ number, status: 'reconnecting' });
                await delay(1000); // Delay between reconnections
            } else {
                results.push({ number, status: 'already_connected' });
            }
        }
        
        res.json({
            status: 'success',
            reconnected: results.filter(r => r.status === 'reconnecting').length,
            results: results
        });
        
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

module.exports = router;
