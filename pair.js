const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');

// Baileys imports
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto
} = require('baileys');

const { sms } = require("./msg");

// Configuration
const config = {
    BOT_NAME: 'DTZ NOVA X MD',
    OWNER_NAME: 'Dulina Nethmiura',
    OWNER_NUMBER: '94752978237',
    PREFIX: '.',
    IMAGE_URL: 'https://files.catbox.moe/fpyw9m.png',
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/GYFkafbxbD8JHDCPzXPlIi',
    FIREBASE_URL: 'https://minibotproject2-default-rtdb.asia-southeast1.firebasedatabase.app',
    MAX_RETRIES: 3,
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false'
};

// Global stores
const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './sessions';

// Ensure session directory exists
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// Utility functions
function formatMessage(title, content) {
    return `*${title}*\n\n${content}\n\n> *DTZ NOVA X MD*`;
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

// Load admin list
function loadAdmins() {
    try {
        if (fs.existsSync('./admin.json')) {
            return JSON.parse(fs.readFileSync('./admin.json', 'utf8'));
        }
        return [config.OWNER_NUMBER];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [config.OWNER_NUMBER];
    }
}

// Clean duplicate files
async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await axios.get(`${config.FIREBASE_URL}/session.json`);
        if (!data) return;

        const sessionKeys = Object.keys(data).filter(
            key => key.startsWith(`creds_${sanitizedNumber}`)
        ).sort((a, b) => {
            const timeA = parseInt(a.match(/creds_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.match(/creds_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        if (sessionKeys.length > 1) {
            for (let i = 1; i < sessionKeys.length; i++) {
                await axios.delete(`${config.FIREBASE_URL}/session/${sessionKeys[i].replace('.json', '')}.json`);
                console.log(`Deleted duplicate: ${sessionKeys[i]}`);
            }
        }
    } catch (error) {
        console.error(`Clean duplicate error:`, error.message);
    }
}

// Join group function
async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link');
        return { status: 'failed', error: 'Invalid link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`✅ Joined group: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            console.warn(`Group join failed (${retries} retries left):`, error.message);
            if (retries === 0) {
                return { status: 'failed', error: error.message };
            }
            await delay(2000);
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

// Send admin notification
async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const message = formatMessage(
        '✅ DTZ NOVA X MD CONNECTED',
        `📱 Number: ${number}\nStatus: Connected\nGroup: ${groupResult.status === 'success' ? 'Joined ✅' : 'Failed ❌'}`
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.IMAGE_URL },
                    caption: message
                }
            );
        } catch (error) {
            console.error(`Failed to notify admin ${admin}:`, error.message);
        }
    }
}

// Setup status handlers
function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.key || msg.key.remoteJid !== 'status@broadcast') return;

        try {
            if (config.AUTO_VIEW_STATUS === 'true') {
                await socket.readMessages([msg.key]);
            }
            
            if (config.AUTO_LIKE_STATUS === 'true') {
                const emojis = ['👍', '❤️', '🔥', '😍', '🤩'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await socket.sendMessage(
                    msg.key.remoteJid,
                    { react: { text: randomEmoji, key: msg.key } }
                );
            }
        } catch (error) {
            console.error('Status handler error:', error.message);
        }
    });
}

// Setup command handlers
function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const type = getContentType(msg.message);
        const m = sms(socket, msg);
        const body = m.body || '';
        const sender = msg.key.remoteJid;
        const prefix = config.PREFIX;
        const isCmd = body.startsWith(prefix);
        
        if (!isCmd) return;
        
        const command = body.slice(prefix.length).trim().split(' ')[0].toLowerCase();
        const args = body.slice(prefix.length + command.length).trim().split(' ');
        
        // Helper reply function
        const reply = async (text) => {
            await socket.sendMessage(sender, { text }, { quoted: msg });
        };

        try {
            switch (command) {
                case 'alive':
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = uptime % 60;
                    
                    const aliveText = `*🤖 DTZ NOVA X MD BOT*\n\n` +
                                    `✅ Status: Alive & Running\n` +
                                    `⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s\n` +
                                    `📱 Number: ${number}\n` +
                                    `👑 Owner: ${config.OWNER_NAME}\n` +
                                    `🔧 Prefix: ${config.PREFIX}\n\n` +
                                    `> Powered by Dulina Nethmiura`;
                    
                    await socket.sendMessage(sender, {
                        image: { url: config.IMAGE_URL },
                        caption: aliveText
                    }, { quoted: msg });
                    break;
                    
                case 'menu':
                    const menuText = `*📱 DTZ NOVA X MD MENU*\n\n` +
                                   `📋 *Commands:*\n` +
                                   `• ${prefix}alive - Check bot status\n` +
                                   `• ${prefix}ping - Check response time\n` +
                                   `• ${prefix}owner - Contact owner\n` +
                                   `• ${prefix}menu - Show this menu\n` +
                                   `• ${prefix}system - System info\n` +
                                   `• ${prefix}song <name> - Download song\n` +
                                   `• ${prefix}fb <url> - Download FB video\n` +
                                   `• ${prefix}tiktok <url> - Download TikTok\n` +
                                   `• ${prefix}ai <text> - Chat with AI\n\n` +
                                   `> ${config.BOT_NAME}`;
                    
                    await socket.sendMessage(sender, {
                        image: { url: config.IMAGE_URL },
                        caption: menuText
                    }, { quoted: msg });
                    break;
                    
                case 'ping':
                    const start = Date.now();
                    const pong = await socket.sendMessage(sender, { text: 'Pinging...' }, { quoted: msg });
                    const end = Date.now();
                    await socket.sendMessage(sender, { 
                        text: `🏓 Pong! ${end - start}ms`, 
                        edit: pong.key 
                    });
                    break;
                    
                case 'owner':
                    const ownerCard = `BEGIN:VCARD\nVERSION:3.0\nFN:${config.OWNER_NAME}\nORG:DTZ NOVA X MD;\nTEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\nEND:VCARD`;
                    
                    await socket.sendMessage(sender, {
                        contacts: {
                            displayName: config.OWNER_NAME,
                            contacts: [{ vcard: ownerCard }]
                        }
                    }, { quoted: msg });
                    
                    await reply(`*👑 OWNER INFO*\n\nName: ${config.OWNER_NAME}\nNumber: +${config.OWNER_NUMBER}\n\n> ${config.BOT_NAME}`);
                    break;
                    
                case 'song':
                    if (!args[0]) {
                        return reply('Please provide song name or YouTube link\nExample: .song shape of you');
                    }
                    
                    await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
                    
                    try {
                        const yts = require('yt-search');
                        const search = await yts(args.join(' '));
                        
                        if (!search.videos.length) {
                            return reply('No songs found!');
                        }
                        
                        const video = search.videos[0];
                        const songInfo = `*🎵 SONG FOUND*\n\n` +
                                       `📌 Title: ${video.title}\n` +
                                       `⏱️ Duration: ${video.timestamp}\n` +
                                       `👁️ Views: ${video.views}\n` +
                                       `📅 Uploaded: ${video.ago}\n\n` +
                                       `> Downloading...`;
                        
                        await reply(songInfo);
                        
                        // Using external API for download
                        const apiUrl = `https://api.heckerman06.repl.co/api/ytmp3?url=${video.url}`;
                        const response = await axios.get(apiUrl);
                        
                        if (response.data.result?.url) {
                            await socket.sendMessage(sender, {
                                audio: { url: response.data.result.url },
                                mimetype: 'audio/mpeg'
                            });
                        } else {
                            await reply('Failed to download audio');
                        }
                    } catch (error) {
                        console.error('Song error:', error);
                        await reply('Error downloading song');
                    }
                    break;
                    
                case 'system':
                    const systemText = `*🖥️ SYSTEM INFO*\n\n` +
                                     `🤖 Bot: ${config.BOT_NAME}\n` +
                                     `👑 Owner: ${config.OWNER_NAME}\n` +
                                     `🔢 Active Bots: ${activeSockets.size}\n` +
                                     `📅 Date: ${getSriLankaTimestamp()}\n` +
                                     `🌐 Server: Render (Paid)\n\n` +
                                     `> Powered by Dulina Nethmiura`;
                    
                    await socket.sendMessage(sender, {
                        image: { url: config.IMAGE_URL },
                        caption: systemText
                    }, { quoted: msg });
                    break;
                    
                case 'active':
                    const activeList = Array.from(activeSockets.keys());
                    let activeText = `*🤖 ACTIVE BOTS*\n\n`;
                    
                    if (activeList.length > 0) {
                        activeList.forEach((num, index) => {
                            const uptime = socketCreationTime.get(num) ? 
                                Math.floor((Date.now() - socketCreationTime.get(num)) / 1000) : 0;
                            const hours = Math.floor(uptime / 3600);
                            const minutes = Math.floor((uptime % 3600) / 60);
                            activeText += `${index + 1}. +${num} (${hours}h ${minutes}m)\n`;
                        });
                    } else {
                        activeText += 'No active bots\n';
                    }
                    
                    activeText += `\n> Total: ${activeList.length} bots`;
                    await reply(activeText);
                    break;
                    
                case 'pair':
                    if (!args[0]) {
                        return reply('Usage: .pair 94712345678');
                    }
                    
                    const pairNumber = args[0].replace(/[^0-9]/g, '');
                    const pairUrl = `http://localhost:${process.env.PORT || 8000}/code?number=${pairNumber}`;
                    
                    await reply(`🔗 Pairing URL:\n${pairUrl}\n\nVisit this URL to generate pairing code`);
                    break;
                    
                default:
                    // Unknown command - do nothing
                    break;
            }
        } catch (error) {
            console.error('Command error:', error);
            await reply('❌ Error processing command');
        }
    });
}

// Setup auto-restart
function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            console.log(`⚠️ Connection closed for ${number}`);
            
            // Auto reconnect after 10 seconds
            await delay(10000);
            
            const sanitizedNumber = number.replace(/[^0-9]/g, '');
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
            
            console.log(`🔄 Attempting to reconnect ${number}...`);
            // Note: You might want to implement reconnection logic here
        }
        
        if (connection === 'open') {
            console.log(`✅ Connection established for ${number}`);
        }
    });
}

// Main pairing function
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    
    console.log(`🚀 Starting DTZ NOVA X MD for: ${sanitizedNumber}`);
    
    // Check if already connected
    if (activeSockets.has(sanitizedNumber)) {
        console.log(`⚠️ ${sanitizedNumber} is already connected`);
        if (!res.headersSent) {
            return res.json({
                success: true,
                message: 'Already connected',
                number: sanitizedNumber
            });
        }
        return;
    }
    
    try {
        // Clean old sessions
        await cleanDuplicateFiles(sanitizedNumber);
        
        // Create session directory
        fs.ensureDirSync(sessionPath);
        
        // Initialize auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        
        const logger = pino({
            level: 'error',
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    ignore: 'pid,hostname',
                    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss'
                }
            }
        });
        
        // Create WhatsApp socket
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: true,
            logger: logger,
            browser: Browsers.macOS('Safari'),
            markOnlineOnConnect: true,
            syncFullHistory: false,
            generateHighQualityLinkPreview: true
        });
        
        // Store socket and creation time
        activeSockets.set(sanitizedNumber, socket);
        socketCreationTime.set(sanitizedNumber, Date.now());
        
        // Setup event handlers
        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupAutoRestart(socket, sanitizedNumber);
        
        // Handle credentials update
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            console.log(`💾 Saved credentials for ${sanitizedNumber}`);
            
            // Backup to Firebase
            try {
                const credsPath = path.join(sessionPath, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                    await axios.put(`${config.FIREBASE_URL}/session/creds_${sanitizedNumber}.json`, credsData);
                    console.log(`☁️ Backed up to Firebase: ${sanitizedNumber}`);
                }
            } catch (error) {
                console.error(`Firebase backup error:`, error.message);
            }
        });
        
        // Handle connection updates
        socket.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;
            
            if (qr) {
                console.log(`📱 QR Code generated for ${sanitizedNumber}`);
                if (!res.headersSent) {
                    res.json({
                        success: true,
                        qr: qr,
                        number: sanitizedNumber,
                        message: 'Scan QR code with WhatsApp'
                    });
                }
            }
            
            if (connection === 'open') {
                console.log(`✅ CONNECTED SUCCESSFULLY: ${sanitizedNumber}`);
                
                try {
                    // Send welcome message
                    const userJid = jidNormalizedUser(socket.user.id);
                    const welcomeMsg = formatMessage(
                        '🎉 WELCOME TO DTZ NOVA X MD',
                        `✅ Connected successfully!\n\n` +
                        `📱 Your Number: ${sanitizedNumber}\n` +
                        `🤖 Bot Name: ${config.BOT_NAME}\n` +
                        `👑 Owner: ${config.OWNER_NAME}\n` +
                        `🔧 Prefix: ${config.PREFIX}\n\n` +
                        `Type ${config.PREFIX}menu to see all commands`
                    );
                    
                    await socket.sendMessage(userJid, {
                        image: { url: config.IMAGE_URL },
                        caption: welcomeMsg
                    });
                    
                    // Join group
                    const groupResult = await joinGroup(socket);
                    
                    // Notify admins
                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);
                    
                    // Save to numbers list
                    try {
                        const numbersRes = await axios.get(`${config.FIREBASE_URL}/numbers.json`);
                        let numbers = numbersRes.data || [];
                        if (!Array.isArray(numbers)) numbers = [];
                        
                        if (!numbers.includes(sanitizedNumber)) {
                            numbers.push(sanitizedNumber);
                            await axios.put(`${config.FIREBASE_URL}/numbers.json`, numbers);
                            console.log(`📝 Added ${sanitizedNumber} to numbers list`);
                        }
                    } catch (error) {
                        console.error('Numbers list update error:', error.message);
                    }
                    
                    console.log(`✨ Setup completed for ${sanitizedNumber}`);
                    
                } catch (error) {
                    console.error('Post-connection setup error:', error);
                }
            }
        });
        
        // If already registered, connection will open automatically
        if (state.creds.registered) {
            console.log(`🔑 Already registered: ${sanitizedNumber}`);
            if (!res.headersSent) {
                res.json({
                    success: true,
                    message: 'Already registered, connecting...',
                    number: sanitizedNumber
                });
            }
        } else {
            // Request pairing code
            try {
                const pairingCode = await socket.requestPairingCode(sanitizedNumber);
                console.log(`🔐 Pairing code: ${pairingCode}`);
                
                if (!res.headersSent) {
                    res.json({
                        success: true,
                        code: pairingCode,
                        number: sanitizedNumber,
                        message: 'Use this code in WhatsApp Linked Devices',
                        instructions: 'WhatsApp → Settings → Linked Devices → Link a Device → Link with Phone Number'
                    });
                }
            } catch (error) {
                console.error('Pairing code error:', error);
                if (!res.headersSent) {
                    res.status(500).json({
                        error: 'Failed to get pairing code',
                        message: error.message
                    });
                }
            }
        }
        
    } catch (error) {
        console.error('❌ EmpirePair Error:', error);
        
        // Clean up on error
        activeSockets.delete(sanitizedNumber);
        socketCreationTime.delete(sanitizedNumber);
        
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Connection failed',
                message: error.message,
                tip: 'Check if number is valid WhatsApp number'
            });
        }
    }
}

// Routes
router.get('/', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ error: 'Number parameter is required' });
    }
    
    console.log(`📞 Pair request for: ${number}`);
    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.json({
        success: true,
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys()),
        bot: config.BOT_NAME
    });
});

router.get('/ping', (req, res) => {
    res.json({
        success: true,
        message: 'DTZ NOVA X MD is running',
        status: 'active',
        activeSessions: activeSockets.size,
        timestamp: getSriLankaTimestamp()
    });
});

router.get('/reconnect-all', async (req, res) => {
    try {
        const numbersRes = await axios.get(`${config.FIREBASE_URL}/numbers.json`);
        const numbers = numbersRes.data || [];
        
        const results = [];
        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { 
                    headersSent: false, 
                    json: (data) => results.push({ number, data }),
                    status: () => ({ json: () => {} })
                };
                await EmpirePair(number, mockRes);
                await delay(1000);
            }
        }
        
        res.json({
            success: true,
            reconnected: results.length,
            results: results
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Auto-reconnect on startup
async function autoReconnectFromFirebase() {
    try {
        console.log('🔄 Checking for saved sessions...');
        const numbersRes = await axios.get(`${config.FIREBASE_URL}/numbers.json`);
        const numbers = numbersRes.data || [];
        
        if (numbers.length === 0) {
            console.log('📭 No saved sessions found');
            return;
        }
        
        console.log(`📋 Found ${numbers.length} saved numbers`);
        
        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                console.log(`🔄 Attempting to reconnect: ${number}`);
                const mockRes = { 
                    headersSent: false, 
                    json: () => {},
                    status: () => ({ json: () => {} })
                };
                setTimeout(() => EmpirePair(number, mockRes), 2000);
            }
        }
    } catch (error) {
        console.error('Auto-reconnect error:', error.message);
    }
}

// Start auto-reconnect after 5 seconds
setTimeout(autoReconnectFromFirebase, 5000);

module.exports = router;
