
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

// Security middleware.
app.use(helmet());

// CORS configuration.
app.use(cors());

// Parse JSON request bodies.
app.use(express.json());

// Health check API.
app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'HomeServices API is running',
  });
});

// Authentication routes.
app.use('/api/auth', require('./routes/auth.routes'));

// Admin routes.
app.use('/api/admin', require('./routes/admin.routes'));

// Category routes.
app.use('/api/categories', require('./routes/category.routes'));

// Service routes.
app.use('/api/services', require('./routes/service.routes'));

// Booking routes.
app.use('/api/bookings', require('./routes/booking.routes'));

// Review routes.
app.use('/api/reviews', require('./routes/review.routes'));

// Provider routes.
app.use('/api/provider', require('./routes/provider.routes'));

// Notification routes.
app.use('/api/notifications', require('./routes/notification.routes'));

// Customer routes.
app.use('/api/customer', require('./routes/customer.routes'));

// Public provider routes.
app.use('/api/providers', require('./routes/public.routes'));

// Payment routes.
app.use('/api/payments', require('./routes/payment.routes'));

// Payment settings routes.
app.use('/api/settings', require('./routes/settings.routes'));

// Unknown API route.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
  });
});

// Global error handler.
// Must be registered after all routes.
app.use((err, req, res, next) => {
  console.error('API Error:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.status && err.status < 500
      ? err.message
      : 'Internal server error',
  });
});

module.exports = app;
