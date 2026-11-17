-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paidAmount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "txnId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "verifiedAmount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "adminRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_txnId_key" ON "PaymentTransaction"("txnId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_paymentId_status_idx" ON "PaymentTransaction"("paymentId", "status");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
