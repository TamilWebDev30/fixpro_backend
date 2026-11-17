
const prisma = require('../db');

// Get payment settings
exports.getPaymentSettings = async (req, res, next) => {
  try {
    const settings = await prisma.setting.findMany({
      where: {
        key: {
          in: [
            'payment_method',
            'upi_enabled',
            'upi_id',
            'upi_payee_name',
            'payment_instructions'
          ]
        }
      }
    });

    const result = Object.fromEntries(
      settings.map(item => [item.key, item.value])
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

// Update payment settings
exports.updatePaymentSettings = async (req, res, next) => {
  try {
    const {
      paymentMethod,
      upiEnabled,
      upiId,
      upiPayeeName,
      paymentInstructions
    } = req.body;

    if (upiEnabled && (!upiId || !upiPayeeName)) {
      return res.status(400).json({
        message: 'UPI ID and payee name are required'
      });
    }

    const values = {
      payment_method: paymentMethod,
      upi_enabled: String(upiEnabled),
      upi_id: upiId || '',
      upi_payee_name: upiPayeeName || '',
      payment_instructions: paymentInstructions || ''
    };

    await prisma.$transaction(
      Object.entries(values).map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value }
        })
      )
    );

    res.json({
      success: true,
      message: 'Payment settings updated successfully'
    });
  } catch (error) {
    next(error);
  }
};
