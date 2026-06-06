# Onboarding Drop Tests

Run:

```bash
npm run test:onboarding
```

These tests start from a blank temporary vault and simulate dropped content through the same storage and Graph-RAG services used by the app. A tiny deterministic fake vectorizer stands in for the local model so the scenarios stay fast and offline.

Add new scenarios by creating another `test(...)` block in `drop-scenarios.test.cjs` and calling `harness.drop(...)` with arbitrary content, title, summary, context hints, and importance.
