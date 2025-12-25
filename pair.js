const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();

const { 
    default: makeWASocket, 
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    delay 
} = require('baileys');

const activeSockets = new Map();
const SESSION_BASE_PATH = './sessions';

// Simple logger without pino-pretty
const simpleLogger = {
    level: 'silent', // Change to 'debug' for more logs
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    transport: undefined // Remove pino-pretty
};

// Ensure session directory
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

console.log('✅ DTZ NOVA X MD Pair Router Initialized');

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    
    console.log(`🚀 Starting connection for: ${sanitizedNumber}`);
    
    // Check if already connected
    if (activeSockets.has(sanitizedNumber)) {
        console.log(`⚠️ ${sanitizedNumber} is already connected`);
        if (!res.headersSent) {
            return res.json({
                success: true,
                message: 'Already connected',
                number: sanitizedNumber,
                status: 'connected'
            });
        }
        return;
    }
    
    try {
        // Create session directory
        fs.ensureDirSync(sessionPath);
        
        // Initialize auth state
        console.log(`📁 Loading auth state from: ${sessionPath}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        
        // Simple logger without pino-pretty
        const logger = {
            trace: () => {},
            debug: (...args) => console.log('[DEBUG]', ...args),
            info: (...args) => console.log('[INFO]', ...args),
            warn: (...args) => console.warn('[WARN]', ...args),
            error: (...args) => console.error('[ERROR]', ...args),
            fatal: (...args) => console.error('[FATAL]', ...args)
        };
        
        // Create WhatsApp socket
        console.log(`🔌 Creating WhatsApp socket for ${sanitizedNumber}`);
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            printQRInTerminal: true, // VERY IMPORTANT - shows QR in console
            logger: logger,
            browser: Browsers.macOS('Safari'),
            markOnlineOnConnect: true,
            syncFullHistory: false
        });
        
        // Store socket
        activeSockets.set(sanitizedNumber, socket);
        
        console.log(`✅ Socket created for ${sanitizedNumber}`);
        
        // Handle credentials update
        socket.ev.on('creds.update', async () => {
            console.log(`💾 Saving credentials for ${sanitizedNumber}`);
            await saveCreds();
        });
        
        // Handle connection updates
        socket.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;
            
            console.log(`📡 Connection update for ${sanitizedNumber}: ${connection}`);
            
            // QR Code
            if (qr) {
                console.log(`📱 QR Code received for ${sanitizedNumber}`);
                console.log(`QR: ${qr}`);
                
                if (!res.headersSent) {
                    res.json({
                        success: true,
                        type: 'qr',
                        qr: qr,
                        number: sanitizedNumber,
                        message: 'Scan this QR code with WhatsApp'
                    });
                }
            }
            
            // Connected
            if (connection === 'open') {
                console.log(`🎉 WHATSAPP CONNECTED SUCCESSFULLY: ${sanitizedNumber}`);
                console.log(`👤 User ID: ${socket.user?.id}`);
                console.log(`🏷️ User Name: ${socket.user?.name}`);
                
                try {
                    // Send welcome message
                    const userJid = socket.user.id;
                    await socket.sendMessage(userJid, {
                        text: `🎉 *DTZ NOVA X MD CONNECTED!*\n\n✅ Number: ${sanitizedNumber}\n🤖 Bot: DTZ NOVA X MD\n👑 Owner: Dulina Nethmiura\n📅 ${new Date().toLocaleString()}\n\nType .menu for commands`
                    });
                    console.log(`📨 Welcome message sent to ${sanitizedNumber}`);
                } catch (msgError) {
                    console.log(`📨 Message error: ${msgError.message}`);
                }
                
                if (!res.headersSent) {
                    res.json({
                        success: true,
                        type: 'connected',
                        number: sanitizedNumber,
                        message: 'WhatsApp connected successfully!'
                    });
                }
            }
            
            // Disconnected
            if (connection === 'close') {
                console.log(`❌ Disconnected: ${sanitizedNumber}`);
                activeSockets.delete(sanitizedNumber);
                
                // Auto reconnect after 5 seconds
                setTimeout(async () => {
                    console.log(`🔄 Attempting to reconnect ${sanitizedNumber}`);
                    const mockRes = {
                        headersSent: false,
                        json: () => {},
                        status: () => ({ json: () => {} })
                    };
                    await EmpirePair(sanitizedNumber, mockRes);
                }, 5000);
            }
        });
        
        // If already registered, it will connect automatically
        if (state.creds.registered) {
            console.log(`📱 Already registered: ${sanitizedNumber}, waiting for connection...`);
            
            if (!res.headersSent) {
                res.json({
                    success: true,
                    type: 'already_registered',
                    number: sanitizedNumber,
                    message: 'Session exists, connecting...'
                });
            }
        } else {
            // Request pairing code
            try {
                console.log(`🔐 Requesting pairing code for ${sanitizedNumber}`);
                const pairingCode = await socket.requestPairingCode(sanitizedNumber);
                console.log(`✅ Pairing code received: ${pairingCode}`);
                
                if (!res.headersSent) {
                    res.json({
                        success: true,
                        type: 'pairing_code',
                        code: pairingCode,
                        number: sanitizedNumber,
                        message: 'Enter this code in WhatsApp',
                        instructions: 'WhatsApp → Settings → Linked Devices → Link a Device → Link with Phone Number'
                    });
                }
            } catch (pairError) {
                console.error(`❌ Pairing code error: ${pairError.message}`);
                
                // Fallback: Show QR code instead
                console.log(`🔄 Falling back to QR code method`);
                
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        error: 'Pairing code failed, use QR code instead',
                        tip: 'Check terminal for QR code'
                    });
                }
            }
        }
        
    } catch (error) {
        console.error(`❌ EmpirePair Error for ${sanitizedNumber}:`, error.message);
        console.error('Full error:', error);
        
        // Clean up
        activeSockets.delete(sanitizedNumber);
        
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Connection failed',
                message: error.message,
                tip: 'Check if number is valid WhatsApp number'
            });
        }
    }
}

// ROUTES
router.get('/', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({
            success: false,
            error: 'Number parameter is required',
            example: '/code?number=94712345678'
        });
    }
    
    console.log(`📞 Pair request received for: ${number}`);
    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.json({
        success: true,
        activeSockets: Array.from(activeSockets.keys()),
        count: activeSockets.size,
        bot: 'DTZ NOVA X MD'
    });
});

router.get('/ping', (req, res) => {
    res.json({
        success: true,
        message: 'DTZ NOVA X MD is running',
        timestamp: new Date().toISOString(),
        status: 'online'
    });
});

module.exports = router;
