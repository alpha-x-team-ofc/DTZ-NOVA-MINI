const { default: makeWASocket, useMultiFileAuthState } = require('baileys');

async function testSimple() {
    console.log('🧪 Testing baileys-dtz simple connection...');
    
    const { state, saveCreds } = await useMultiFileAuthState('./test-simple');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        syncFullHistory: false
    });
    
    sock.ev.on('connection.update', (update) => {
        console.log('Connection update:', update.connection);
        if (update.qr) {
            console.log('QR Code received!');
        }
        if (update.connection === 'open') {
            console.log('✅ CONNECTED! User:', sock.user?.id);
            process.exit(0);
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    setTimeout(() => {
        console.log('❌ Timeout - Check if baileys-dtz is installed correctly');
        process.exit(1);
    }, 60000);
}

testSimple().catch(console.error);
