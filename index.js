const express = require('express');
const app = express();
const __path = process.cwd();
const PORT = process.env.PORT || 8000;

const pairRouter = require('./pair');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/code', pairRouter);

// Main page
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>DTZ NOVA X MD - WhatsApp Bot</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #0a0a0f, #1a1a2e);
                color: white;
                text-align: center;
                padding: 50px;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                background: rgba(30, 30, 46, 0.8);
                padding: 30px;
                border-radius: 15px;
                border: 2px solid #ff003c;
                box-shadow: 0 0 30px rgba(255, 0, 60, 0.3);
            }
            h1 {
                color: #ff003c;
                font-size: 2.5em;
                margin-bottom: 10px;
            }
            h2 {
                color: #00d9ff;
                margin-bottom: 30px;
            }
            .logo {
                width: 150px;
                height: 150px;
                margin: 0 auto 20px;
                background: url('https://files.catbox.moe/fpyw9m.png') center/cover;
                border-radius: 50%;
                border: 5px solid #00d9ff;
            }
            .status {
                background: rgba(0, 217, 255, 0.1);
                padding: 15px;
                border-radius: 10px;
                margin: 20px 0;
                border: 1px solid #00d9ff;
            }
            .btn {
                display: inline-block;
                background: linear-gradient(45deg, #ff003c, #ff2b6b);
                color: white;
                padding: 15px 30px;
                text-decoration: none;
                border-radius: 10px;
                margin: 10px;
                font-size: 1.2em;
                transition: all 0.3s;
                border: none;
                cursor: pointer;
            }
            .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 10px 20px rgba(255, 0, 60, 0.4);
            }
            .form-container {
                margin: 30px 0;
            }
            input {
                padding: 15px;
                width: 80%;
                border-radius: 10px;
                border: 2px solid #444;
                background: rgba(0,0,0,0.5);
                color: white;
                font-size: 1.1em;
                margin: 10px 0;
            }
            .result {
                margin: 20px 0;
                padding: 20px;
                background: rgba(0,0,0,0.3);
                border-radius: 10px;
                border: 1px solid #00ff88;
                display: none;
            }
            .footer {
                margin-top: 30px;
                color: #888;
                font-size: 0.9em;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo"></div>
            <h1>DTZ NOVA X MD</h1>
            <h2>WhatsApp Multi-Device Bot</h2>
            
            <div class="status">
                <h3>Status: <span id="status">Checking...</span></h3>
                <p>Active Sessions: <span id="sessions">0</span></p>
            </div>
            
            <div class="form-container">
                <h3>Connect Your WhatsApp</h3>
                <input type="text" id="number" placeholder="Enter WhatsApp number (94712345678)" maxlength="12">
                <br>
                <button class="btn" onclick="connect()">Generate Pair Code</button>
            </div>
            
            <div id="result" class="result">
                <h3 id="resultTitle"></h3>
                <p id="resultMessage"></p>
                <div id="codeDisplay" style="font-size: 2em; font-weight: bold; letter-spacing: 5px; margin: 20px 0; padding: 20px; background: rgba(0,0,0,0.5); border-radius: 10px;"></div>
            </div>
            
            <div class="footer">
                <p>© 2024 DTZ NOVA X MD | Developed by Dulina Nethmiura</p>
                <p>Powered by baileys-dtz | Server Port: ${PORT}</p>
            </div>
        </div>
        
        <script>
            async function connect() {
                const number = document.getElementById('number').value.trim();
                if (!number || number.length < 9) {
                    alert('Please enter a valid WhatsApp number (e.g., 94712345678)');
                    return;
                }
                
                document.getElementById('result').style.display = 'none';
                document.getElementById('resultTitle').textContent = 'Connecting...';
                document.getElementById('resultMessage').textContent = 'Please wait...';
                
                try {
                    const response = await fetch('/code?number=' + number);
                    const data = await response.json();
                    
                    if (data.success) {
                        document.getElementById('result').style.display = 'block';
                        
                        if (data.type === 'pairing_code') {
                            document.getElementById('resultTitle').textContent = '✅ Pairing Code Generated';
                            document.getElementById('resultMessage').textContent = data.message;
                            document.getElementById('codeDisplay').textContent = data.code;
                            document.getElementById('codeDisplay').style.display = 'block';
                            
                            // Copy to clipboard
                            navigator.clipboard.writeText(data.code);
                            alert('Code copied to clipboard!');
                            
                        } else if (data.type === 'qr') {
                            document.getElementById('resultTitle').textContent = '📱 QR Code Generated';
                            document.getElementById('resultMessage').textContent = 'Check terminal/console for QR code';
                            document.getElementById('codeDisplay').style.display = 'none';
                            
                            alert('QR code shown in terminal/console. Scan with WhatsApp.');
                            
                        } else if (data.type === 'connected') {
                            document.getElementById('resultTitle').textContent = '✅ Connected Successfully!';
                            document.getElementById('resultMessage').textContent = data.message;
                            document.getElementById('codeDisplay').style.display = 'none';
                            
                            alert('WhatsApp connected successfully! Check your WhatsApp for welcome message.');
                        }
                        
                        updateStats();
                        
                    } else {
                        alert('Error: ' + (data.error || 'Unknown error'));
                    }
                    
                } catch (error) {
                    alert('Connection failed: ' + error.message);
                    console.error('Error:', error);
                }
            }
            
            async function updateStats() {
                try {
                    const response = await fetch('/code/ping');
                    const data = await response.json();
                    document.getElementById('status').textContent = 'Online';
                    document.getElementById('status').style.color = '#00ff88';
                    
                    const active = await fetch('/code/active');
                    const activeData = await active.json();
                    if (activeData.success) {
                        document.getElementById('sessions').textContent = activeData.count;
                    }
                } catch (error) {
                    document.getElementById('status').textContent = 'Offline';
                    document.getElementById('status').style.color = '#ff003c';
                }
            }
            
            // Initial update
            updateStats();
            setInterval(updateStats, 10000);
        </script>
    </body>
    </html>
    `);
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║           🚀 DTZ NOVA X MD BOT STARTED           ║
╠══════════════════════════════════════════════════╣
║  🌐 URL: http://localhost:${PORT}                ║
║  🔧 Port: ${PORT}                                ║
║  👑 Owner: Dulina Nethmiura                      ║
║  🤖 Bot: DTZ NOVA X MD                           ║
║                                                  ║
║  📱 TO CONNECT:                                  ║
║  1. Visit http://localhost:${PORT}               ║
║  2. Enter your WhatsApp number                   ║
║  3. Click "Generate Pair Code"                   ║
║  4. Scan QR code or enter pairing code           ║
║                                                  ║
║  ⚠️  Check terminal for QR code if not showing   ║
╚══════════════════════════════════════════════════╝
    `);
});
