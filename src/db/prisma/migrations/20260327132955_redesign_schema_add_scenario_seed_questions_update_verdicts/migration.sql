/*
  Warnings:

  - You are about to drop the column `difference` on the `AnalysisResult` table. All the data in the column will be lost.
  - You are about to drop the column `judgeScore` on the `AnalysisResult` table. All the data in the column will be lost.
  - You are about to drop the column `accuracyScore` on the `JudgeVerdict` table. All the data in the column will be lost.
  - You are about to drop the column `rawResponse` on the `JudgeVerdict` table. All the data in the column will be lost.
  - You are about to drop the column `relevanceScore` on the `JudgeVerdict` table. All the data in the column will be lost.
  - You are about to drop the column `scenarioConfig` on the `ScenarioRun` table. All the data in the column will be lost.
  - You are about to drop the column `scenarioName` on the `ScenarioRun` table. All the data in the column will be lost.
  - Added the required column `coherenceScore` to the `JudgeVerdict` table without a default value. This is not possible if the table is not empty.
  - Added the required column `completenessScore` to the `JudgeVerdict` table without a default value. This is not possible if the table is not empty.
  - Added the required column `passed` to the `JudgeVerdict` table without a default value. This is not possible if the table is not empty.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "AnalysisResult" DROP COLUMN "difference",
DROP COLUMN "judgeScore";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "responseEmbedding" vector(768);

-- AlterTable
ALTER TABLE "JudgeVerdict" DROP COLUMN "accuracyScore",
DROP COLUMN "rawResponse",
DROP COLUMN "relevanceScore",
ADD COLUMN     "coherenceScore" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "completenessScore" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "passed" BOOLEAN NOT NULL,
ADD COLUMN     "rawLlmResponse" TEXT;

-- AlterTable
ALTER TABLE "ScenarioRun" DROP COLUMN "scenarioConfig",
DROP COLUMN "scenarioName";

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "maxFollowUpRounds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeedQuestion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "requiredKeywords" TEXT[],
    "acceptableVariations" TEXT[],
    "expectedEmbedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeedQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Scenario_scenarioId_key" ON "Scenario"("scenarioId");

-- CreateIndex
CREATE INDEX "SeedQuestion_scenarioId_idx" ON "SeedQuestion"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "SeedQuestion_scenarioId_questionId_key" ON "SeedQuestion"("scenarioId", "questionId");

-- CreateIndex
CREATE INDEX "Conversation_seedQuestionId_idx" ON "Conversation"("seedQuestionId");

-- CreateIndex
CREATE INDEX "ScenarioRun_scenarioId_idx" ON "ScenarioRun"("scenarioId");

-- AddForeignKey
ALTER TABLE "SeedQuestion" ADD CONSTRAINT "SeedQuestion_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRun" ADD CONSTRAINT "ScenarioRun_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_seedQuestionId_fkey" FOREIGN KEY ("seedQuestionId") REFERENCES "SeedQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
