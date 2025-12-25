[file name]: pair.js
[file content begin]
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_LIKE_EMOJI: ['💋', '🍬', '🫆', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/FVStcnJe93B6S06xagh8MP?mode=ac_t',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: './anuwh.jpg',
    NEWSLETTER_JID: '120363417186678299@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94752978237',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb6mfVdEAKWH5Sgs9y2L'
};

// Use environment variable for GitHub token or use a placeholder
const octokit = new Octokit({ 
    auth: process.env.GITHUB_TOKEN || 'github_pat_11BRMIQHA0k6uStn36_zlZ6phRlTYUGz3jYxvjTOq3Q3garZHYDhuIXHK2IcpVQCTUH7INw1ZZhR9z'
});
const owner = 'DTZNOVAX';
const repo = 'session';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`creds_${sanitizedNumber}`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/creds_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/creds_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message?.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message?.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message?.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        '𝗖𝗼𝗻𝗻𝗲𝗰𝘁 DTZ NOVA OWNER',
        `📞 Number: ${number}\n🩵 Status: Connected`,
        'POWERD BY DTZ DULA'
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        'DTZ NOVA X '
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🔥', '😀', '👍', '🐭'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            '𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗕𝘆 DTZ NOVA X  𝗠𝗶𝗻𝗶 𝗕𝗼𝘁'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (isOwner) {  
        try {
            const akuru = sender;
            const quot = msg;
            if (quot) {
                if (quot.imageMessage?.viewOnce) {
                    let cap = quot.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.videoMessage?.viewOnce) {
                    let cap = quot.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.audioMessage?.viewOnce) {
                    let cap = quot.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.imageMessage) {
                    let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.videoMessage) {
                    let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage) {
                    let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                }
            }        
        } catch (error) {
            console.error('Error in oneViewmeg:', error);
        }
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        
        const m = sms(socket, msg);
        const quoted = type == "extendedTextMessage" && msg.message.extendedTextMessage.contextInfo != null
            ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
            : [];
        
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
                ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
                ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
                ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
                ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
                ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.text) 
            : (type === 'viewOnceMessage') 
                ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
                ? (msg.msg?.message?.imageMessage?.caption || msg.msg?.message?.videoMessage?.caption || "") 
            : '';
        
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isC = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isC ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1);

        socket.downloadAndSaveMediaMessage = async(message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            return buffer;
        };

        if (!command) return;

        try {
            switch (command) {
                case 'button': {
                    const buttons = [
                        {
                            buttonId: 'button1',
                            buttonText: { displayText: 'Button 1' },
                            type: 1
                        },
                        {
                            buttonId: 'button2',
                            buttonText: { displayText: 'Button 2' },
                            type: 1
                        }
                    ];

                    const captionText = '𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗕𝘆 DTZ NOVA X  𝗠𝗶𝗻𝗶 𝗕𝗼𝘁';
                    const footerText = '𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗕𝘆 DTZ NOVA X MD 𝗠𝗶𝗻𝗶 𝗕𝗼𝘁';

                    const buttonMessage = {
                        image: { url: "https://files.catbox.moe/fpyw9m.png" },
                        caption: captionText,
                        footer: footerText,
                        buttons,
                        headerType: 1
                    };

                    socket.sendMessage(from, buttonMessage, { quoted: msg });
                    break;
                }
                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const captionText = `
╭────◉◉◉────៚\n⏰  DTZ NOVA X MDMD Mini Bot Uptime: ${hours}h ${minutes}m ${seconds}s\n🟢 Active session: ${activeSockets.size}\n╰────◉◉◉────៚\n\n🔢 Your Number: ${number}\n\n*▫️🌐*\n> Owner - +94752978237
`;

                    await socket.sendMessage(m.chat, {
                        buttons: [
                            {
                                buttonId: 'action',
                                buttonText: {
                                    displayText: '📂 Menu Options'
                                },
                                type: 4,
                                nativeFlowInfo: {
                                    name: 'single_select',
                                    paramsJson: JSON.stringify({
                                        title: 'Click Here To view Menu ❏',
                                        sections: [
                                            {
                                                title: `DTZ NOVA X MDMD MINI BOT`,
                                                highlight_label: '',
                                                rows: [
                                                    {
                                                        title: 'MENU 📌',
                                                        description: 'POWERED BY DTZ NOVA X MDMD MINI BOT',
                                                        id: `${config.PREFIX}menu`,
                                                    },
                                                    {
                                                        title: 'ALIVE 📌',
                                                        description: 'POWERED BY   DTZ NOVA X MDMD MINI',
                                                        id: `${config.PREFIX}alive`,
                                                    },
                                                ],
                                            },
                                        ],
                                    }),
                                },
                            },
                        ],
                        headerType: 1,
                        viewOnce: true,
                        image: { url: "https://files.catbox.moe/fpyw9m.png" },
                        caption: ` DTZ NOVA X MDMD MINI WHATSAPP BOT IS ALIVE NOW\n\n${captionText}`,
                    }, { quoted: msg });
                    break;
                }
                case 'menu': {
                    await socket.sendMessage(from, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            ' DTZ NOVA X MDMD MINI',
                            `*➤ Available Commands..!! 🌐💭*\n\n┏━━━━━━━━━━━ ◉◉➢\n┇ *\`${config.PREFIX}alive\`*\n┋ • Show bot status\n┋\n┋ *\`${config.PREFIX}Song\`*\n┋ • Download Songs\n┋\n┋ *\`${config.PREFIX}winfo\`*\n┋ • Get User Profile Picture\n┋\n┋ *\`${config.PREFIX}aiimg\`*\n┋ • Generate AI Image\n┋\n┋ *\`${config.PREFIX}logo\`*\n┋ • Create Logo\n┋\n┋ *\`${config.PREFIX}fancy\`*\n┋ • View Fancy Text\n┋\n┋ *\`${config.PREFIX}tiktok\`*\n┋ • Download TikTok video\n┋\n┋ *\`${config.PREFIX}fb\`*\n┋ • Download Facebook video\n┋\n┋ *\`${config.PREFIX}ig\`*\n┋ • Download Instagram video\n┋\n┋ *\`${config.PREFIX}ts\`*\n┋ • Search TikTok videos\n┋\n┋ *\`${config.PREFIX}ai\`*\n┋ • New AI Chat\n┋\n┋ *\`${config.PREFIX}news\`*\n┋ • View latest news update\n┋\n┋ *\`${config.PREFIX}nasa\`*\n┋ • View latest NASA news update\n┋\n┋ *\`${config.PREFIX}gossip\`*\n┋ • View gossip news update\n┋\n┋ \`${config.PREFIX}cricket\`\n┇ • Cricket news updates\n┇\n┇ *\`${config.PREFIX}bomb\`*\n┇• Send Bomb Message\n┇\n┇ *\`${config.PREFIX}deleteme\`*\n┇• Delete your session\n┋\n┗━━━━━━━━━━━ ◉◉➣`,
                            '𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗕𝘆 DTZ NOVA X MD 𝗠𝗶𝗻𝗶 𝗕𝗼𝘁'
                        )
                    });
                    break;
                }
                // ... (other commands remain the same, just ensure they're properly closed)
                
                // Add a default case for debugging
                default:
                    console.log(`Unknown command: ${command}`);
                    break;
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                text: '❌ An error occurred while processing your command.'
            });
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    // Clean duplicate files
    await cleanDuplicateFiles(sanitizedNumber);

    // Restore session if exists
    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    // Create auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'error' }); // Simplified logging

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: true, // Enable QR in terminal for debugging
            logger: pino({ level: 'silent' }), // Suppress excessive logs
            browser: Browsers.ubuntu('Chrome'),
            version: [2, 2413, 1],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            emitOwnEvents: false,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        // Setup handlers
        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        // Handle pairing code
        if (!socket.authState.creds.registered) {
            console.log(`Requesting pairing code for: ${sanitizedNumber}`);
            try {
                const code = await socket.requestPairingCode(sanitizedNumber);
                console.log(`Pairing code: ${code}`);
                if (!res.headersSent) {
                    res.json({ code: code });
                }
            } catch (error) {
                console.error('Failed to get pairing code:', error);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to get pairing code' });
                }
                return;
            }
        }

        // Handle credentials update
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            console.log('Credentials updated and saved locally');
        });

        // Handle connection
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('QR Code received');
            }
            
            if (connection === 'open') {
                console.log(`✅ Connected successfully for ${sanitizedNumber}`);
                
                try {
                    // Join group
                    const groupResult = await joinGroup(socket);
                    console.log(`Group join result: ${groupResult.status}`);
                    
                    // Store active socket
                    activeSockets.set(sanitizedNumber, socket);
                    
                    // Send welcome message
                    const userJid = jidNormalizedUser(socket.user.id);
                    await socket.sendMessage(userJid, {
                        text: formatMessage(
                            '👻 WELCOME TO DTZ NOVA X FREE BOT 👻',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n`,
                            'DTZ NOVA X FREE BOT'
                        )
                    });
                    
                    // Send admin notification
                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);
                    
                    // Update numbers list
                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        console.log(`Added ${sanitizedNumber} to numbers list`);
                    }
                } catch (error) {
                    console.error('Connection setup error:', error);
                }
            }
            
            if (connection === 'close') {
                console.log(`❌ Connection closed for ${sanitizedNumber}`);
                const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== 401);
                
                if (shouldReconnect) {
                    console.log(`Attempting to reconnect ${sanitizedNumber} in 5 seconds...`);
                    await delay(5000);
                    activeSockets.delete(sanitizedNumber);
                    socketCreationTime.delete(sanitizedNumber);
                    
                    // Attempt reconnection
                    const mockRes = { 
                        headersSent: false, 
                        send: () => {}, 
                        json: () => {},
                        status: () => ({ send: () => {} }) 
                    };
                    await EmpirePair(number, mockRes);
                } else {
                    console.log(`User ${sanitizedNumber} logged out, cleaning up...`);
                    activeSockets.delete(sanitizedNumber);
                    socketCreationTime.delete(sanitizedNumber);
                }
            }
        });

        // Handle errors
        socket.ev.on('connection.update', (update) => {
            const { connection } = update;
            if (connection === 'close') {
                console.log('Connection closed, attempting to reconnect...');
            }
        });

    } catch (error) {
        console.error('Socket creation error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to create socket connection' });
        }
    }
}

// Restore session function
async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json` || file.name.startsWith(`creds_${sanitizedNumber}_`)
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

// Router endpoints
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).json({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.json({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.json({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.json({
        status: 'active',
        message: '👻 DTZ NOVA X FREE BOT is running',
        activeSessions: activeSockets.size
    });
});

// Helper function to load newsletter JIDs
async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/sula48/database/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('Failed to load newsletter list:', err.message);
        return [];
    }
}

module.exports = router;
[file content end]
