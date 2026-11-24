require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API routes
const apiRoutes = require('./src/routes/api');
app.use('/api', apiRoutes);

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Staff page direct route
app.get('/staff', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'staff.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'goSTOPS-connect'
  });
});

// Start server when run directly
if (require.main === module) {
  const { seedDemoUsers } = require('./src/seed');
  app.listen(PORT, async () => {
    console.log(`goSTOPS-connect server running on port ${PORT}`);
    try {
      await seedDemoUsers();
    } catch (err) {
      console.error('Error seeding demo users:', err);
    }
  });
}

module.exports = app;
