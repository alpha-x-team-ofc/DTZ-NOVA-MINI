const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const qrcode = require('qrcode-terminal');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const sessions = new Map();

async function startWhatsAppSession(number) {
    const sessionId = number.replace(/\D/g, '');
    const sessionDir = path.join(__dirname, 'session', sessionId);
    
    console.log(`🔄 Starting WhatsApp session for: ${sessionId}`);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            defaultQueryTimeoutMs: 60000
        });
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log(`\n📱 QR Code for ${sessionId}:`);
                qrcode.generate(qr, { small: true });
            }
            
            if (connection === 'open') {
                console.log(`✅ WhatsApp connected: ${sessionId}`);
                console.log(`👤 User ID: ${sock.user?.id}`);
                
                // Send welcome message
                sock.sendMessage(`${sessionId}@s.whatsapp.net`, {
                    text: `✅ DTZ NOVA X MD Bot connected!\n\nYour number: ${sessionId}\nType .menu for commands`
                });
                
                // Notify admin
                const admin = "94752978237";
                sock.sendMessage(`${admin}@s.whatsapp.net`, {
                    text: `📱 New connection: ${sessionId}`
                });
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`❌ Connection closed for ${sessionId}. Reconnect: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    console.log(`🔄 Reconnecting ${sessionId} in 5 seconds...`);
                    setTimeout(() => startWhatsAppSession(number), 5000);
                } else {
                    console.log(`🗑️ Session ended for ${sessionId}`);
                    sessions.delete(sessionId);
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message) return;
            
            const from = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            
            console.log(`📨 Message from ${from}: ${text}`);
            
            if (text.startsWith('.')) {
                const command = text.slice(1).toLowerCase();
                
                if (command === 'ping' || command === 'alive') {
                    await sock.sendMessage(from, { text: '🏓 Pong! DTZ NOVA X MD is alive!' });
                } else if (command === 'menu') {
                    const menu = `
*DTZ NOVA X MD MENU*

🔹 .ping - Check if bot is alive
🔹 .menu - Show this menu
🔹 .owner - Contact owner
🔹 .delete - Delete your session

🤖 _Powered by DTZ NOVA X MD_
                    `;
                    await sock.sendMessage(from, { text: menu });
                } else if (command === 'owner') {
                    await sock.sendMessage(from, { text: '👑 Owner: +94752978237\n💬 Contact for support' });
                } else if (command === 'delete') {
                    await sock.sendMessage(from, { text: '🗑️ Deleting your session...' });
                    sessions.delete(sessionId);
                    await fs.remove(sessionDir);
                    await sock.logout();
                    await sock.sendMessage(from, { text: '✅ Session deleted successfully!' });
                }
            }
        });
        
        sessions.set(sessionId, sock);
        return { success: true, sessionId };
        
    } catch (error) {
        console.error(`❌ Error starting session for ${sessionId}:`, error);
        return { success: false, error: error.message };
    }
}

router.get('/', async (req, res) => {
    try {
        const { number } = req.query;
        
        if (!number) {
            return res.json({
                success: false,
                message: 'Please provide a number: /code?number=94712345678'
            });
        }
        
        const sessionId = number.replace(/\D/g, '');
        
        if (sessionId.length < 10) {
            return res.json({
                success: false,
                message: 'Invalid number format. Use country code without +'
            });
        }
        
        // Check if already connected
        if (sessions.has(sessionId)) {
            return res.json({
                success: true,
                message: 'Already connected to WhatsApp',
                number: sessionId,
                connected: true
            });
        }
        
        // Start new session
        const result = await startWhatsAppSession(sessionId);
        
        if (result.success) {
            // Save to numbers.json
            let numbers = [];
            if (fs.existsSync('./numbers.json')) {
                numbers = JSON.parse(fs.readFileSync('./numbers.json', 'utf8'));
            }
            if (!numbers.includes(sessionId)) {
                numbers.push(sessionId);
                fs.writeFileSync('./numbers.json', JSON.stringify(numbers, null, 2));
            }
            
            return res.json({
                success: true,
                message: 'WhatsApp session started. Scan QR code in terminal.',
                number: sessionId,
                qr: true
            });
        } else {
            return res.json({
                success: false,
                message: 'Failed to start session',
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('API Error:', error);
        return res.json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

router.get('/active', (req, res) => {
    res.json({
        success: true,
        count: sessions.size,
        sessions: Array.from(sessions.keys())
    });
});

router.get('/reconnect', async (req, res) => {
    try {
        let numbers = [];
        if (fs.existsSync('./numbers.json')) {
            numbers = JSON.parse(fs.readFileSync('./numbers.json', 'utf8'));
        }
        
        const results = [];
        for (const number of numbers) {
            if (!sessions.has(number)) {
                const result = await startWhatsAppSession(number);
                results.push({ number, success: result.success });
                await delay(1000);
            }
        }
        
        res.json({
            success: true,
            reconnected: results.filter(r => r.success).length,
            results
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

module.exports = router;
