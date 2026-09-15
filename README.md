# The Docket — Autonomous Permit Review

A working prototype built for Gauge Capital's portfolio company **Spatial Data Logic** (govtech permitting/licensing/code-enforcement software). It automates the part of municipal permitting that actually causes the 3–6 week backlog: a human manually reading an application, checking it clause by clause against the zoning code, and then acting on the result.

It is **not a chatbot**. There's no message box you type follow-ups into — it's a sidebar app with three views (New Case, Case Queue, How It Works), a fixed five-agent pipeline behind each case, and a persistent record of everything it's processed. See the in-app "How It Works" page for the full argument; the short version is below.

## What it does

Five AI agents run in sequence on a real permit application:

1. **Intake Agent** — extracts structured facts (address, zone, dimensions) from raw, messy application text. Assisted by a classical NLP pre-pass (compromise.js) before the LLM sees it.
2. **Code Research Agent** — a hand-built TF-IDF / cosine-similarity search retrieves the most relevant zoning code clauses from an embedded code library (real information retrieval, no LLM involved in the search itself), then the LLM decides which of those actually govern this case.
3. **Compliance Agent** — plain deterministic JavaScript does the actual measurement math (auditable, not left to the model to "guess" arithmetic); the LLM only writes the plain-English narrative and never overrides the computed pass/fail result.
4. **Drafting Agent** — writes the formal determination letter.
5. **Execution Agent** — this is a workflow, not a single filing step. It assigns a case number, then branches on the outcome: an **approval** gets an estimated fee calculated, a downloadable permit record, and a final inspection scheduled ten business days out as a real `.ics` calendar file you can drop into any calendar app; an **escalation** gets routed to the correct reviewer queue (Design Review Board or the Licensed Plan Reviewer Queue, depending on why it escalated) with a priority level, a response-due date, a downloadable routing packet, and a calendar reminder for that deadline. Every step shows up individually on screen as it completes, and the whole case is then filed into a persistent Case Queue. Nothing is ever sent anywhere automatically — every generated file is a local download you choose to use.

Between steps 1 and 2, if the Intake Agent couldn't find something the Compliance Agent actually needs (lot area, existing coverage, a project footprint), the pipeline **pauses and asks** — a small form for exactly the missing fields, not a chat message. Fill it in and review resumes right where it stopped. Try the "88 Corner Ave." example to see this trigger.

Every live agent card also has a **"View agent detail"** toggle showing the model's real reasoning trace (Groq returns this separately from the final answer for GPT-OSS models) alongside the raw JSON/text it produced — not a fabricated explanation, the actual chain of thought for that call.

The system only ever auto-approves when every applicable check passes. Anything that fails, is missing data, or falls under a category that always requires judgment (e.g. a historic overlay district) routes to a human reviewer by design.

It's a static site — no backend, no build step, no database. It calls Groq's free API (GPT-OSS 120B) directly from the browser — a plain `fetch` to Groq's OpenAI-compatible endpoint, with your own API key held only in memory for that page load. If no key is entered, or a call fails, it falls back to an equivalent local "Demo Mode" so the page is never broken — a small badge always shows which mode each step actually ran in. The Case Queue persists in the browser's local storage (falls back to in-memory if storage is unavailable), so it survives a refresh but stays private to your browser.

**Model note:** the app uses `openai/gpt-oss-120b`, which is on Groq's free tier and is a reasoning model — `app.js` sets `reasoning_effort: "low"` and gives extra token headroom so its internal reasoning doesn't crowd out the actual JSON answer. A couple of Groq's other models (e.g. `llama-3.3-70b-versatile`) are gated to Enterprise-tier accounts and will 404 with a plain free key — if you ever swap the model, check [console.groq.com/docs/models](https://console.groq.com/docs/models) first to confirm it's free-tier accessible.

## Files

- `index.html` — the sidebar app shell (New Case / Case Queue / How It Works) and all view markup
- `app.js` — the five agents, the retrieval engine, the Case Queue storage, the router between views, and all rendering/animation logic
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

That URL is your working, demoable prototype. Paste a free Groq API key into the field at the top of the page (get one at [console.groq.com/keys](https://console.groq.com/keys) — no credit card required) to see all five agents run live.

## Notes for the demo

- Click one of the three example buttons (or type your own application) and press **"Open the Case File."**
- The "123 Maple St." example is a clean pass — it auto-approves, and its Execution Agent run calculates a fee, generates a permit record, and schedules a final inspection as a downloadable `.ics`.
- "88 Corner Ave." is missing its garage footprint — this is the one that triggers the clarification form. Fill in a footprint (e.g. 300) and continue; it then fails the corner-lot secondary-frontage setback and escalates, with a High-priority, 5-business-day routing to the general reviewer queue.
- "5 Heritage Row" passes every measurement but sits in a historic overlay district — it always escalates, regardless of the numbers, which is the point: some things are a judgment call, not a calculation. It routes specifically to the Design Review Board with an 8-business-day deadline, since a historic-overlay case isn't a numeric failure.
- Use the sidebar to check the **Case Queue** after running a few cases — it's a real, persistent list with a live auto-approval rate, filterable by outcome, and clicking any row reopens that case's full letter, findings, and the exact workflow outcome (fee/inspection or routing/priority/deadline) with the same files downloadable again.
- The **How It Works** page in the sidebar is written for a reviewer or interviewer who wants the "why is this more than a chatbot" argument in the product itself, not just in a conversation about it.
