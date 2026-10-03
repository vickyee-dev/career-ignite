-- CreateTable
CREATE TABLE "Applicant" (
    "id" SERIAL NOT NULL,
    "first_name" VARCHAR(25) NOT NULL,
    "middle_name" VARCHAR(25) NOT NULL,
    "last_name" VARCHAR(25) NOT NULL,
    "phone_number" VARCHAR(50) NOT NULL,
    "email_address" VARCHAR(150) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_by" VARCHAR(25) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(50),
    "first_name" VARCHAR(50) NOT NULL,
    "middle_name" VARCHAR(50) NOT NULL,
    "last_name" VARCHAR(50) NOT NULL,
    "phone_number" VARCHAR(30),
    "cohort" VARCHAR(150),
    "email_address" VARCHAR(200),
    "password" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL,
    "created_by" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
