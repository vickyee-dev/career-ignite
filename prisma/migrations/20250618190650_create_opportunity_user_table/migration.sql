-- CreateTable
CREATE TABLE "opportunity_user" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "opportunity_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL,

    CONSTRAINT "opportunity_user_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "opportunity_user" ADD CONSTRAINT "opportunity_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_user" ADD CONSTRAINT "opportunity_user_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
