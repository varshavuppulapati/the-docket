# The Docket — Autonomous Permit Review

A working prototype built for Gauge Capital's portfolio company **Spatial Data Logic** (govtech permitting/licensing/code-enforcement software). It automates the part of municipal permitting that actually causes the 3–6 week backlog: a human manually reading an application and checking it, clause by clause, against the zoning code.

## What it does

Four AI agents run in sequence on a real permit application:

1. **Intake Agent** — extracts structured facts (address, zone, dimensions) from raw, messy application text. Assisted by a classical NLP pre-pass (compromise.js) before the LLM sees it.
2. **Code Research Agent** — a hand-built TF-IDF / cosine-similarity search retrieves the most relevant zoning code clauses from an embedded code library (real information retrieval, no LLM involved in the search itself), then the LLM decides which of those actually govern this case.
3. **Compliance Agent** — plain deterministic JavaScript does the actual measurement math (auditable, not left to the model to "guess" arithmetic); the LLM only writes the plain-English narrative and never overrides the computed pass/fail result.
4. **Drafting Agent** — writes the formal determination letter.

The system only ever auto-approves when every applicable check passes. Anything that fails, is missing data, or falls under a category that always requires judgment (e.g. a historic overlay district) routes to a human reviewer by design.

It's a static site — no backend, no build step, no database. It calls Groq's free API (Llama 3.3 70B) directly from the browser — a plain `fetch` to Groq's OpenAI-compatible endpoint, with your own API key held only in memory for that page load. If no key is entered, or a call fails, it falls back to an equivalent local "Demo Mode" so the page is never broken — a small badge always shows which mode each step actually ran in.

## Files

- `index.html` — the page
- `app.js` — the four agents, the retrieval engine, and all rendering/animation logic
- `zoning-data.js` — the embedded zoning code corpus and the three example applications
- (GSAP and compromise.js load from cdnjs at runtime — no install step)

## Run it locally

Because browsers block API calls from a bare `file://` page, serve it over local HTTP:

```
cd permit-docket
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy it to GitHub Pages (live in under 2 minutes)

1. Create a new GitHub repository (public or private — Pages works with either on a paid plan; public repos get free Pages on any plan).
2. Add these three files (`index.html`, `app.js`, `zoning-data.js`) to the repo root and push.
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a branch," branch `main`, folder `/ (root)`.
5. Save. GitHub gives you a live URL in about a minute: `https://<your-username>.github.io/<repo-name>/`.

That URL is your working, demoable prototype. Paste a free Groq API key into the field at the top of the page (get one at [console.groq.com/keys](https://console.groq.com/keys) — no credit card required) to see all four agents run live.

## Notes for the demo

- Click one of the three example buttons (or type your own application) and press **"Open the Case File."**
- The "123 Maple St." example is a clean pass — it auto-approves.
- "88 Corner Ave." fails a corner-lot setback rule — it escalates.
- "5 Heritage Row" passes every measurement but sits in a historic overlay district — it always escalates, regardless of the numbers, which is the point: some things are a judgment call, not a calculation.
- The small "View raw agent output" links under each card show exactly what came back from (or was substituted for) that step, for anyone who wants to see under the hood.
