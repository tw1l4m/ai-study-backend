const express      = require('express');
const cors         = require('cors');

const { jsonHeaders } = require('./middleware/jsonHeaders');

const healthRouter       = require('./routes/health');
const usersRouter        = require('./routes/users');
const participantsRouter = require('./routes/participants');
const chatRouter         = require('./routes/chat');
const adminRouter        = require('./routes/admin');

const app = express();

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb', type: ['application/json', 'text/plain'] }));
app.use(jsonHeaders);
app.use(cors({ origin: '*' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/',               healthRouter);
app.use('/api/users',      usersRouter);
app.use('/api/participants', participantsRouter);
app.use('/api/chat',       chatRouter);
app.use('/api/admin',      adminRouter);

module.exports = app;
