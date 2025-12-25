const {
    proto,
    downloadContentFromMessage,
    getContentType
} = require('baileys');
const fs = require('fs');
const path = require('path');

// Download media message
const downloadMediaMessage = async (m, filename) => {
    try {
        if (m.type === 'viewOnceMessage') {
            m.type = m.msg.type;
        }
        
        if (!m.msg) {
            throw new Error('No message content');
        }
        
        let buffer = Buffer.from([]);
        let filePath = '';
        
        if (m.type === 'imageMessage') {
            const stream = await downloadContentFromMessage(m.msg, 'image');
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            filePath = filename ? filename + '.jpg' : 'image_' + Date.now() + '.jpg';
            
        } else if (m.type === 'videoMessage') {
            const stream = await downloadContentFromMessage(m.msg, 'video');
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            filePath = filename ? filename + '.mp4' : 'video_' + Date.now() + '.mp4';
            
        } else if (m.type === 'audioMessage') {
            const stream = await downloadContentFromMessage(m.msg, 'audio');
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            filePath = filename ? filename + '.mp3' : 'audio_' + Date.now() + '.mp3';
            
        } else if (m.type === 'stickerMessage') {
            const stream = await downloadContentFromMessage(m.msg, 'sticker');
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            filePath = filename ? filename + '.webp' : 'sticker_' + Date.now() + '.webp';
            
        } else if (m.type === 'documentMessage') {
            const stream = await downloadContentFromMessage(m.msg, 'document');
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            const ext = m.msg.fileName ? 
                m.msg.fileName.split('.').pop().toLowerCase() : 
                'bin';
            filePath = filename ? filename + '.' + ext : 'document_' + Date.now() + '.' + ext;
            
        } else {
            throw new Error('Unsupported message type: ' + m.type);
        }
        
        // Ensure media directory exists
        const mediaDir = path.join(process.cwd(), 'media');
        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }
        
        // Save file
        const fullPath = path.join(mediaDir, filePath);
        fs.writeFileSync(fullPath, buffer);
        
        console.log(`✅ Downloaded media: ${fullPath}`);
        return fs.readFileSync(fullPath);
        
    } catch (error) {
        console.error('❌ Download media error:', error);
        throw error;
    }
};

// Process and enhance message
const sms = (conn, m) => {
    if (!m) return m;
    
    // Extract basic message info
    if (m.key) {
        m.id = m.key.id;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = m.fromMe ? 
            (conn.user.id.split(':')[0] + '@s.whatsapp.net') : 
            (m.isGroup ? m.key.participant : m.chat);
    }
    
    // Process message content
    if (m.message) {
        m.type = getContentType(m.message);
        
        // Handle view once messages
        if (m.type === 'viewOnceMessage') {
            m.msg = m.message[m.type].message[getContentType(m.message[m.type].message)];
            if (m.msg) {
                m.msg.type = getContentType(m.message[m.type].message);
            }
        } else {
            m.msg = m.message[m.type];
        }
        
        if (m.msg) {
            // Extract mentions
            const quotedMention = m.msg.contextInfo?.participant || '';
            const tagMention = m.msg.contextInfo?.mentionedJid || [];
            const mention = typeof tagMention === 'string' ? [tagMention] : tagMention;
            if (quotedMention) mention.push(quotedMention);
            m.mentionUser = mention.filter(x => x);
            
            // Extract text body
            m.body = (m.type === 'conversation') ? m.msg :
                    (m.type === 'extendedTextMessage') ? m.msg.text :
                    (m.type === 'imageMessage' && m.msg.caption) ? m.msg.caption :
                    (m.type === 'videoMessage' && m.msg.caption) ? m.msg.caption :
                    (m.type === 'templateButtonReplyMessage') ? m.msg.selectedId :
                    (m.type === 'buttonsResponseMessage') ? m.msg.selectedButtonId :
                    '';
            
            // Handle quoted message
            m.quoted = m.msg.contextInfo?.quotedMessage || null;
            
            if (m.quoted) {
                m.quoted.type = getContentType(m.quoted);
                m.quoted.id = m.msg.contextInfo.stanzaId;
                m.quoted.sender = m.msg.contextInfo.participant;
                m.quoted.fromMe = m.quoted.sender.split('@')[0].includes(conn.user.id.split(':')[0]);
                
                // Get quoted message content
                if (m.quoted.type === 'viewOnceMessage') {
                    m.quoted.msg = m.quoted[m.quoted.type].message[getContentType(m.quoted[m.quoted.type].message)];
                    if (m.quoted.msg) {
                        m.quoted.msg.type = getContentType(m.quoted[m.quoted.type].message);
                    }
                } else {
                    m.quoted.msg = m.quoted[m.quoted.type];
                }
                
                // Extract quoted mentions
                const quoted_quotedMention = m.quoted.msg?.contextInfo?.participant || '';
                const quoted_tagMention = m.quoted.msg?.contextInfo?.mentionedJid || [];
                const quoted_mention = typeof quoted_tagMention === 'string' ? [quoted_tagMention] : quoted_tagMention;
                if (quoted_quotedMention) quoted_mention.push(quoted_quotedMention);
                m.quoted.mentionUser = quoted_mention.filter(x => x);
                
                // Create fake object for operations
                m.quoted.fakeObj = proto.WebMessageInfo.fromObject({
                    key: {
                        remoteJid: m.chat,
                        fromMe: m.quoted.fromMe,
                        id: m.quoted.id,
                        participant: m.quoted.sender
                    },
                    message: m.quoted
                });
                
                // Add download method to quoted
                m.quoted.download = (filename) => downloadMediaMessage(m.quoted, filename);
                
                // Add delete method
                m.quoted.delete = async () => {
                    try {
                        await conn.sendMessage(m.chat, {
                            delete: m.quoted.fakeObj.key
                        });
                    } catch (error) {
                        console.error('Delete error:', error);
                    }
                };
                
                // Add react method
                m.quoted.react = async (emoji) => {
                    try {
                        await conn.sendMessage(m.chat, {
                            react: {
                                text: emoji,
                                key: m.quoted.fakeObj.key
                            }
                        });
                    } catch (error) {
                        console.error('React error:', error);
                    }
                };
            }
            
            // Add download method to main message
            m.download = (filename) => downloadMediaMessage(m, filename);
        }
    }
    
    // Reply methods
    m.reply = async (text, id = m.chat, options = {}) => {
        try {
            return await conn.sendMessage(id, {
                text: String(text),
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            });
        } catch (error) {
            console.error('Reply error:', error);
            throw error;
        }
    };
    
    m.replyS = async (sticker, id = m.chat, options = {}) => {
        try {
            return await conn.sendMessage(id, {
                sticker: Buffer.isBuffer(sticker) ? sticker : { url: sticker },
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            });
        } catch (error) {
            console.error('Sticker reply error:', error);
            throw error;
        }
    };
    
    m.replyImg = async (image, caption = '', id = m.chat, options = {}) => {
        try {
            return await conn.sendMessage(id, {
                image: Buffer.isBuffer(image) ? image : { url: image },
                caption: String(caption),
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            });
        } catch (error) {
            console.error('Image reply error:', error);
            throw error;
        }
    };
    
    m.replyVid = async (video, caption = '', id = m.chat, options = {}) => {
        try {
            return await conn.sendMessage(id, {
                video: Buffer.isBuffer(video) ? video : { url: video },
                caption: String(caption),
                gifPlayback: options.gif || false,
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            });
        } catch (error) {
            console.error('Video reply error:', error);
            throw error;
        }
    };
    
    m.replyAud = async (audio, id = m.chat, options = {}) => {
        try {
            return await conn.sendMessage(id, {
                audio: Buffer.isBuffer(audio) ? audio : { url: audio },
                ptt: options.ptt || false,
                mimetype: 'audio/mpeg',
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            });
        } catch (error) {
            console.error('Audio reply error:', error);
            throw error;
        }
    };
    
    m.replyDoc = async (document, id = m.chat, options = {}) => {
        try {
            return await conn.sendMessage(id, {
                document: Buffer.isBuffer(document) ? document : { url: document },
                mimetype: options.mimetype || 'application/octet-stream',
                fileName: options.filename || 'document',
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            });
        } catch (error) {
            console.error('Document reply error:', error);
            throw error;
        }
    };
    
    m.replyContact = async (name, number, id = m.chat) => {
        try {
            const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;type=CELL;type=VOICE;waid=${number.replace('+', '')}:${number}
END:VCARD`;
            
            return await conn.sendMessage(id, {
                contacts: {
                    displayName: name,
                    contacts: [{ vcard }]
                }
            }, {
                quoted: m
            });
        } catch (error) {
            console.error('Contact reply error:', error);
            throw error;
        }
    };
    
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
            throw error;
        }
    };
    
    return m;
};

module.exports = {
    sms,
    downloadMediaMessage
};
