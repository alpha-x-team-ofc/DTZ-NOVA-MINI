const express = require('express');
const app = express();
const __path = process.cwd();
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
const pairRouter = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/code', pairRouter);
app.use('/pair', (req, res) => {
    res.sendFile(__path + '/pair.html');
});
app.use('/', (req, res) => {
    res.sendFile(__path + '/main.html');
});

// API endpoint for pair code generation
app.get('/api/pair', async (req, res) => {
    try {
        const { number } = req.query;
        if (!number) {
            return res.status(400).json({ error: 'Number is required' });
        }
        
        // Forward to pair router
        const mockRes = {
            status: function(code) {
                this.statusCode = code;
                return this;
            },
            json: function(data) {
                res.status(this.statusCode || 200).json(data);
            },
            send: function(data) {
                res.status(this.statusCode || 200).send(data);
            }
        };
        
        await pairRouter.handle(req, mockRes);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════╗
║   🚀 DTZ NOVA X MD BOT STARTED     ║
╠════════════════════════════════════╣
║  PORT: ${PORT}                    ║
║  URL: http://localhost:${PORT}   ║
║  Owner: Dulina Nethmiura          ║
║  Version: 1.0.0                   ║
╚════════════════════════════════════╝
`);
});
