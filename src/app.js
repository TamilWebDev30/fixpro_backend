require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
app.use(helmet());
app.use(cors());            // tighten to your real origins before production
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/categories', require('./routes/category.routes'));
app.use('/api/services', require('./routes/service.routes'));
app.use('/api/bookings', require('./routes/booking.routes'));
app.use('/api/reviews', require('./routes/review.routes'));
app.use('/api/provider', require('./routes/provider.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/customer', require('./routes/customer.routes'));
app.use('/api/providers', require('./routes/public.routes'));
app.use('/api/payments', require('./routes/payment.routes'));

// Keep your error-handling middleware AFTER all routes.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Server error' });
});

module.exports = app;