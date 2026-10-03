/*
  Warnings:

  - A unique constraint covering "User"."email_address" is added (needed for login).
    The migration fails if duplicate e-mail addresses already exist: de-duplicate them first.
  - A unique constraint covering ("user_id", "opportunity_id") is added to "opportunity_user".
    The migration fails if a user already has several rows for the same opportunity.
*/

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" VARCHAR(30) NOT NULL DEFAULT 'INTERN',
ALTER COLUMN "middle_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "opportunity_user" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" VARCHAR(30) NOT NULL DEFAULT 'APPLIED';

-- CreateIndex
CREATE UNIQUE INDEX "User_email_address_key" ON "User"("email_address");

-- CreateIndex
CREATE INDEX "opportunities_is_active_expiry_date_idx" ON "opportunities"("is_active", "expiry_date");

-- CreateIndex
CREATE INDEX "documents_user_id_idx" ON "documents"("user_id");

-- CreateIndex
CREATE INDEX "opportunity_user_opportunity_id_idx" ON "opportunity_user"("opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_user_user_id_opportunity_id_key" ON "opportunity_user"("user_id", "opportunity_id");
