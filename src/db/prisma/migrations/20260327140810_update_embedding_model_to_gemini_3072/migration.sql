-- This is an empty migration.
ALTER TABLE "SeedQuestion" ALTER COLUMN "expectedEmbedding" TYPE vector(3072);                                                                                                  
ALTER TABLE "Conversation" ALTER COLUMN "responseEmbedding" TYPE vector(3072);