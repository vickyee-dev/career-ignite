-- CreateTable
CREATE TABLE "opportunities" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "department" VARCHAR(255) NOT NULL,
    "opportunity_type" VARCHAR(255) NOT NULL,
    "opportunity_description" TEXT NOT NULL,
    "core_competencies" TEXT NOT NULL,
    "compensation_type" VARCHAR(255) NOT NULL,
    "compensation_currency" VARCHAR(255) NOT NULL,
    "compensation_amount" DOUBLE PRECISION NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_by" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);
