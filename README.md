# AI Testing Framework

A generic black-box testing framework for any AI agent. Connect your agent via HTTP or function callback, define scenarios with seed questions and ground truth, and get multi-signal evaluation reports.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Test Run Orchestrator                          │
│        loads scenarios → for each seed → run N follow-up rounds     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
            ┌──────────────────────────┐
            │      Scenario Bank       │
            │  seed questions          │
            │  ground truth answers    │
            └────────────┬─────────────┘
                         │ seed question
                         ▼
              ┌───────────────────────────┐
              │    AI Agent (black box)   │◄──────────────────────────┐
              │  receives: conversation   │                           │
              │  returns:  response       │                           │
              └────────────┬──────────────┘                           │
                           │ response                         follow-up question
                           ▼                                          │
              ┌─────────────────────────┐                             │
              │        LLM Judge        │               ┌─────────────┴─────────────┐
              │ completeness+coherence  │               │   Questionnaire Agent     │
              └────────────┬────────────┘               │  LLM generates next       │
                           │                            │ question from conversation│
                           ▼                            └─────────────┬─────────────┘
              ┌─────────────────────────┐                             │
              │        Analyser         │              (repeats N times, loops back)
              │  exact+semantic+        │─────────────────────────────┘
              │  composite              │
              └────────────┬────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            Reporter                                 │
│              console output + JSON report to ./reports              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ publishes to Redis queue (non-blocking)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Insights Agent (async)                        │
│               runs in separate process via insights-worker.ts       │
│                                                                     │
│  rule-based pass → flags deterministic issues                       │
│  LLM pass        → detects patterns, suggests fixes                 │
│                                                                     │
│  reports/analysis/{runId}-model-owner.json  ← for model developer   │
│  reports/analysis/{runId}-framework.json    ← for framework author  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## How It Works

1. Loads scenario JSON files with seed questions and expected answers
2. For each seed question — asks the model, evaluates with judge + analyzer
3. Generates follow-up questions and continues the conversation (N rounds)
4. Scores each turn using exact match, semantic similarity, and LLM-as-judge
5. Saves everything to PostgreSQL and outputs a report

---

## Prerequisites

- [Bun](https://bun.sh) runtime
- PostgreSQL with pgvector extension (see Docker setup below)
- Gemini API key

---

## Setup

**1. Install dependencies**
```bash
bun install
```

**2. Start PostgreSQL with pgvector**
```bash
docker run -d \
  --name postgres-pgvector \
  -e POSTGRES_PASSWORD=mysecretpassword \
  -p 5432:5432 \
  pgvector/pgvector:pg17
```

**3. Configure environment**
```bash
# .env
DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/ai_testing_framework"
GEMINI_API_KEY="your-gemini-api-key"
```

**4. Run database migrations**
```bash
bunx prisma migrate dev
bunx prisma generate
```

---

## Configuration

Edit `config/default.config.json`:

```json
{
  "sut": {
    "adapterType": "http",
    "name": "My Agent v1",
    "baseUrl": "http://localhost:3000"
  },
  "llm": {
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "temperature": 0.3
  },
  "judge": {
    "passThreshold": 0.6
  },
  "questionnaire": {
    "maxFollowUpRounds": 2,
    "personaPrompt": "You are a user interacting with the agent. Ask natural follow-up questions based on its responses. Stay within the domain context."
  },
  "analyzer": {
    "weights": { "exact": 0.7, "semantic": 0.3 }
  },
  "execution": {
    "delayBetweenCallsMs": 500
  },
  "reporting": {
    "outputFormats": ["json", "console"],
    "outputDir": "./reports"
  }
}
```

### Agent HTTP API

Your agent must expose these endpoints:

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | Send a message. Body: `{ message, sessionId? }` |
| `DELETE` | `/chat/:sessionId` | Reset/clear session |
| `GET` | `/health` | Health check |

---

## Writing Scenarios

Create a JSON file in `config/scenarios/`:

```json
{
  "id": "customer-support",
  "name": "Customer Support Bot",
  "context": "User is interacting with a customer support agent for an e-commerce platform.",
  "maxFollowUpRounds": 2,
  "seedQuestions": [
    {
      "id": "q1",
      "question": "What is your return policy?",
      "groundTruth": {
        "expectedAnswer": "You can return any product within 30 days of purchase for a full refund.",
        "requiredKeywords": ["30 days", "return", "refund"],
        "acceptableVariations": [
          "Returns are accepted within 30 days",
          "Full refund within 30 days of purchase"
        ]
      }
    }
  ]
}
```

**Fields:**
- `id` — unique identifier for the scenario
- `question` — the seed question sent to the agent
- `expectedAnswer` — ground truth for semantic comparison and embedding storage
- `requiredKeywords` — keywords that must appear in the response (exact match)
- `acceptableVariations` — alternative phrasings that count as correct

---

## Running Tests

**Run all scenarios:**
```bash
bun run index.ts --name "My Test Run"
```

**Run a specific scenario:**
```bash
bun run index.ts --scenario config/scenarios/my-scenario.json --name "Test Run 1"
```

**Use a custom config:**
```bash
bun run index.ts --config my-config.json --name "Nightly Run"
```

---

## Scoring

Each seed turn is scored by four signals:

| Signal | Method | What it checks |
|---|---|---|
| Exact | Keyword matching | Required keywords present in response |
| Semantic | Cosine similarity (embeddings) | Meaning aligned with expected answer |
| Composite | Weighted exact + semantic | Overall factual correctness |
| Judge | LLM (Gemini) | Completeness and coherence |

Follow-up turns are scored by **judge** + **semantic** (compared against the seed's expected answer).

A turn is flagged `[NEEDS HUMAN REVIEW]` when composite < 0.5 or semantic < 0.4.

---

## Output

**Console output during run:**
```
[1/2] Scenario: Product FAQ (3 seed + 2 follow-up rounds)

  [Seed 1/3] "What is your return policy?"
    -> judge: 0.92 | composite: 0.98 (245ms)
    Follow-up 1/2: "Can I return a product after 30 days?..." -> judge: 0.88 | semantic: 0.94 (312ms)
    Follow-up 2/2: "What if the product is damaged?..." -> judge: 0.90 | semantic: 0.91 (298ms)
```

**Final report** saved to `reports/` as JSON and printed to console.

---

## Project Structure

```
config/
  default.config.json       # Framework configuration
  scenarios/                # Scenario JSON files
src/
  adapters/
    llm/                    # Gemini provider + tracked wrapper
    model/                  # HTTP and function adapters for the agent
  analyzer/                 # Exact match, semantic similarity, composite
  judge/                    # LLM-as-judge (completeness + coherence)
  questionnaire/            # Follow-up question generation agent
  reporter/                 # Console and JSON reporters
  runner/                   # Test orchestration
  config/                   # Config + scenario loader
  db/                       # Prisma client + schema
index.ts                    # CLI entry point
ARCHITECTURE.md             # Detailed architecture and design decisions
```

---

## Running Framework Unit Tests

```bash
bun test
```
