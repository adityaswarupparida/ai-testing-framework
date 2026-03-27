-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "runName" TEXT,
    "modelUnderTest" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioRun" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "scenarioName" TEXT NOT NULL,
    "scenarioConfig" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalRounds" INTEGER NOT NULL DEFAULT 0,
    "aggregate" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "scenarioRunId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "turnType" TEXT NOT NULL,
    "seedQuestionId" TEXT,
    "question" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "askedAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeVerdict" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "accuracyScore" DOUBLE PRECISION NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "rawResponse" TEXT,
    "judgeModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "groundTruth" TEXT,
    "judgeScore" DOUBLE PRECISION,
    "difference" DOUBLE PRECISION,
    "isHumanNeed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputMessages" JSONB NOT NULL,
    "outputContent" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScenarioRun_testRunId_idx" ON "ScenarioRun"("testRunId");

-- CreateIndex
CREATE INDEX "Conversation_scenarioRunId_idx" ON "Conversation"("scenarioRunId");

-- CreateIndex
CREATE INDEX "Conversation_scenarioRunId_roundNumber_idx" ON "Conversation"("scenarioRunId", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeVerdict_conversationId_key" ON "JudgeVerdict"("conversationId");

-- CreateIndex
CREATE INDEX "AnalysisResult_conversationId_idx" ON "AnalysisResult"("conversationId");

-- CreateIndex
CREATE INDEX "AnalysisResult_strategy_idx" ON "AnalysisResult"("strategy");

-- CreateIndex
CREATE INDEX "LlmCall_testRunId_idx" ON "LlmCall"("testRunId");

-- CreateIndex
CREATE INDEX "LlmCall_caller_idx" ON "LlmCall"("caller");

-- AddForeignKey
ALTER TABLE "ScenarioRun" ADD CONSTRAINT "ScenarioRun_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_scenarioRunId_fkey" FOREIGN KEY ("scenarioRunId") REFERENCES "ScenarioRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeVerdict" ADD CONSTRAINT "JudgeVerdict_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
