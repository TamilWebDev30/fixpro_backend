
require('dotenv').config();

const app = require('./src/app');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`HomeServices API running on http://localhost:${PORT}`);
});

// Handle server errors.
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
  } else {
    console.error('Server startup error:', error);
  }

  process.exit(1);
});
