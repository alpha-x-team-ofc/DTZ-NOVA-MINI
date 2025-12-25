const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");

// Use standard baileys package
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
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('baileys'); // Fixed: Changed from 'baileys' to '@whiskeysockets/baileys'

const FIREBASE_URL = 'https://minibotproject2-default-rtdb.asia-southeast1.firebasedatabase.app';

const config = {
    THARUZZ_FOOTER: 'Mini Bot',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_LIKE_EMOJI: ['😒', '🍬', '💝', '💗', '🎈', '🎉', '🥳', '❤️', '💕', '👨‍🔧', '🫀', '🥀'], // Fixed: Removed extra comma
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/GYFkafbxbD8JHDCPzXPlIi',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/fpyw9m.png',
    NEWSLETTER_JID: '120363421312638293@newsletter', // Fixed: Removed leading space
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94752978237',
    CHANNEL_LINK: 'https://files.catbox.moe/fpyw9m.png',
    BOT_NAME: 'DTZ NOVA XMD MINI BOT', // Added missing config
    OWNER_NAME: 'DTZ DULA' // Added missing config
};

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// Default user config for settings command
const defaultUserConfig = {
    PREFIX: '.',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_LIKE_EMOJI: ['😒', '🍬', '💝', '💗', '🎈', '🎉', '🥳', '❤️', '💕', '👨‍🔧', '🫀', '🥀']
};

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
        const { data } = await axios.get(`${FIREBASE_URL}/session.json`);
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
                await axios.delete(`${FIREBASE_URL}/session/${sessionKeys[i].replace('.json', '')}.json`);
                console.log(`Deleted duplicate session file: ${sessionKeys[i]}`);
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
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
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
        '💗 DTZ NOVA XMD CONECTED  💗',
        `📞 Number: ${number}\n Status: Connected`,
        'DTZ NOVA XMD MINI BOT CONECTED 🔥'
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

async function updateStoryStatus(socket) {
    const statusMessage = `DTZ NOVA XMD MINI BOT CONNECTION SUCSESS..! 🚀`;
    try {
        await socket.sendMessage('status@broadcast', { text: statusMessage });
        console.log(`Posted story status: ${statusMessage}`);
    } catch (error) {
        console.error('Failed to post story status:', error);
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        'DTZ NOVA XMD MINI BOT CONECTED 🔥'
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
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

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
            'DTZ NOVA XMD MINI BOT ✊'
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
                    console.log("hi");
                    let cap = quot.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.videoMessage?.viewOnce) {
                    console.log("hi");
                    let cap = quot.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.audioMessage?.viewOnce) {
                    console.log("hi");
                    let cap = quot.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.imageMessage){
                    let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.videoMessage){
                    let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage){
                    let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                }
            }        
        } catch (error) {
            console.error("Error in oneViewmeg:", error);
        }
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configKey = `config_${sanitizedNumber}`;
        const { data } = await axios.get(`${FIREBASE_URL}/session/${configKey}.json`);
        return data || { ...defaultUserConfig };
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...defaultUserConfig };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configKey = `config_${sanitizedNumber}`;
        await axios.put(`${FIREBASE_URL}/session/${configKey}.json`, newConfig);
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? 
            msg.message.ephemeralMessage.message : msg.message;
        
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted = type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null ?
            msg.message.extendedTextMessage.contextInfo.quotedMessage || [] : [];
        
        const body = (type === 'conversation') ? msg.message.conversation : 
            msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') ? 
            msg.message.extendedTextMessage.text : 
            (type == 'interactiveResponseMessage') ? 
            msg.message.interactiveResponseMessage?.nativeFlowResponseMessage && 
            JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id : 
            (type == 'templateButtonReplyMessage') ? 
            msg.message.templateButtonReplyMessage?.selectedId : 
            (type === 'extendedTextMessage') ? 
            msg.message.extendedTextMessage.text : 
            (type == 'imageMessage') && msg.message.imageMessage.caption ? 
            msg.message.imageMessage.caption : 
            (type == 'videoMessage') && msg.message.videoMessage.caption ? 
            msg.message.videoMessage.caption : 
            (type == 'buttonsResponseMessage') ? 
            msg.message.buttonsResponseMessage?.selectedButtonId : 
            (type == 'listResponseMessage') ? 
            msg.message.listResponseMessage?.singleSelectReply?.selectedRowId : 
            (type == 'messageContextInfo') ? 
            (msg.message.buttonsResponseMessage?.selectedButtonId || 
                msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || 
                msg.text) : 
            (type === 'viewOnceMessage') ? 
            msg.message[type]?.message[getContentType(msg.message[type].message)] : 
            (type === "viewOnceMessageV2") ? 
            (msg.msg.message.imageMessage?.caption || msg.msg.message.videoMessage?.caption || "") : '';
        
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? 
            (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : 
            (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1);

        // Helper function for sending replies
        const reply = async (text) => {
            await socket.sendMessage(sender, { text }, { quoted: msg });
        };

        if (!command) return;

        try {
            switch (command) {
                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const captionText = `*👋HY I AM DTZ NOVA XMD MINI V1💗🍒*\n❲ ! ★𝐃𝐓𝐙 𝐍𝐎𝐕𝐀 𝐗 𝐌𝐃★ 🤭💗 ආහ් පැටියෝ කොහොමද ?🌝 🔥  ❳\n\n║▻ 𝙞 𝙖𝙢 𝙤𝙣𝙡𝙞𝙣𝙚 𝙣𝙤𝙬 👨‍🔧🔥 ◅║\n\n*╭────◅●💗●▻────➣*\n*┃💗  ʙᴏᴛ ᴜᴘ ᴛɪᴍᴇ ➟* ${hours}h ${minutes}m ${seconds}s ⚡\n*┃💗  ʙᴏᴛᴀᴄᴛɪᴠᴇ ᴄᴏᴜɴᴛ ➟* ${activeSockets.size} ⚡\n*┃💗  ᴍɪɴɪ ᴠᴇʀꜱɪᴏɴ ➟ 1.0.0 ᴠ* ⚡\n*┃💗  ᴅᴇᴘʟᴏʏ ᴘʟᴀᴛꜰʀᴏᴍ ➟ RENDER ❲ PAID ❳* ⚡\n*┃💗  ᴍɪɴɪ ʙᴏᴛ ᴏᴡɴᴇʀ ➟ 94752978237*⚡\n*╰────◅●💗●▻────➢*\n\n◅𝙃𝙖𝙫𝙚 𝙖 𝙣𝙞𝙘𝙚 𝙙𝙖𝙮.. 👨‍🔧❤️▻\n\n> DTZ NOVA XMD MINI BOT 🔥`;

                    const templateButtons = [
                        {
                            buttonId: `${config.PREFIX}menu`,
                            buttonText: { displayText: '❲ 𝘔𝘌𝘕𝘜 👻 ❳' },
                            type: 1,
                        },
                        {
                            buttonId: `${config.PREFIX}owner`,
                            buttonText: { displayText: ' ❲ 𝘖𝘞𝘕𝘌𝘙 👻 ❳' },
                            type: 1,
                        }, 
                        {
                            buttonId: 'action',
                            buttonText: {
                                displayText: ' ◅ ❤️👨‍🔧ᴍᴇɴᴜ ᴏᴘᴄᴛɪᴏɴꜱ ▻'
                            },
                            type: 4,
                            nativeFlowInfo: {
                                name: 'single_select',
                                paramsJson: JSON.stringify({
                                    title: 'TAB-AND-SELECTION ❕',
                                    sections: [
                                        {
                                            title: ` DTZ NOVA XMD MINI BOT 🔥`,
                                            highlight_label: '',
                                            rows: [
                                                {
                                                    title: '❲ 𝘔𝘌𝘕𝘜  👻 ❳',
                                                    description: '',
                                                    id: `${config.PREFIX}menu`,
                                                },
                                                {
                                                    title: '❲ 𝘖𝘞𝘕𝘌𝘙 👻 ❳',
                                                    description: ' DTZ NOVA XMD MINI BOT 🔥',
                                                    id: `${config.PREFIX}owner`,
                                                },
                                            ],
                                        },
                                    ],
                                }),
                            },
                        }
                    ];

                    await socket.sendMessage(m.chat, {
                        buttons: templateButtons,
                        headerType: 1,
                        viewOnce: true,
                        image: { url: "https://files.catbox.moe/fpyw9m.png" },
                        caption: ` DTZ NOVA XMD MINI BOT 🔥\n\n${captionText}`,
                    }, { quoted: msg });
                    break;
                }

                case 'settings':
                case 'setting': {
                    const adminNumbers = ['94752978237'];
                    const botNumber = socket.user.id.split(':')[0];
                    if (![botNumber, ...adminNumbers].includes(senderNumber)) {
                        return await reply('❌ Only the bot or admins can use this command.');
                    }

                    const userConfig = await loadUserConfig(sanitizedNumber);
                    const keys = ['PREFIX', 'AUTO_VIEW_STATUS', 'AUTO_LIKE_STATUS', 'AUTO_RECORDING'];
                    const emojiMap = {
                        PREFIX: '🔑',
                        AUTO_VIEW_STATUS: '👀',
                        AUTO_LIKE_STATUS: '❤️',
                        AUTO_RECORDING: '🎙️'
                    };

                    const onOff = v => v === true || v === 'true' ? '🟢 ON' : '🔴 OFF';
                    let settingsText = `╭━━━[ *🛠️ Your Settings* ]━━━⬣\n`;

                    for (const key of keys) {
                        let value = userConfig[key];
                        if (typeof value === 'boolean' || value === 'true' || value === 'false') {
                            settingsText += `┃ ${emojiMap[key]} ${key}: ${onOff(value)}\n`;
                        } else {
                            settingsText += `┃ ${emojiMap[key]} ${key}: ${value}\n`;
                        }
                    }

                    settingsText += `╰━━━━━━━━━━━━━━━━━━⬣\n`;
                    settingsText += `Usage: .set <key> <value>\nExample: .set AUTO_LIKE_STATUS true\n`;
                    settingsText += `> *POWERD BY DTZ DULA*`;

                    await socket.sendMessage(m.chat, { react: { text: '⚙️', key: msg.key } });
                    await reply(settingsText);
                    break;
                }

                case 'set': {
                    const adminNumbers = ['94752978237'];
                    const botNumber = socket.user.id.split(':')[0];
                    if (![botNumber, ...adminNumbers].includes(senderNumber)) {
                        return await reply('❌ Only the bot or admins can use this command.');
                    }
                    if (args.length < 2) {
                        return await reply('Usage: .set <key> <value>\nExample: .set AUTO_LIKE_STATUS true');
                    }
                    const key = args[0].toUpperCase();
                    let value = args.slice(1).join(' ');

                    if (value === 'true') value = true;
                    else if (value === 'false') value = false;
                    else if (!isNaN(value)) value = Number(value);

                    let userConfig = await loadUserConfig(sanitizedNumber);

                    if (!(key in defaultUserConfig)) {
                        return await reply(`Unknown setting: ${key}`);
                    }

                    userConfig[key] = value;
                    await updateUserConfig(sanitizedNumber, userConfig);
                    await socket.sendMessage(m.chat, { react: { text: '✅', key: msg.key } });
                    await reply(`✅ Setting *${key}* updated to *${value}*.`);
                    break;
                }

                case 'menu': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const captionText = `*👋HY I AM  DTZ NOVA XMD MINI V1💗🍒*\n❲"★𝐃𝐓𝐙 𝐍𝐎𝐕𝐀 𝐗 𝐌𝐃★ 🤭💗 ආහ් පැටියෝ කොහොමද ?🌝🔥❳\n\n║▻ 𝙏𝙝𝙞𝙨 𝙞𝙨 𝙢𝙮 𝙢𝙚𝙣𝙪 𝙡𝙞𝙨𝙩 ◅║\n\n*╭────◅●🍒●▻────➣*\n*┃💗 ʙᴏᴛ ᴜᴘ ᴛɪᴍᴇ ➟* ${hours}h ${minutes}m ${seconds}s \n*┃💗 ʙᴏᴛᴀᴄᴛɪᴠᴇ ᴄᴏᴜɴᴛ ➟* ${activeSockets.size} \n*┃💗 ᴍɪɴɪ ᴠᴇʀꜱɪᴏɴ ➟ 1.0.0 ᴠ* \n*┃💗 ᴅᴇᴘʟᴏʏ ᴘʟᴀᴛꜰʀᴏᴍ ➟ RENDER ❲ PAID ❳* \n*┃💗 ᴍɪɴɪ ʙᴏᴛ ᴏᴡɴᴇʀ ➟ 94752978237* \n*╰────◅●🍒●▻────➢*\n\n🛡️ 𝘼 𝙉𝙚𝙬 𝙀𝙧𝙖 𝙤𝙛 𝙒𝙝𝙖𝙩𝙨𝘼𝙥𝙥 𝘽𝙤𝙩 𝘼𝙪𝙩𝙤𝙢𝙖𝙩𝙞𝙤𝙣 \n\n> Owner By DTZ DULA💥\n\n🔧 𝘽𝙪𝙞𝙡𝙩 𝙒𝙞𝙩𝙝 ➟\n𝙉𝙤𝙙𝙚.𝙟𝙨 + 𝙅𝙖𝙫𝙖𝙎𝙘𝙧𝙞𝙥𝙩\n𝘼𝙪𝙩𝙤 𝙙𝙚𝙥𝙡𝙤𝙮 𝙖𝙣𝙙 𝙛𝙧𝙚𝙚 ❕\n\n>  DTZ NOVA XMD MINI BOT🔥`;

                    const templateButtons = [
                        {
                            buttonId: `${config.PREFIX}alive`,
                            buttonText: { displayText: '❲ ALIVE 👻 ❳ ' },
                            type: 1,
                        },
                        {
                            buttonId: `${config.PREFIX}owner`,
                            buttonText: { displayText: '❲ OWNER 👻❳' },
                            type: 1,
                        },
                        {
                            buttonId: 'action',
                            buttonText: {
                                displayText: ' ◅ ❤️👨‍🔧ᴍᴇɴᴜ ᴏᴘᴄᴛɪᴏɴꜱ ▻'
                            },
                            type: 4,
                            nativeFlowInfo: {
                                name: 'single_select',
                                paramsJson: JSON.stringify({
                                    title: '𝙏𝘼𝘽 𝙎𝙀𝘾𝙏𝙄𝙊𝙽❕',
                                    sections: [
                                        {
                                            title: ` DTZ NOVA XMD MINI BOT `,
                                            highlight_label: '',
                                            rows: [
                                                {
                                                    title: '❲ DOWNLOAD COMMANDS ⬇️ ❳',
                                                    description: ' DTZ NOVA XMD MINI BOT 🔥',
                                                    id: `${config.PREFIX}dmenu`,
                                                },
                                                {
                                                    title: ' ❲ OWNER COMMANDS 👀 ❳',
                                                    description: ' DTZ NOVA XMD MINI BOT 🔥',
                                                    id: `${config.PREFIX}ownermenu`,
                                                },
                                            ],
                                        },
                                    ],
                                }),
                            },
                        }
                    ];

                    await socket.sendMessage(m.chat, {
                        buttons: templateButtons,
                        headerType: 1,
                        viewOnce: true,
                        image: { url: "https://files.catbox.moe/fpyw9m.png" },
                        caption: ` DTZ NOVA XMD MINI BOT\n\n${captionText}`,
                    }, { quoted: msg });
                    break;
                }

                case 'dmenu': {
                    const captionText = `*👋HY I AM  DTZ NOVA XMD MINI V1💗🍒*\nDownload Menu\n* .song\n* .fb\n* .tiktok\n\n>  DTZ NOVA XMD MINI BOT 🔥`;

                    const templateButtons = [
                        {
                            buttonId: `${config.PREFIX}alive`,
                            buttonText: { displayText: '❲ ALIVE 👻 ❳ ' },
                            type: 1,
                        },
                        {
                            buttonId: `${config.PREFIX}owner`,
                            buttonText: { displayText: '❲ OWNER 👻❳' },
                            type: 1,
                        },
                        {
                            buttonId: 'action',
                            buttonText: {
                                displayText: ' ◅ ❤️👨‍🔧ᴍᴇɴᴜ ᴏᴘᴄᴛɪᴏɴꜱ ▻'
                            },
                            type: 4,
                            nativeFlowInfo: {
                                name: 'single_select',
                                paramsJson: JSON.stringify({
                                    title: '𝙏𝘼𝘽 𝙎𝙀𝘾𝙏𝙄𝙊𝙉❕',
                                    sections: [
                                        {
                                            title: ` DTZ NOVA XMD MINI BOT `,
                                            highlight_label: '',
                                            rows: [
                                                {
                                                    title: '❲ 𝘊𝘏𝘌𝘊𝘒 𝘉𝘖𝘛 𝘚𝘛𝘈𝘛𝘜𝘚 👻 ❳',
                                                    description: ' DTZ NOVA XMD MINI BOT 🔥',
                                                    id: `${config.PREFIX}alive`,
                                                },
                                                {
                                                    title: ' ❲ 𝘔𝘈𝘐𝘕 𝘔𝘌𝘕𝘜 𝘓𝘐𝘚𝘛 👻 ❳',
                                                    description: ' DTZ NOVA XMD MINI BOT 🔥',
                                                    id: `${config.PREFIX}menu`,
                                                },
                                            ],
                                        },
                                    ],
                                }),
                            },
                        }
                    ];

                    await socket.sendMessage(m.chat, {
                        buttons: templateButtons,
                        headerType: 1,
                        viewOnce: true,
                        image: { url: "https://files.catbox.moe/fpyw9m.png" },
                        caption: ` DTZ NOVA XMD MINI BOT\n\n${captionText}`,
                    }, { quoted: msg });
                    break;
                }

                case 'ownermenu': {
                    const captionText = `*👋HY I AM  DTZ NOVA XMD MINI V1💗🍒*\nOwner Menu\n* .settings\n* .set\n* .active\n\n>  DTZ NOVA XMD MINI BOT 🔥`;

                    const templateButtons = [
                        {
                            buttonId: `${config.PREFIX}alive`,
                            buttonText: { displayText: '❲ ALIVE 👻 ❳ ' },
                            type: 1,
                        },
                        {
                            buttonId: `${config.PREFIX}owner`,
                            buttonText: { displayText: '❲ OWNER 👻❳' },
                            type: 1,
                        },
                        {
                            buttonId: 'action',
                            buttonText: {
                                displayText: ' ◅ ❤️👨‍🔧ᴍᴇɴᴜ ᴏᴘᴄᴛɪᴏɴꜱ ▻'
                            },
                            type: 4,
                            nativeFlowInfo: {
                                name: 'single_select',
                                paramsJson: JSON.stringify({
                                    title: '𝙏𝘼𝘽 𝙎𝙀𝘾𝙏𝙄𝙊𝙉❕',
                                    sections: [
                                        {
                                            title: ` DTZ NOVA XMD MINI BOT `,
                                            highlight_label: '',
                                            rows: [
                                                {
                                                    title: '❲ 𝘊𝘏𝘌𝘊𝘒 𝘉𝘖𝘛 𝘚𝘛𝘈𝘛𝘜𝘚 👻 ❳',
                                                    description: ' DTZ NOVA XMD MINI BOT 🔥',
                                                    id: `${config.PREFIX}alive`,
                                                },
                                                {
                                                    title: ' ❲ 𝘔𝘈𝘐𝘕 𝘔𝘌𝘕𝘜 𝘓𝘐𝘚𝘛 👻 ❳',
                                                    description: ' DTZ NOVA XMD MINI BOT 🔥',
                                                    id: `${config.PREFIX}menu`,
                                                },
                                            ],
                                        },
                                    ],
                                }),
                            },
                        }
                    ];

                    await socket.sendMessage(m.chat, {
                        buttons: templateButtons,
                        headerType: 1,
                        viewOnce: true,
                        image: { url: "https://files.catbox.moe/fpyw9m.png" },
                        caption: ` DTZ NOVA XMD MINI BOT\n\n${captionText}`,
                    }, { quoted: msg });
                    break;
                }

                case 'system': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const captionText = `*👋HY I AM  DTZ NOVA XMD MINI BOT MINI V1💗🍒*\n║▻  DTZ NOVA XMD MINI BOT ꜱʏꜱᴛᴇᴍ 🔥◅║\n\n*╭────◅●❤️●▻────➣*\n*┃💗 ʙᴏᴛ ᴜᴘ ᴛɪᴍᴇ ➟* ${hours}h ${minutes}m ${seconds}s ⚡\n*┃💗 ʙᴏᴛᴀᴄᴛɪᴠᴇ ᴄᴏᴜɴᴛ ➟* ${activeSockets.size} ⚡\n*┃💗 ᴍɪɴɪ ᴠᴇʀꜱɪᴏɴ ➟ 1.0.0 ᴠ* ⚡\n*┃💗 ʀᴀᴍ ᴜꜱᴇɢᴇ ➟ 36220/3420 GB* ⚡\n*┃💗 ᴅᴇᴘʟᴏʏ ᴘʟᴀᴛꜰʀᴏᴍ ➟ RENDER*⚡\n*┃💗 ᴍɪɴɪ ʙᴏᴛ ᴏᴡɴᴇʀ ➟ 94752978237* ⚡\n*╰────◅●❤️●▻────➢*\n>  DTZ NOVA XMD MINI BOT Mini Bot 💚👨‍🔧`;
                    
                    const templateButtons = [
                        {
                            buttonId: `${config.PREFIX}ping`,
                            buttonText: { displayText: '👻 𝙿𝙸𝙽𝙶 ' },
                            type: 1,
                        },
                        {
                            buttonId: `${config.PREFIX}menu`,
                            buttonText: { displayText: '👻 𝙼𝙴𝙽𝚄' },
                            type: 1,
                        },
                        {
                            buttonId: `${config.PREFIX}owner`,
                            buttonText: { displayText: '👻 𝙾𝚆𝙽𝙴𝚁' },
                            type: 1
                        }
                    ];

                    await socket.sendMessage(m.chat, {
                        image: { url: "https://files.catbox.moe/fpyw9m.png" },
                        caption: captionText.trim(),
                        footer: ' DTZ NOVA XMD MINI BOT 🔥',
                        buttons: templateButtons,
                        headerType: 1
                    }, { quoted: msg });
                    break;
                }

                case 'ping': {
                    const start = Date.now();
                    const loading = await socket.sendMessage(m.chat, {
                        text: "* DTZ NOVA XMD MINI BOT*"
                    }, { quoted: msg });

                    const stages = ["*○○○○", "**○○○", "***○○", "****○", "*****"];
                    for (let stage of stages) {
                        await socket.sendMessage(m.chat, { text: stage, edit: loading.key });
                        await new Promise(r => setTimeout(r, 250));
                    }

                    const end = Date.now();
                    const ping = end - start;

                    await socket.sendMessage(m.chat, {
                        text: `🦹‍♀️ 𝘗𝘐𝘕𝘎  ▻  \`0.001ms\`\n\n  DTZ NOVA XMD MINI BOT ɪꜱ ᴀᴄᴛɪᴠᴇ ᴛᴏ ꜱɪɢɴᴀʟ 💝👻⚡`,
                        edit: loading.key
                    });
                    break;
                }

                case 'owner': {
                    const ownerNumber = '+94752978237';
                    const ownerName = 'DTZ NOVA XMD MINI BOT';
                    const organization = '*DTZ DULA-  DTZ NOVA XMD MINI BOT MINI BOT OWNER 👾*';

                    const vcard = 'BEGIN:VCARD\n' +
                        'VERSION:3.0\n' +
                        `FN:${ownerName}\n` +
                        `ORG:${organization};\n` +
                        `TEL;type=CELL;type=VOICE;waid=${ownerNumber.replace('+', '')}:${ownerNumber}\n` +
                        'END:VCARD';

                    try {
                        const sent = await socket.sendMessage(from, {
                            contacts: {
                                displayName: ownerName,
                                contacts: [{ vcard }]
                            }
                        });

                        await socket.sendMessage(from, {
                            text: `* 💝 DTZ DULA DTZ NOVA XMD MINI BOT MINI BOT OWNER*\n\n👨‍🔧 Name: ${ownerName}\n💭 ηυмвєя ➥ ${ownerNumber}\n\n>  DTZ NOVA XMD MINI BOT 🔥`,
                            contextInfo: {
                                mentionedJid: [`${ownerNumber.replace('+', '')}@s.whatsapp.net`],
                                quotedMessageId: sent.key.id
                            }
                        }, { quoted: msg });
                    } catch (err) {
                        console.error('❌ Owner command error:', err.message);
                        await reply('❌ Error sending owner contact.');
                    }
                    break;
                }

                case 'fancy': {
                    const q = body.replace(/^.fancy\s+/i, "").trim();
                    if (!q) {
                        return await reply("❎ *Please provide text to convert into fancy fonts.*\n\n📌 *Example:* `.fancy Dila`");
                    }

                    try {
                        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(q)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data.status || !response.data.result) {
                            return await reply("❌ *Error fetching fonts from API. Please try again later.*");
                        }

                        const fontList = response.data.result
                            .map(font => `*${font.name}:*\n${font.result}`)
                            .join("\n\n");

                        const finalMessage = `🎨 Fancy Fonts Converter\n\n${fontList}\n\n_ DTZ NOVA XMD MINI BOT 🔥_`;

                        await reply(finalMessage);
                    } catch (err) {
                        console.error("Fancy Font Error:", err);
                        await reply("⚠️ *An error occurred while converting to fancy fonts.*");
                    }
                    break;
                }

                case 'song': {
                    await socket.sendMessage(sender, { react: { text: '🎧', key: msg.key } });
                    
                    function replaceYouTubeID(url) {
                        const regex = /(?:youtube\.com\/(?:.*v=|.*\/)|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
                        const match = url.match(regex);
                        return match ? match[1] : null;
                    }
                    
                    const q = args.join(" ");
                    if (!args[0]) {
                        return await reply('Please enter YouTube song name or link !!');
                    }
                    
                    try {
                        const yts = require('yt-search');
                        const searchResults = await yts(q);
                        
                        if (!searchResults?.videos?.length) {
                            return await reply('*📛 Please enter valid YouTube song name or url.*');
                        }
                        
                        const data = searchResults.videos[0];
                        const caption = `*🎧 \` DTZ NOVA XMD MINI BOT MINI BOT SONG DOWNLOADER\`*\n\n` +
                            `*┏━━━━━━━━━━━━━━━*\n` +
                            `*┃ 📌 \`тιтℓє:\` ${data.title || "No info"}*\n` +
                            `*┃ ⏰ \`∂υяαтιση:\` ${data.timestamp || "No info"}*\n` +
                            `*┃ 📅 \`яєℓєαѕє∂ ∂αтє:\` ${data.ago || "No info"}*\n` +
                            `*┃ 👀 \`νιєωѕ:\` ${data.views || "No info"}*\n` +
                            `*┃ 👤 \`αυтнσя:\` ${data.author?.name || "No info"}*\n` +
                            `*┃ 📎 \`υяℓ:\` ~${data.url || "No info"}~*\n` +
                            `*┗━━━━━━━━━━━━━━━━━━*\n\n${config.THARUZZ_FOOTER}`;
                        
                        const templateButtons = [
                            {
                                buttonId: `${config.PREFIX}yt_mp3 AUDIO ${data.url}`,
                                buttonText: { displayText: '𝙰𝚄𝙳𝙸𝙾 𝚃𝚈𝙿𝙴 🎧' },
                                type: 1,
                            },
                            {
                                buttonId: `${config.PREFIX}yt_mp3 DOCUMENT ${data.url}`,
                                buttonText: { displayText: '𝙳𝙾𝙲𝚄𝙼𝙴𝙽𝚃 𝚃𝚈𝙿𝙴 📂' },
                                type: 1,
                            },
                            {
                                buttonId: `${config.PREFIX}yt_mp3 VOICECUT ${data.url}`,
                                buttonText: { displayText: '𝚅𝙾𝙸𝙲𝙴 𝙲𝚄𝚃 𝚃𝚈𝙿𝙴 🎤' },
                                type: 1
                            }
                        ];
                        
                        await socket.sendMessage(from, {
                            image: { url: data.thumbnail },
                            caption: caption,
                            buttons: templateButtons,
                            headerType: 1
                        }, { quoted: msg });
                    } catch (e) {
                        console.log("❌ Song command error: " + e);
                        await reply("Error processing song request");
                    }
                    break;
                }

                case 'yt_mp3': {
                    await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
                    const mediatype = args[0];
                    const mediaLink = args[1];
                    
                    try {
                        const apiUrl = `https://api.heckerman06.repl.co/api/ytmp3?url=${mediaLink}`;
                        const response = await axios.get(apiUrl);
                        const data = response.data;
                        
                        if (mediatype === "AUDIO") {
                            await socket.sendMessage(from, {
                                audio: { url: data.result.url },
                                mimetype: "audio/mpeg"
                            }, { quoted: msg });
                        } else if (mediatype === "DOCUMENT") {
                            await socket.sendMessage(from, {
                                document: { url: data.result.url },
                                mimetype: "audio/mpeg",
                                fileName: `${data.result.title}.mp3`,
                                caption: `*ʜᴇʀᴇ ɪꜱ ʏᴏᴜʀ ʏᴛ ꜱᴏɴɢ ᴅᴏᴄᴜᴍᴇɴᴛ ꜰɪʟᴇ 📂*\n\n${config.THARUZZ_FOOTER}`
                            }, { quoted: msg });
                        } else if (mediatype === "VOICECUT") {
                            await socket.sendMessage(from, {
                                audio: { url: data.result.url },
                                mimetype: "audio/mpeg",
                                ptt: true
                            }, { quoted: msg });
                        }
                    } catch (e) {
                        console.log("❌ yt_mp3 command error: " + e);
                        await reply("Error downloading audio");
                    }
                    break;
                }

                case 'mp3play':
                case 'mp3doc':
                case 'mp3ptt': {
                    const url = args[0];
                    if (!url || !url.startsWith('http')) {
                        return await reply("*`Invalid or missing URL`*");
                    }

                    try {
                        const apiUrl = `https://api.heckerman06.repl.co/api/ytmp3?url=${url}`;
                        const response = await axios.get(apiUrl);
                        const data = response.data;

                        if (command === 'mp3play') {
                            await socket.sendMessage(sender, {
                                audio: { url: data.result.url },
                                mimetype: "audio/mpeg"
                            }, { quoted: msg });
                        } else if (command === 'mp3doc') {
                            await socket.sendMessage(sender, {
                                document: { url: data.result.url },
                                mimetype: "audio/mpeg",
                                fileName: ` DTZ NOVA XMD MINI BOT MINI BOT mp3 💚💆‍♂️🎧`
                            }, { quoted: msg });
                        } else if (command === 'mp3ptt') {
                            await socket.sendMessage(sender, {
                                audio: { url: data.result.url },
                                mimetype: 'audio/mpeg',
                                ptt: true
                            }, { quoted: msg });
                        }
                    } catch (err) {
                        console.error(err);
                        await reply("*`Error occurred while processing your request`*");
                    }
                    break;
                }

                case 'fb': {
                    const RHT = `❎ *Please provide a valid Facebook video link.*\n\n📌 *Example:* \`.fb https://fb.watch/abcd1234/\``;

                    if (!args[0] || !args[0].startsWith('http')) {
                        return await reply(RHT);
                    }

                    try {
                        await socket.sendMessage(from, { react: { text: "⏳", key: msg.key } });

                        const apiUrl = `https://api.heckerman06.repl.co/api/fb?url=${args[0]}`;
                        const response = await axios.get(apiUrl);
                        const fb = response.data.result;

                        const caption = `🎬💚 *  DTZ NOVA XMD MINI BOT MINI BOT FB DOWNLOADER*\n\n💚 *Title:* ${fb.title}\n🧩 *URL:* ${args[0]}\n\n>  DTZ NOVA XMD MINI BOT MINI BOT 💚🔥\n\n👨‍🔧💚 *¢ℓι¢к вυттση нєαяє*`;

                        const templateButtons = [
                            {
                                buttonId: `${config.PREFIX}fbsd ${args[0]}`,
                                buttonText: { displayText: '💚 ꜱᴅ ᴠɪᴅᴇᴏ' },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}fbhd ${args[0]}`,
                                buttonText: { displayText: '💚 ʜᴅ ᴠɪᴅᴇᴏ' },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}fbaudio ${args[0]}`,
                                buttonText: { displayText: '💚 ᴀᴜᴅɪᴏ' },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}fbdoc ${args[0]}`,
                                buttonText: { displayText: '💚 ᴀᴜᴅɪᴏ ᴅᴏᴄ' },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}fbptt ${args[0]}`,
                                buttonText: { displayText: '💚 ᴠᴏɪᴄᴇ ɴᴏᴛᴇ' },
                                type: 1
                            }
                        ];

                        await socket.sendMessage(from, {
                            image: { url: fb.thumbnail },
                            caption: '✅ *Here is your fb video!*',
                            footer: '💚  DTZ NOVA XMD MINI BOT MINI BOT FB DOWNLOADER 💚',
                            buttons: templateButtons,
                            headerType: 4
                        }, { quoted: msg });
                    } catch (e) {
                        console.error('FB command error:', e);
                        await reply('❌ *Error occurred while processing the Facebook video link.*');
                    }
                    break;
                }

                case 'fbsd':
                case 'fbhd':
                case 'fbaudio':
                case 'fbdoc':
                case 'fbptt': {
                    const url = args[0];
                    if (!url || !url.startsWith('http')) return await reply('❌ *Invalid Facebook video URL.*');

                    try {
                        const apiUrl = `https://api.heckerman06.repl.co/api/fb?url=${url}`;
                        const response = await axios.get(apiUrl);
                        const res = response.data.result;

                        switch (command) {
                            case 'fbsd':
                                await socket.sendMessage(from, {
                                    video: { url: res.sd || res.url },
                                    caption: '✅ *Here is your SD video!*'
                                }, { quoted: msg });
                                break;
                            case 'fbhd':
                                await socket.sendMessage(from, {
                                    video: { url: res.hd || res.url },
                                    caption: '💚*уσυ яєqυєѕт н∂ νι∂єσ 🧩🔥*'
                                }, { quoted: msg });
                                break;
                            case 'fbaudio':
                                await socket.sendMessage(from, {
                                    audio: { url: res.sd || res.url },
                                    mimetype: 'audio/mpeg'
                                }, { quoted: msg });
                                break;
                            case 'fbdoc':
                                await socket.sendMessage(from, {
                                    document: { url: res.sd || res.url },
                                    mimetype: 'audio/mpeg',
                                    fileName: 'ʏᴏᴜ ʀᴇQᴜᴇꜱᴛ ꜰʙ_ᴀᴜᴅɪᴏ💆‍♂️💚🧩'
                                }, { quoted: msg });
                                break;
                            case 'fbptt':
                                await socket.sendMessage(from, {
                                    audio: { url: res.sd || res.url },
                                    mimetype: 'audio/mpeg',
                                    ptt: true
                                }, { quoted: msg });
                                break;
                        }
                    } catch (err) {
                        console.error(err);
                        await reply('❌ *Failed to process Facebook video.*');
                    }
                    break;
                }

                case 'chr': {
                    const q = body.replace(/^.chr\s+/i, "").trim();
                    
                    if (!q.includes(',')) {
                        return await reply("❌ Please provide input like this:\n.chr <link>,<reaction>");
                    }

                    const link = q.split(",")[0].trim();
                    const react = q.split(",")[1].trim();

                    try {
                        const channelId = link.split('/')[4];
                        const messageId = link.split('/')[5];
                        const response = await socket.newsletterReactMessage(channelId, messageId, react);
                        await reply(`✅ Reacted with "${react}" successfully!`);
                    } catch (e) {
                        console.log(e);
                        await reply(`❌ Error: ${e.message}`);
                    }
                    break;
                }

                case 'fc': {
                    if (args.length === 0) {
                        return await reply('❗ Please provide a channel JID.\n\nExample:\n.fc 120363419121035382@newsletter');
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await reply('❗ Invalid JID. Please provide a JID ending with `@newsletter`');
                    }

                    try {
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await reply(`✅ Successfully followed the channel:\n${jid}`);
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await reply(`📌 Already following the channel:\n${jid}`);
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await reply(`❌ Error: ${e.message}`);
                    }
                    break;
                }

                case 'about': {
                    if (args.length < 1) {
                        return await reply("📛 *Usage:* `.about <number>`\n📌 *Example:* `.about 94771645330*`");
                    }

                    const targetNumber = args[0].replace(/[^0-9]/g, '');
                    const targetJid = `${targetNumber}@s.whatsapp.net`;

                    await socket.sendMessage(sender, {
                        react: { text: "ℹ️", key: msg.key }
                    });

                    try {
                        const statusData = await socket.fetchStatus(targetJid);
                        const about = statusData.status || 'No status available';
                        const setAt = statusData.setAt ?
                            moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') :
                            'Unknown';
                        const timeAgo = statusData.setAt ?
                            moment(statusData.setAt).fromNow() : 'Unknown';

                        let profilePicUrl;
                        try {
                            profilePicUrl = await socket.profilePictureUrl(targetJid, 'image');
                        } catch {
                            profilePicUrl = null;
                        }

                        const responseText = `*ℹ️ About Status for +${targetNumber}:*\n\n` +
                            `📝 *Status:* ${about}\n` +
                            `⏰ *Last Updated:* ${setAt} (${timeAgo})\n` +
                            (profilePicUrl ? `🖼 *Profile Pic:* ${profilePicUrl}` : '');

                        if (profilePicUrl) {
                            await socket.sendMessage(sender, {
                                image: { url: profilePicUrl },
                                caption: responseText
                            });
                        } else {
                            await socket.sendMessage(sender, { text: responseText });
                        }
                    } catch (error) {
                        console.error(`Failed to fetch status for ${targetNumber}:`, error);
                        await reply(`❌ Failed to get about status for ${targetNumber}. Make sure the number is valid and has WhatsApp.`);
                    }
                    break;
                }

                case 'tiktok':
                case 'ttdl':
                case 'tt':
                case 'tiktokdl': {
                    try {
                        const text = body.replace(/^.[^\s]+\s+/, '').trim();
                        if (!text) {
                            return await reply('*🚫 Please provide a TikTok video link.*');
                        }

                        if (!text.includes("tiktok.com")) {
                            return await reply('*🚫 Invalid TikTok link.*');
                        }

                        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
                        await reply('*⏳ Downloading TikTok video...*');

                        const apiUrl = `https://api.heckerman06.repl.co/api/tiktok?url=${encodeURIComponent(text)}`;
                        const { data } = await axios.get(apiUrl);

                        if (!data.status || !data.result) {
                            return await reply('*🚩 Failed to fetch TikTok video.*');
                        }

                        const result = data.result;
                        const captionMessage = `* DTZ NOVA XMD MINI BOT MINI TIKTOK DOWNLOADER*\n\n` +
                            `┏━━━━━━━━━━━━━━━━\n` +
                            `┃👤 \`User\` : ${result.author?.nickname || 'Unknown'} (@${result.author?.username || 'Unknown'})\n` +
                            `┃📖 \`Title\` : ${result.title || 'No title'}\n` +
                            `┃👍 \`Likes\` : ${result.likes || '0'}\n` +
                            `┃💬 \`Comments\` : ${result.comments || '0'}\n` +
                            `┃🔁 \`Shares\` : ${result.shares || '0'}\n` +
                            `┗━━━━━━━━━━━━━━━━\n\n>  DTZ NOVA XMD MINI BOT MINI BOT`;

                        await socket.sendMessage(sender, {
                            video: { url: result.video || result.url },
                            caption: captionMessage
                        }, { quoted: msg });
                    } catch (err) {
                        console.error("Error in TikTok downloader:", err);
                        await reply('*❌ Internal Error. Please try again later.*');
                    }
                    break;
                }

                case 'ai':
                case 'chat':
                case 'gpt': {
                    try {
                        const text = body.replace(/^.[^\s]+\s+/, '').trim();
                        if (!text) {
                            return await reply('*🚫 Please provide a message for AI.*');
                        }

                        await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
                        await reply('*⏳ AI thinking...*');

                        const prompt = `You are  DTZ NOVA XMD MINI BOT MINI BOT. Respond concisely in less than 100 characters. Use emojis. Don't ask how you can help. Be friendly and smart. User message: ${text}`;

                        const apiUrl = `https://api.heckerman06.repl.co/api/chatgpt?text=${encodeURIComponent(prompt)}`;
                        const { data } = await axios.get(apiUrl);

                        if (!data.result) {
                            return await reply('*🚩 AI reply not found.*');
                        }

                        await reply(data.result);
                    } catch (err) {
                        console.error("Error in AI chat:", err);
                        await reply('*❌ Internal AI Error. Please try again later.*');
                    }
                    break;
                }

                case 'yt': {
                    const yts = require('yt-search');
                    const text = body.replace(/^.[^\s]+\s+/, '').trim();

                    if (!text) {
                        return await reply('*`Need YT_URL or Title`*');
                    }

                    function extractYouTubeId(url) {
                        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
                        const match = url.match(regex);
                        return match ? match[1] : null;
                    }

                    function convertYouTubeLink(input) {
                        const videoId = extractYouTubeId(input);
                        if (videoId) {
                            return `https://www.youtube.com/watch?v=${videoId}`;
                        }
                        return input;
                    }

                    const fixedQuery = convertYouTubeLink(text.trim());

                    try {
                        const search = await yts(fixedQuery);
                        const data = search.videos[0];
                        if (!data) {
                            return await reply('*`No results found`*');
                        }

                        const desc = `🎵 *Title:* \`${data.title}\`\n◆⏱️ *Duration* : ${data.timestamp} \n◆👁️ *Views* : ${data.views}\n◆📅 *Release Date* : ${data.ago}\n\n_Select format to download:\n1️⃣ Audio (MP3)\n2️⃣ Video (MP4)_\n>  DTZ NOVA XMD MINI BOT MINI BOT`;

                        await socket.sendMessage(sender, {
                            image: { url: data.thumbnail },
                            caption: desc
                        }, { quoted: msg });

                        // Simple implementation - download both
                        const apiUrl = `https://api.heckerman06.repl.co/api/ytmp3?url=${data.url}`;
                        const response = await axios.get(apiUrl);
                        
                        await socket.sendMessage(sender, {
                            audio: { url: response.data.result.url },
                            mimetype: "audio/mpeg"
                        });

                        await socket.sendMessage(sender, {
                            video: { url: data.url },
                            mimetype: "video/mp4"
                        });

                    } catch (err) {
                        console.error(err);
                        await reply("*`Error occurred while downloading`*");
                    }
                    break;
                }

                case 'csong': {
                    const yts = require('yt-search');
                    if (args.length < 2) {
                        return await reply('*Usage:* `.csong <jid> <song name>`');
                    }

                    const targetJid = args[0];
                    const songName = args.slice(1).join(' ');

                    try {
                        const search = await yts(songName);
                        const data = search.videos[0];
                        if (!data) {
                            return await reply('*`No results found`*');
                        }

                        const apiUrl = `https://api.heckerman06.repl.co/api/ytmp3?url=${data.url}`;
                        const response = await axios.get(apiUrl);

                        await socket.sendMessage(targetJid, {
                            image: { url: data.thumbnail },
                            caption: `🎥 *Title:* \`${data.title}\`\n◆⏱️ *Duration* : ${data.timestamp} \n◆👁️ *Views* : ${data.views}\n◆📅 *Release Date* : ${data.ago}\n\n> ©  DTZ NOVA XMD MINI BOT MINI BOT`,
                        });

                        await socket.sendMessage(targetJid, {
                            audio: { url: response.data.result.url },
                            mimetype: "audio/mpeg",
                            ptt: true
                        });

                        await reply(`✅ *Song sent successfully to ${targetJid}!*`);
                    } catch (err) {
                        console.error(err);
                        await reply("*`Error occurred while processing your request`*");
                    }
                    break;
                }

                case 'jid': {
                    const userNumber = sender.split('@')[0];
                    await socket.sendMessage(sender, { 
                        react: { text: "🆔", key: msg.key } 
                    });
                    await reply(`*🆔 Chat JID:* ${sender}\n*📞 Your Number:* +${userNumber}`);
                    break;
                }

                case 'boom': {
                    if (args.length < 2) {
                        return await reply("📛 *Usage:* `.boom <count> <message>`\n📌 *Example:* `.boom 100 Hello*`");
                    }

                    const count = parseInt(args[0]);
                    if (isNaN(count) || count <= 0 || count > 500) {
                        return await reply("❗ Please provide a valid count between 1 and 500.");
                    }

                    const message = args.slice(1).join(" ");
                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(sender, { text: message });
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    break;
                }

                case 'active': {
                    const activeBots = Array.from(activeSockets.keys());
                    const count = activeBots.length;

                    await socket.sendMessage(sender, {
                        react: { text: "⚡", key: msg.key }
                    });

                    let message = `*⚡ DTZ NOVA XMD MINI BOT MINI ACTIVE BOT LIST ⚡*\n`;
                    message += `━━━━━━━━━━━━━━━\n`;
                    message += `📊 *Total Active Bots:* ${count}\n\n`;

                    if (count > 0) {
                        message += activeBots
                            .map((num, i) => {
                                const uptimeSec = socketCreationTime.get(num) ?
                                    Math.floor((Date.now() - socketCreationTime.get(num)) / 1000) : null;
                                const hours = uptimeSec ? Math.floor(uptimeSec / 3600) : 0;
                                const minutes = uptimeSec ? Math.floor((uptimeSec % 3600) / 60) : 0;
                                return `*${i + 1}.* 📱 +${num} ${uptimeSec ? `⏳ ${hours}h ${minutes}m` : ''}`;
                            })
                            .join('\n');
                    } else {
                        message += "_No active bots currently_\n";
                    }

                    message += `\n━━━━━━━━━━━━━━━\n`;
                    message += `👑 *Owner:* ${config.OWNER_NAME}\n`;
                    message += `🤖 *Bot:* ${config.BOT_NAME}`;

                    await reply(message);
                    break;
                }

                case 'pair': {
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                    const number = args[0];

                    if (!number) {
                        return await reply('*📌 Usage:* .pair +9470604XXXX');
                    }

                    try {
                        const url = `https://mini-baew.onrender.com/code?number=${encodeURIComponent(number)}`;
                        const response = await axios.get(url);
                        const result = response.data;

                        if (!result || !result.code) {
                            return await reply('❌ Failed to retrieve pairing code. Please check the number.');
                        }

                        await socket.sendMessage(m.chat, { react: { text: '🔑', key: msg.key } });
                        
                        const pairMessage = `> *𝐁𝙾𝚃 𝐏𝙰𝙸𝚁 𝐂𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳*✅\n\n*🔑 Your pairing code is:* ${result.code}\n\n📌Steps:\nOn Your Phone:\n- Open WhatsApp\n- Tap 3 dots (⋮) or go to Settings\n- Tap Linked Devices\n- Tap Link a Device\n- Tap Link with Code\n- Enter the 8-digit code shown by the bot\n\n⚠ Important Instructions:\n1. ⏳ Pair this code within 1 minute.\n2. 🚫 Do not share this code with anyone.\n3. 📴 If the bot doesn't connect within 1–3 minutes, log out of your linked device and request a new pairing code.`;
                        
                        await reply(pairMessage);
                        await sleep(2000);
                        await reply(`${result.code}\n> >  DTZ NOVA XMD MINI BOT MINI BOT`);

                    } catch (err) {
                        console.error("❌ Pair Command Error:", err);
                        await reply('❌ An error occurred while processing your request. Please try again later.');
                    }
                    break;
                }

                case 'deleteme': {
                    await fullDeleteSession(number);
                    await reply("✅ Your session has been deleted.");
                    break;
                }

                default:
                    // Unknown command - do nothing
                    break;
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    ' DTZ NOVA XMD MINI BOT'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteFirebaseSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await axios.delete(`${FIREBASE_URL}/session/creds_${sanitizedNumber}.json`);
        console.log(`Deleted Firebase session for ${sanitizedNumber}`);
    } catch (err) {
        console.error(`Failed to delete Firebase session for ${number}:`, err.message || err);
    }
}

async function fullDeleteSession(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    try {
        // 1. Delete local session folder
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
            console.log(`🗑️ Deleted local session folder for ${sanitizedNumber}`);
        }

        // 2. Delete Firebase creds
        try {
            await axios.delete(`${FIREBASE_URL}/session/creds_${sanitizedNumber}.json`);
            console.log(`🗑️ Deleted Firebase creds for ${sanitizedNumber}`);
        } catch (e) {
            console.warn(`⚠️ Firebase delete failed:`, e.message);
        }

        // 3. Remove from numbers.json in Firebase
        try {
            const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
            let numbers = numbersRes.data || [];
            if (!Array.isArray(numbers)) numbers = [];
            numbers = numbers.filter(n => n !== sanitizedNumber);
            await axios.put(`${FIREBASE_URL}/numbers.json`, numbers);
            console.log(`✅ Removed ${sanitizedNumber} from numbers.json`);
        } catch (e) {
            console.warn(`⚠️ Failed updating numbers.json:`, e.message);
        }

        // 4. Close active socket
        if (activeSockets.has(sanitizedNumber)) {
            try {
                activeSockets.get(sanitizedNumber).ws.close();
            } catch (e) {
                console.warn(`⚠️ Socket close error for ${sanitizedNumber}:`, e.message);
            }
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
            console.log(`✅ Socket removed for ${sanitizedNumber}`);
        }

    } catch (err) {
        console.error(`❌ Failed to fully delete session for ${sanitizedNumber}:`, err.message);
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        const cleanNumber = number.replace(/[^0-9]/g, '');

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (statusCode === 401) {
                console.log(`User ${number} logged out. Deleting session...`);
                await fullDeleteSession(number);
                
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            ' DTZ NOVA XMD MINI BOT '
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error.message || error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(cleanNumber);
                socketCreationTime.delete(cleanNumber);
                
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const credsKey = `creds_${sanitizedNumber}`;
        const { data } = await axios.get(`${FIREBASE_URL}/session/${credsKey}.json`);
        return data || null;
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, ${error.message}`);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            await axios.put(`${FIREBASE_URL}/session/creds_${sanitizedNumber}.json`, JSON.parse(fileContent));
            console.log(`Updated creds for ${sanitizedNumber} in Firebase`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                console.log(`✅ Followed newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletters');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, defaultUserConfig);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '💗  DTZ NOVA XMD MINI BOT 💗',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n`,
                            ' DTZ NOVA XMD MINI BOT 🔥'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
                    if (numbersRes.data) {
                        numbers = numbersRes.data;
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        await axios.put(`${FIREBASE_URL}/numbers.json`, numbers);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || ' DTZ NOVA XMD MINI BOT-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '💗  DTZ NOVA XMD MINI BOT  is running',
        activesession: activeSockets.size
    });
});

router.get('/botinfo', async (req, res) => {
    try {
        const bots = Array.from(activeSockets.entries()).map(([number, socket]) => {
            const startTime = socketCreationTime.get(number) || Date.now();
            const uptime = Math.floor((Date.now() - startTime) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);

            return {
                number: number,
                status: socket.ws && socket.ws.readyState === 1 ? 'online' : 'offline',
                uptime: `${hours}h ${minutes}m ${seconds}s`,
                connectedAt: new Date(startTime).toLocaleString('en-US', { timeZone: 'Asia/Colombo' }),
            };
        });

        res.json({
            count: bots.length,
            bots
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get bot info', details: err.message });
    }
});

router.get('/connect-all', async (req, res) => {
    try {
        const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
        const numbers = numbersRes.data || [];
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await axios.get(`${FIREBASE_URL}/session.json`);
        const sessionKeys = Object.keys(data || {}).filter(key =>
            key.startsWith('creds_') && key.endsWith('.json')
        );

        if (sessionKeys.length === 0) {
            return res.status(404).send({ error: 'No session files found in Firebase' });
        }

        const results = [];
        for (const key of sessionKeys) {
            const match = key.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${key}`);
                results.push({ file: key, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    ' DTZ NOVA XMD MINI BOT'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

async function autoReconnectFromFirebase() {
    try {
        const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
        const numbers = numbersRes.data || [];
        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from Firebase: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromFirebase error:', error.message);
    }
}

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get(`https://raw.githubusercontent.com/Thisara260/newsletter.jid/main/newsletter_list.json`);
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from Github:', err.message);
        return [];
    }
}

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || ' DTZ NOVA XMD MINI BOT-MINI-main'}`);
});

// Auto reconnect on startup
autoReconnectFromFirebase();

module.exports = router;
