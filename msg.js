[file name]: msg.js
[file content begin]
const {
    proto,
    downloadContentFromMessage,
    getContentType
} = require('@whiskeysockets/baileys')
const fs = require('fs')
const { default: makeWASocket } = require('@whiskeysockets/baileys')

const downloadMediaMessage = async (m, filename) => {
    if (m.type === 'viewOnceMessage') {
        m.type = m.msg.type
    }
    
    let fileType = '';
    let fileExtension = '';
    
    if (m.type === 'imageMessage') {
        fileType = 'image'
        fileExtension = 'jpg'
        var nameJpg = filename ? `${filename}.${fileExtension}` : `image_${Date.now()}.${fileExtension}`
        const stream = await downloadContentFromMessage(m.msg, fileType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameJpg, buffer)
        return { buffer, path: nameJpg, type: fileType }
    } else if (m.type === 'videoMessage') {
        fileType = 'video'
        fileExtension = 'mp4'
        var nameMp4 = filename ? `${filename}.${fileExtension}` : `video_${Date.now()}.${fileExtension}`
        const stream = await downloadContentFromMessage(m.msg, fileType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameMp4, buffer)
        return { buffer, path: nameMp4, type: fileType }
    } else if (m.type === 'audioMessage') {
        fileType = 'audio'
        fileExtension = 'mp3'
        var nameMp3 = filename ? `${filename}.${fileExtension}` : `audio_${Date.now()}.${fileExtension}`
        const stream = await downloadContentFromMessage(m.msg, fileType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameMp3, buffer)
        return { buffer, path: nameMp3, type: fileType }
    } else if (m.type === 'stickerMessage') {
        fileType = 'sticker'
        fileExtension = 'webp'
        var nameWebp = filename ? `${filename}.${fileExtension}` : `sticker_${Date.now()}.${fileExtension}`
        const stream = await downloadContentFromMessage(m.msg, fileType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameWebp, buffer)
        return { buffer, path: nameWebp, type: fileType }
    } else if (m.type === 'documentMessage') {
        fileType = 'document'
        const originalExt = m.msg.fileName ? m.msg.fileName.split('.').pop().toLowerCase() : 'pdf'
        fileExtension = originalExt === 'jpeg' ? 'jpg' : 
                       originalExt === 'png' ? 'jpg' : 
                       originalExt === 'm4a' ? 'mp3' : 
                       originalExt
        var nameDoc = filename ? `${filename}.${fileExtension}` : `document_${Date.now()}.${fileExtension}`
        const stream = await downloadContentFromMessage(m.msg, fileType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameDoc, buffer)
        return { buffer, path: nameDoc, type: fileType, mimetype: m.msg.mimetype }
    }
    
    return null
}

const sms = (conn, m) => {
    if (!m || !conn) {
        console.error('Invalid message or connection in sms function')
        return null
    }
    
    if (m.key) {
        m.id = m.key.id
        m.chat = m.key.remoteJid
        m.fromMe = m.key.fromMe
        m.isGroup = m.chat.endsWith('@g.us')
        m.sender = m.fromMe ? (conn.user?.id?.split(':')[0] + '@s.whatsapp.net' || conn.user?.id) : 
                   m.isGroup ? m.key.participant : m.key.remoteJid
    }
    
    if (m.message) {
        m.type = getContentType(m.message)
        m.msg = (m.type === 'viewOnceMessage') ? 
                m.message[m.type]?.message?.[getContentType(m.message[m.type]?.message)] : 
                m.message[m.type]
        
        if (m.msg) {
            if (m.type === 'viewOnceMessage') {
                m.msg.type = getContentType(m.message[m.type]?.message)
            }
            
            var quotedMention = m.msg.contextInfo != null ? m.msg.contextInfo.participant : ''
            var tagMention = m.msg.contextInfo != null ? m.msg.contextInfo.mentionedJid : []
            var mention = typeof(tagMention) == 'string' ? [tagMention] : tagMention
            mention != undefined ? mention.push(quotedMention) : []
            m.mentionUser = mention != undefined ? mention.filter(x => x) : []
            
            m.body = (m.type === 'conversation') ? m.msg : 
                    (m.type === 'extendedTextMessage') ? m.msg.text : 
                    (m.type == 'imageMessage') && m.msg.caption ? m.msg.caption : 
                    (m.type == 'videoMessage') && m.msg.caption ? m.msg.caption : 
                    (m.type == 'templateButtonReplyMessage') && m.msg.selectedId ? m.msg.selectedId : 
                    (m.type == 'buttonsResponseMessage') && m.msg.selectedButtonId ? m.msg.selectedButtonId : 
                    (m.type == 'listResponseMessage') && m.msg.singleSelectReply?.selectedRowId ? m.msg.singleSelectReply.selectedRowId : 
                    ''
            
            m.quoted = m.msg.contextInfo != undefined ? m.msg.contextInfo.quotedMessage : null
            
            if (m.quoted) {
                m.quoted.type = getContentType(m.quoted)
                m.quoted.id = m.msg.contextInfo.stanzaId
                m.quoted.sender = m.msg.contextInfo.participant
                m.quoted.fromMe = m.quoted.sender?.split('@')[0]?.includes(conn.user?.id?.split(':')[0] || '')
                m.quoted.msg = (m.quoted.type === 'viewOnceMessage') ? 
                               m.quoted[m.quoted.type]?.message?.[getContentType(m.quoted[m.quoted.type]?.message)] : 
                               m.quoted[m.quoted.type]
                
                if (m.quoted.type === 'viewOnceMessage') {
                    m.quoted.msg.type = getContentType(m.quoted[m.quoted.type]?.message)
                }
                
                var quoted_quotedMention = m.quoted.msg.contextInfo != null ? m.quoted.msg.contextInfo.participant : ''
                var quoted_tagMention = m.quoted.msg.contextInfo != null ? m.quoted.msg.contextInfo.mentionedJid : []
                var quoted_mention = typeof(quoted_tagMention) == 'string' ? [quoted_tagMention] : quoted_tagMention
                quoted_mention != undefined ? quoted_mention.push(quoted_quotedMention) : []
                m.quoted.mentionUser = quoted_mention != undefined ? quoted_mention.filter(x => x) : []
                
                m.quoted.fakeObj = proto.WebMessageInfo.fromObject({
                    key: {
                        remoteJid: m.chat,
                        fromMe: m.quoted.fromMe,
                        id: m.quoted.id,
                        participant: m.quoted.sender
                    },
                    message: m.quoted
                })
                
                m.quoted.download = (filename) => downloadMediaMessage(m.quoted, filename)
                m.quoted.delete = () => {
                    try {
                        return conn.sendMessage(m.chat, {
                            delete: m.quoted.fakeObj.key
                        })
                    } catch (e) {
                        console.error('Error deleting message:', e)
                    }
                }
                m.quoted.react = (emoji) => {
                    try {
                        return conn.sendMessage(m.chat, {
                            react: {
                                text: emoji,
                                key: m.quoted.fakeObj.key
                            }
                        })
                    } catch (e) {
                        console.error('Error reacting to message:', e)
                    }
                }
            }
        }
        
        m.download = (filename) => downloadMediaMessage(m, filename)
    }

    // Reply methods
    m.reply = (text, id = m.chat, options = {}) => {
        try {
            return conn.sendMessage(id, {
                text: text,
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            })
        } catch (e) {
            console.error('Error in reply:', e)
            return null
        }
    }
    
    m.replyS = (sticker, id = m.chat, options = {}) => {
        try {
            return conn.sendMessage(id, {
                sticker: Buffer.isBuffer(sticker) ? sticker : { url: sticker },
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            })
        } catch (e) {
            console.error('Error in replyS:', e)
            return null
        }
    }
    
    m.replyImg = (image, caption, id = m.chat, options = {}) => {
        try {
            return conn.sendMessage(id, {
                image: Buffer.isBuffer(image) ? image : { url: image },
                caption: caption || '',
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            })
        } catch (e) {
            console.error('Error in replyImg:', e)
            return null
        }
    }
    
    m.replyVid = (video, caption, id = m.chat, options = {}) => {
        try {
            return conn.sendMessage(id, {
                video: Buffer.isBuffer(video) ? video : { url: video },
                caption: caption || '',
                gifPlayback: options.gif || false,
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            })
        } catch (e) {
            console.error('Error in replyVid:', e)
            return null
        }
    }
    
    m.replyAud = (audio, id = m.chat, options = {}) => {
        try {
            return conn.sendMessage(id, {
                audio: Buffer.isBuffer(audio) ? audio : { url: audio },
                ptt: options.ptt || false,
                mimetype: 'audio/mpeg',
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            })
        } catch (e) {
            console.error('Error in replyAud:', e)
            return null
        }
    }
    
    m.replyDoc = (document, id = m.chat, options = {}) => {
        try {
            return conn.sendMessage(id, {
                document: Buffer.isBuffer(document) ? document : { url: document },
                mimetype: options.mimetype || 'application/pdf',
                fileName: options.filename || 'document.pdf',
                contextInfo: {
                    mentionedJid: options.mentions || []
                }
            }, {
                quoted: m
            })
        } catch (e) {
            console.error('Error in replyDoc:', e)
            return null
        }
    }
    
    m.replyContact = (name, info, number) => {
        try {
            var vcard = 'BEGIN:VCARD\n' +
                       'VERSION:3.0\n' +
                       'FN:' + name + '\n' +
                       'ORG:' + info + ';\n' +
                       'TEL;type=CELL;type=VOICE;waid=' + number + ':+' + number + '\n' +
                       'END:VCARD'
            
            return conn.sendMessage(m.chat, {
                contacts: {
                    displayName: name,
                    contacts: [{ vcard }]
                }
            }, {
                quoted: m
            })
        } catch (e) {
            console.error('Error in replyContact:', e)
            return null
        }
    }
    
    m.react = (emoji) => {
        try {
            return conn.sendMessage(m.chat, {
                react: {
                    text: emoji,
                    key: m.key
                }
            })
        } catch (e) {
            console.error('Error in react:', e)
            return null
        }
    }

    return m
}

module.exports = {
    sms,
    downloadMediaMessage
}
[file content end]
