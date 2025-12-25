const {
    downloadContentFromMessage,
    getContentType,
    proto
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const downloadMediaMessage = async (message, filename, attachExtension = true) => {
    try {
        if (!message || !message.msg) return null;
        
        const mimeMap = {
            'imageMessage': 'image',
            'videoMessage': 'video', 
            'audioMessage': 'audio',
            'stickerMessage': 'sticker',
            'documentMessage': 'document'
        };
        
        const msgType = message.type || message.mtype;
        const mediaType = mimeMap[msgType] || 'document';
        
        const stream = await downloadContentFromMessage(message.msg, mediaType);
        let buffer = Buffer.from([]);
        
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        
        if (filename) {
            const ext = mediaType === 'image' ? 'jpg' : 
                       mediaType === 'video' ? 'mp4' : 
                       mediaType === 'audio' ? 'mp3' : 
                       mediaType === 'sticker' ? 'webp' : 'bin';
            
            const fullPath = attachExtension ? `${filename}.${ext}` : filename;
            const filePath = path.join(__path, 'temp', fullPath);
            
            fs.writeFileSync(filePath, buffer);
            return { buffer, path: filePath, type: mediaType };
        }
        
        return buffer;
    } catch (error) {
        console.error('Download media error:', error);
        return null;
    }
};

const sms = (conn, m) => {
    if (!m || !conn) {
        console.error('Invalid message or connection');
        return null;
    }
    
    // Basic message properties
    if (m.key) {
        m.id = m.key.id;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = m.fromMe ? 
            (conn.user?.id?.split(':')[0] + '@s.whatsapp.net' || conn.user?.id) : 
            (m.isGroup ? m.key.participant : m.key.remoteJid);
    }
    
    // Parse message content
    if (m.message) {
        m.type = getContentType(m.message);
        
        // Handle different message types
        if (m.type === 'conversation') {
            m.body = m.message.conversation;
        } else if (m.type === 'extendedTextMessage') {
            m.body = m.message.extendedTextMessage.text;
        } else if (m.type === 'imageMessage') {
            m.body = m.message.imageMessage.caption || '';
            m.msg = m.message.imageMessage;
        } else if (m.type === 'videoMessage') {
            m.body = m.message.videoMessage.caption || '';
            m.msg = m.message.videoMessage;
        } else if (m.type === 'audioMessage') {
            m.body = m.message.audioMessage.caption || '';
            m.msg = m.message.audioMessage;
        } else {
            m.body = '';
        }
        
        // Handle quoted messages
        if (m.message.extendedTextMessage?.contextInfo?.quotedMessage) {
            m.quoted = m.message.extendedTextMessage.contextInfo.quotedMessage;
            m.quoted.sender = m.message.extendedTextMessage.contextInfo.participant;
        }
    }
    
    // Reply method
    m.reply = async (text, options = {}) => {
        try {
            return await conn.sendMessage(m.chat, { text }, { 
                quoted: m,
                ...options 
            });
        } catch (error) {
            console.error('Reply error:', error);
            return null;
        }
    };
    
    // Send image
    m.replyImage = async (image, caption = '', options = {}) => {
        try {
            return await conn.sendMessage(m.chat, {
                image: typeof image === 'string' ? { url: image } : image,
                caption: caption
            }, { 
                quoted: m,
                ...options 
            });
        } catch (error) {
            console.error('Reply image error:', error);
            return null;
        }
    };
    
    // Send video
    m.replyVideo = async (video, caption = '', options = {}) => {
        try {
            return await conn.sendMessage(m.chat, {
                video: typeof video === 'string' ? { url: video } : video,
                caption: caption
            }, { 
                quoted: m,
                ...options 
            });
        } catch (error) {
            console.error('Reply video error:', error);
            return null;
        }
    };
    
    // Send audio
    m.replyAudio = async (audio, options = {}) => {
        try {
            return await conn.sendMessage(m.chat, {
                audio: typeof audio === 'string' ? { url: audio } : audio,
                mimetype: 'audio/mpeg',
                ptt: options.ptt || false
            }, { 
                quoted: m,
                ...options 
            });
        } catch (error) {
            console.error('Reply audio error:', error);
            return null;
        }
    };
    
    // React to message
    m.react = async (emoji) => {
        try {
            return await conn.sendMessage(m.chat, {
                react: {
                    text: emoji,
                    key: m.key
                }
            });
        } catch (error) {
            console.error('React error:', error);
            return null;
        }
    };
    
    // Download media
    m.download = (filename) => downloadMediaMessage(m, filename);
    
    return m;
};

module.exports = {
    sms,
    downloadMediaMessage
};
