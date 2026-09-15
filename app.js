(function(){
  "use strict";

  var STATE = { apiKey:null, currentExampleId:null, usedLive:false, usedDemo:false, warned:false, lastError:null,
    memQueue:null, memCounter:0 };

  var CURATED = {
    maple: { applicant:"Homeowner", address:"123 Maple Street", zone:"R-1", project_type:"Room addition",
      dimensions:{ front_setback_ft:null, side_setback_ft:12, rear_setback_ft:null, secondary_front_setback_ft:null,
        accessory_setback_ft:null, height_ft:14, lot_area_sqft:9200, existing_coverage_sqft:3150, addition_area_sqft:400 },
      notes:null },
    corner: { applicant:"Homeowner", address:"88 Corner Avenue", zone:"R-1 (Corner Lot)", project_type:"Detached garage",
      dimensions:{ front_setback_ft:null, side_setback_ft:10, rear_setback_ft:null, secondary_front_setback_ft:9,
        accessory_setback_ft:9, height_ft:16, lot_area_sqft:7800, existing_coverage_sqft:2600, addition_area_sqft:null },
      notes:"Garage footprint not stated; lot coverage cannot be fully verified." },
    heritage: { applicant:"Homeowner", address:"5 Heritage Row", zone:"R-1 (Heritage Row Historic Overlay)", project_type:"Porch rebuild",
      dimensions:{ front_setback_ft:26, side_setback_ft:null, rear_setback_ft:null, secondary_front_setback_ft:null,
        accessory_setback_ft:null, height_ft:12, lot_area_sqft:6000, existing_coverage_sqft:2100, addition_area_sqft:0 },
      notes:null }
  };

  // ---------------- TF-IDF retrieval (real IR math, no LLM) ----------------
  var STOPWORDS = ["the","a","an","of","in","on","at","to","for","and","or","is","are","be","shall","no","not",
    "this","that","with","from","as","by","it","its","will","would","which","any","all","than","over","under","independent"];
  var STOP = {}; STOPWORDS.forEach(function(w){ STOP[w]=true; });

  function tokenize(text){
    return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(function(t){ return t.length>1 && !STOP[t]; });
  }

  function buildTfidf(docsTokens){
    var df = {}, N = docsTokens.length;
    docsTokens.forEach(function(tokens){
      var seen = {};
      tokens.forEach(function(t){ seen[t]=true; });
      Object.keys(seen).forEach(function(t){ df[t]=(df[t]||0)+1; });
    });
    function vector(tokens){
      var tf = {};
      tokens.forEach(function(t){ tf[t]=(tf[t]||0)+1; });
      var vec = {};
      Object.keys(tf).forEach(function(t){
        var idf = Math.log((N+1)/((df[t]||0)+1)) + 1;
        vec[t] = (tf[t]/tokens.length) * idf;
      });
      return vec;
    }
    return { vector: vector };
  }

  function cosine(a,b){
    var dot=0, na=0, nb=0, k;
    for(k in a){ if(b[k]) dot += a[k]*b[k]; na += a[k]*a[k]; }
    for(k in b){ nb += b[k]*b[k]; }
    if(na===0||nb===0) return 0;
    return dot/(Math.sqrt(na)*Math.sqrt(nb));
  }

  var CLAUSE_TOKENS = window.ZONING_CODE.map(function(c){ return tokenize(c.text + " " + c.topic); });
  var TFIDF = buildTfidf(CLAUSE_TOKENS);
  var CLAUSE_VECTORS = CLAUSE_TOKENS.map(function(t){ return TFIDF.vector(t); });

  function retrieveClauses(query, topN){
    var qVec = TFIDF.vector(tokenize(query));
    var scored = window.ZONING_CODE.map(function(c,i){ return { clause:c, score: cosine(qVec, CLAUSE_VECTORS[i]) }; });
    scored.sort(function(a,b){ return b.score-a.score; });
    var top = scored.filter(function(s){ return s.score>0; }).slice(0, topN);
    if(top.length < 3) top = scored.slice(0, Math.max(3, topN));
    return top.map(function(s){ return s.clause; });
  }

  // ---------------- classical NLP pre-pass (compromise.js) ----------------
  function getCompromiseHints(text){
    try{
      var doc = window.nlp ? window.nlp(text) : null;
      var numbers = doc ? doc.match('#Value').out('array') : [];
      var nouns = doc ? doc.match('#ProperNoun+').out('array') : [];
      var uniq = function(arr){ var seen={}, out=[]; arr.forEach(function(x){ if(!seen[x]){seen[x]=true; out.push(x);} }); return out; };
      return { numbers: uniq(numbers).slice(0,12), nouns: uniq(nouns).slice(0,8) };
    }catch(e){ return { numbers:[], nouns:[] }; }
  }

  // ---------------- generic best-effort extraction (Demo Mode, custom text) ----------------
  function genericExtract(rawText){
    function num(re){ var m = rawText.match(re); return m ? parseFloat(m[1].replace(/,/g,'')) : null; }
    var addressMatch = rawText.match(/(\d+\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:Street|St\.?|Avenue|Ave\.?|Row|Road|Rd\.?|Lane|Ln\.?|Drive|Dr\.?))/);
    var zone = /r-?1/i.test(rawText) ? "R-1" : null;
    var project_type = /garage/i.test(rawText) ? "Detached garage" :
                        /porch/i.test(rawText) ? "Porch rebuild" :
                        /addition/i.test(rawText) ? "Room addition" : "General construction";
    return {
      applicant: "Applicant",
      address: addressMatch ? addressMatch[1] : null,
      zone: zone,
      project_type: project_type,
      dimensions: {
        front_setback_ft: num(/(\d+(?:\.\d+)?)\s*(?:feet|ft)[^.]{0,20}front/i),
        side_setback_ft: num(/(\d+(?:\.\d+)?)\s*(?:feet|ft)[^.]{0,20}side/i),
        rear_setback_ft: num(/(\d+(?:\.\d+)?)\s*(?:feet|ft)[^.]{0,20}rear/i),
        secondary_front_setback_ft: null,
        accessory_setback_ft: null,
        height_ft: num(/(\d+(?:\.\d+)?)\s*(?:feet|ft)[^.]{0,20}(?:tall|height|high)/i),
        lot_area_sqft: num(/lot[^.]{0,20}?(\d[\d,]*)\s*sq/i),
        existing_coverage_sqft: null,
        addition_area_sqft: num(/(\d[\d,]*)\s*sq\s*ft/i)
      },
      notes: "Best-effort extraction — Demo Mode has no live model to interpret free text precisely."
    };
  }

  function computeDerived(d){
    var dim = d.dimensions || (d.dimensions = {});
    if(dim.lot_area_sqft && dim.existing_coverage_sqft != null){
      var total = dim.existing_coverage_sqft + (dim.addition_area_sqft || 0);
      dim.coverage_pct = Math.round((total/dim.lot_area_sqft)*1000)/10;
    }
  }

  function fallbackApplicable(structured, rawText, candidates){
    var lower = rawText.toLowerCase();
    var dims = structured.dimensions || {};
    return candidates.filter(function(c){
      if(c.rule === "human"){
        if(c.id === "ZN-108") return /historic|heritage|overlay/.test(lower);
        if(c.id === "ZN-110") return /home occupation|client visits|on-site employees/.test(lower);
        return false;
      }
      if(c.id === "ZN-106") return /corner/.test(lower);
      if(c.id === "ZN-107") return (/garage|shed|accessory|detached/.test(lower)) && !/corner/.test(lower);
      if(c.dimension && dims[c.dimension] != null) return true;
      return false;
    }).map(function(c){ return { id:c.id, why:"Directly governs the " + c.topic + " for this project as described." }; });
  }

  function computeChecks(structured, applicable){
    var dims = structured.dimensions || {};
    var rows = [];
    applicable.forEach(function(a){
      var clause = window.ZONING_CODE.filter(function(c){ return c.id===a.id; })[0];
      if(!clause) return;
      if(clause.rule === "human"){
        rows.push({ id:clause.id, topic:clause.topic, status:"human" });
        return;
      }
      var val = dims[clause.dimension];
      if(val == null){
        rows.push({ id:clause.id, topic:clause.topic, status:"unknown" });
        return;
      }
      var pass = clause.rule === "min" ? val >= clause.value : val <= clause.value;
      rows.push({ id:clause.id, topic:clause.topic, status: pass ? "pass":"fail", value:val, threshold:clause.value, unit:clause.unit, rule:clause.rule });
    });
    return rows;
  }

  function determineOutcome(rows){
    var anyFail = rows.some(function(r){ return r.status==="fail"; });
    var anyHuman = rows.some(function(r){ return r.status==="human"; });
    var anyUnknown = rows.some(function(r){ return r.status==="unknown"; });
    if(anyFail || anyHuman || anyUnknown) return "Needs Licensed Reviewer";
    return "Eligible for Administrative Approval";
  }

  function fallbackNarrative(rows){
    var fails = rows.filter(function(r){return r.status==="fail";}).map(function(r){return r.topic;});
    var humans = rows.filter(function(r){return r.status==="human";}).map(function(r){return r.topic;});
    var unknown = rows.filter(function(r){return r.status==="unknown";}).map(function(r){return r.topic;});
    var passes = rows.filter(function(r){return r.status==="pass";}).map(function(r){return r.topic;});
    var parts = [];
    if(passes.length) parts.push(passes.length + " of the checked items meet code as submitted (" + passes.join(", ") + ").");
    if(fails.length) parts.push("However, " + fails.join(" and ") + " does not meet the required standard.");
    if(unknown.length) parts.push(unknown.join(" and ") + " could not be verified from the information provided.");
    if(humans.length) parts.push(humans.join(" and ") + " requires review independent of these measurements.");
    return parts.join(" ") || "No applicable code sections were identified for this request.";
  }

  function fallbackLetter(structured, rows, determination){
    var today = new Date().toLocaleDateString("en-US", {year:"numeric", month:"long", day:"numeric"});
    var lines = [];
    lines.push("RE: Permit Application — " + (structured.address || "Address on file"));
    lines.push("");
    lines.push("Dear Applicant,");
    lines.push("");
    lines.push("This letter concerns your request for a " + (structured.project_type||"construction project").toLowerCase() +
      " at the above address, zoned " + (structured.zone||"the applicable district") + ".");
    lines.push("");
    rows.forEach(function(r){
      if(r.status==="pass") lines.push("- " + r.topic + " (" + r.id + "): compliant as submitted.");
      else if(r.status==="fail") lines.push("- " + r.topic + " (" + r.id + "): does not meet the required " + r.rule + " of " + r.threshold + " " + r.unit + " (submitted: " + r.value + " " + r.unit + ").");
      else if(r.status==="human") lines.push("- " + r.topic + " (" + r.id + "): requires Design Review Board or staff review independent of dimensions.");
      else lines.push("- " + r.topic + " (" + r.id + "): insufficient information submitted to evaluate.");
    });
    lines.push("");
    if(determination === "Eligible for Administrative Approval"){
      lines.push("Based on the above, this application is eligible for administrative approval. A formal permit will be issued upon payment of applicable fees.");
    } else {
      lines.push("Based on the above, this application requires review by a licensed plan reviewer before a determination can be issued. You will be contacted regarding next steps.");
    }
    lines.push("");
    lines.push("Sincerely,");
    lines.push("Office of Planning & Permitting");
    return today + "\n\n" + lines.join("\n");
  }

  // ---------------- missing-info detection (structured "ask", not a chat message) ----------------
  function findMissingInfo(structured){
    var dims = structured.dimensions || {};
    var missing = [];
    if(structured.address == null) missing.push({ key:"address", label:"Property address", type:"text" });
    if(structured.zone == null) missing.push({ key:"zone", label:"Zoning district (e.g. R-1)", type:"text" });
    if(dims.lot_area_sqft == null) missing.push({ key:"dimensions.lot_area_sqft", label:"Total lot area (sq ft)", type:"number" });
    if(dims.existing_coverage_sqft == null) missing.push({ key:"dimensions.existing_coverage_sqft", label:"Existing building coverage (sq ft)", type:"number" });
    if(dims.addition_area_sqft == null && /addition|garage|porch|construction/i.test(structured.project_type||"")) {
      missing.push({ key:"dimensions.addition_area_sqft", label:"New construction footprint (sq ft)", type:"number" });
    }
    return missing;
  }

  function setByPath(obj, path, val){
    var parts = path.split(".");
    var cur = obj;
    for(var i=0;i<parts.length-1;i++){ cur = cur[parts[i]] = cur[parts[i]] || {}; }
    cur[parts[parts.length-1]] = val;
  }

  function promptForMissingInfo(missing, structured){
    return new Promise(function(resolve){
      var fieldsHtml = missing.map(function(m){
        return '<div class="field-row"><label>'+escapeHtml(m.label)+'</label><input data-key="'+m.key+'" type="'+(m.type==="number"?"number":"text")+'" /></div>';
      }).join("");
      var card = el('<div class="doc-card clarify-card"><h3>A Few Things We Need <span class="stamp-tag">Waiting on you</span></h3>' +
        '<p class="clarify-note">The Intake Agent read the application but couldn\'t find every figure the Compliance Agent needs. Rather than guess, the pipeline is pausing here — fill in what\'s missing and review picks up exactly where it left off.</p>' +
        '<div class="clarify-fields">'+fieldsHtml+'</div>' +
        '<div class="clarify-actions"><button class="run-btn" id="clarifyContinue" type="button">Continue Review →</button></div></div>');
      document.getElementById("desk").appendChild(card);
      showCard(card);
      setStepState(0, "waiting");
      card.querySelector("#clarifyContinue").addEventListener("click", function(){
        missing.forEach(function(m){
          var input = card.querySelector('[data-key="'+m.key+'"]');
          var raw = input ? input.value.trim() : "";
          if(!raw) return;
          setByPath(structured, m.key, m.type==="number" ? parseFloat(raw) : raw);
        });
        card.querySelector(".clarify-actions").innerHTML = '<span class="clarify-done">✓ Information received — continuing…</span>';
        setStepState(0, "done");
        resolve(structured);
      });
    });
  }

  // ---------------- live Groq API (free tier, OpenAI-compatible, reasoning model) ----------------
  var GROQ_MODEL = "openai/gpt-oss-120b";
  async function callLLM(system, user, maxTokens){
    var res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + STATE.apiKey
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_completion_tokens: (maxTokens || 1024) + 400, // headroom: gpt-oss is a reasoning model, needs budget beyond the final answer
        reasoning_effort: "low", // keep chain-of-thought short so the budget goes to the actual answer
        messages: [
          { role:"system", content: system },
          { role:"user", content: user }
        ]
      })
    });
    if(!res.ok){
      var errText = "";
      try{ errText = (await res.json()).error.message; }catch(e){ errText = res.statusText; }
      throw new Error("API " + res.status + ": " + errText);
    }
    var data = await res.json();
    var msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    return { content: msg.content || "", reasoning: msg.reasoning || "" };
  }

  function extractJson(text){
    var m = text.match(/\{[\s\S]*\}/);
    if(!m) throw new Error("No JSON in model output");
    return JSON.parse(m[0]);
  }

  function warnFallback(e){
    if(STATE.warned) return;
    STATE.warned = true;
    var box = document.getElementById("errBox");
    box.innerHTML = '<div class="err">Live call failed (' + escapeHtml((e && e.message) || "network/CORS") +
      ') — continuing in Demo Mode for the remaining steps. If you\'re opening this file directly (file://), serve it over http(s) instead (GitHub Pages works) for live calls to succeed.</div>';
  }

  // ---------------- the five agents ----------------
  async function runAgent1(rawText){
    var hints = getCompromiseHints(rawText);
    if(STATE.apiKey){
      try{
        var sys = 'You are a municipal permit intake clerk AI. Extract structured facts from a raw permit application into STRICT JSON only (no prose, no markdown fences), matching exactly this shape: {"applicant":string|null,"address":string|null,"zone":string|null,"project_type":string|null,"dimensions":{"front_setback_ft":number|null,"side_setback_ft":number|null,"rear_setback_ft":number|null,"secondary_front_setback_ft":number|null,"accessory_setback_ft":number|null,"height_ft":number|null,"lot_area_sqft":number|null,"existing_coverage_sqft":number|null,"addition_area_sqft":number|null},"notes":string|null}. Use null for anything not clearly stated. Do not guess values.';
        var user = "Pre-extracted hints from a classical NLP pass — numbers found: [" + hints.numbers.join(", ") +
          "]; proper nouns found: [" + hints.nouns.join(", ") + "].\n\nRaw application:\n\"\"\"\n" + rawText + "\n\"\"\"";
        var res = await callLLM(sys, user, 700);
        var json = extractJson(res.content);
        STATE.usedLive = true;
        return { data: json, source:"live", raw: res.content, reasoning: res.reasoning };
      }catch(e){ STATE.lastError = e.message; warnFallback(e); }
    }
    STATE.usedDemo = true;
    var curated = CURATED[STATE.currentExampleId];
    var data = curated ? JSON.parse(JSON.stringify(curated)) : genericExtract(rawText);
    return { data: data, source:"demo", raw: JSON.stringify(data, null, 2), reasoning: "" };
  }

  async function runAgent2(structured, rawText){
    var query = [structured.zone, structured.project_type, rawText].filter(Boolean).join(" ");
    var candidates = retrieveClauses(query, 5);
    if(STATE.apiKey){
      try{
        var sys = 'You are a municipal code research AI. You are given structured facts about a permit application and a shortlist of candidate zoning code clauses found by search. Decide which clauses genuinely govern this specific case. Respond in STRICT JSON only: {"applicable":[{"id":string,"why":string}],"excluded_note":string}. "why" must be one short sentence. Do not include a clause just because it appeared in the candidate list — only include ones that truly apply.';
        var user = "Structured facts:\n" + JSON.stringify(structured, null, 2) +
          "\n\nCandidate clauses:\n" + candidates.map(function(c){ return c.id + " — " + c.text; }).join("\n");
        var res = await callLLM(sys, user, 700);
        var json = extractJson(res.content);
        STATE.usedLive = true;
        return { data: json, source:"live", raw: res.content, reasoning: res.reasoning, candidates: candidates };
      }catch(e){ STATE.lastError = e.message; warnFallback(e); }
    }
    STATE.usedDemo = true;
    var applicable = fallbackApplicable(structured, rawText, candidates);
    return { data: { applicable: applicable }, source:"demo", raw: JSON.stringify(applicable, null, 2), reasoning: "", candidates: candidates };
  }

  async function runAgent3(structured, applicable){
    var rows = computeChecks(structured, applicable);
    var determination = determineOutcome(rows);
    if(STATE.apiKey){
      try{
        var sys = 'You are a compliance narrative AI for a municipal permitting office. You are given already-computed pass/fail results — do not change or re-decide them. Write a short, plain-English narrative (2-4 sentences) summarizing the findings for a non-technical reader. Respond in STRICT JSON only: {"narrative":string}.';
        var user = "Case facts:\n" + JSON.stringify(structured, null, 2) +
          "\n\nComputed results:\n" + JSON.stringify(rows, null, 2) +
          "\n\nDetermination already decided by the system: " + determination;
        var res = await callLLM(sys, user, 500);
        var json = extractJson(res.content);
        STATE.usedLive = true;
        return { rows: rows, determination: determination, narrative: json.narrative, source:"live", raw: res.content, reasoning: res.reasoning };
      }catch(e){ STATE.lastError = e.message; warnFallback(e); }
    }
    STATE.usedDemo = true;
    return { rows: rows, determination: determination, narrative: fallbackNarrative(rows), source:"demo", raw: "Demo Mode: narrative generated locally from the computed rows.", reasoning: "" };
  }

  async function runAgent4(structured, rows, determination, narrative){
    if(STATE.apiKey){
      try{
        var sys = "You are drafting a formal but readable municipal permit determination letter. Reference specific code section IDs where relevant. Keep it under 220 words. Respond with PLAIN TEXT ONLY — the letter body, no markdown, no JSON, no code fences, no date line (it will be added separately).";
        var user = "Applicant/case facts:\n" + JSON.stringify(structured, null, 2) +
          "\n\nFindings:\n" + JSON.stringify(rows, null, 2) +
          "\n\nNarrative summary: " + narrative + "\n\nFinal determination: " + determination;
        var res = await callLLM(sys, user, 650);
        STATE.usedLive = true;
        return { letter: res.content.trim(), source:"live", reasoning: res.reasoning };
      }catch(e){ STATE.lastError = e.message; warnFallback(e); }
    }
    STATE.usedDemo = true;
    return { letter: fallbackLetter(structured, rows, determination), source:"demo", reasoning: "" };
  }

  // ---------------- Agent 5: Execution — a real multi-step automated workflow, not one filing action ----------------
  var QUEUE_KEY = "docket_case_queue_v1";
  var COUNTER_KEY = "docket_case_counter_v1";
  var FEE_SCHEDULE = { base: 150, perSqFt: 0.35, garageFlat: 75 };

  function loadQueue(){
    try{ return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
    catch(e){ return STATE.memQueue || (STATE.memQueue = []); }
  }
  function saveQueueRecord(record){
    try{
      var q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      q.unshift(record);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
      return q;
    }catch(e){
      STATE.memQueue = STATE.memQueue || [];
      STATE.memQueue.unshift(record);
      return STATE.memQueue;
    }
  }
  function clearQueue(){
    try{ localStorage.removeItem(QUEUE_KEY); }catch(e){}
    STATE.memQueue = [];
  }
  function nextCaseId(){
    var year = new Date().getFullYear();
    var n;
    try{
      n = parseInt(localStorage.getItem(COUNTER_KEY) || "0", 10) + 1;
      localStorage.setItem(COUNTER_KEY, String(n));
    }catch(e){
      STATE.memCounter = (STATE.memCounter || 0) + 1;
      n = STATE.memCounter;
    }
    return "SDL-" + year + "-" + String(1000 + n);
  }

  // business-day math + .ics generation, so "scheduling" produces a file any real calendar app can import
  function businessDaysFromNow(n){
    var d = new Date();
    var added = 0;
    while(added < n){
      d.setDate(d.getDate()+1);
      var day = d.getDay();
      if(day!==0 && day!==6) added++;
    }
    return d;
  }
  function formatICSDate(d){ return d.toISOString().replace(/[-:]/g,"").split(".")[0]+"Z"; }
  function buildICS(opts){
    var start = opts.start;
    var end = new Date(start.getTime() + (opts.durationMinutes||60)*60000);
    var uid = "docket-" + Date.now() + "-" + Math.floor(Math.random()*1e6) + "@spatialdatalogic.local";
    return [
      "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//The Docket//Execution Agent//EN","BEGIN:VEVENT",
      "UID:"+uid,
      "DTSTAMP:"+formatICSDate(new Date()),
      "DTSTART:"+formatICSDate(start),
      "DTEND:"+formatICSDate(end),
      "SUMMARY:"+opts.title,
      "DESCRIPTION:"+(opts.description||"").replace(/\n/g,"\\n"),
      "END:VEVENT","END:VCALENDAR"
    ].join("\r\n");
  }

  function computeFee(structured){
    var dims = structured.dimensions || {};
    var area = dims.addition_area_sqft || 0;
    var fee = FEE_SCHEDULE.base + area*FEE_SCHEDULE.perSqFt;
    if(/garage/i.test(structured.project_type||"")) fee += FEE_SCHEDULE.garageFlat;
    return Math.round(fee*100)/100;
  }
  function computeSLA(rows){
    var anyFail = rows.some(function(r){ return r.status==="fail"; });
    var days = anyFail ? 5 : 8;
    var priority = anyFail ? "High" : "Medium";
    return { days: days, priority: priority, dueDate: businessDaysFromNow(days) };
  }

  function buildPermitRecord(record, fee){
    var isGarage = /garage/i.test(record.structured.project_type||"");
    return "PERMIT RECORD (estimated, generated automatically)\n" +
      "Case: " + record.id + "\n" +
      "Address: " + (record.structured.address || "—") + "\n" +
      "Project: " + (record.structured.project_type || "—") + "\n" +
      "Status: Eligible for Administrative Approval\n" +
      "Estimated fee: $" + fee.toFixed(2) + " (base $" + FEE_SCHEDULE.base.toFixed(2) + " + $" + FEE_SCHEDULE.perSqFt.toFixed(2) + "/sq ft of new construction" +
        (isGarage ? " + $" + FEE_SCHEDULE.garageFlat.toFixed(2) + " garage inspection surcharge" : "") + ")\n\n" +
      "This record was generated automatically by The Docket's Execution Agent upon administrative approval. It is a prototype estimate, not an official fee schedule.\n";
  }

  function buildRoutingPacket(record, routing, sla){
    return "INTERNAL ROUTING NOTE (generated automatically, not sent)\n" +
      "Case: " + record.id + "\n" +
      "Address: " + (record.structured.address || "—") + "\n" +
      "Project: " + (record.structured.project_type || "—") + "\n" +
      "Route to: " + routing + "\n" +
      "Priority: " + sla.priority + "\n" +
      "Response due by: " + sla.dueDate.toLocaleDateString() + " (" + sla.days + " business days)\n" +
      "Reason: automated review could not issue an administrative approval on its own — see the attached determination letter for the specific finding(s) that require judgment or fail a numeric threshold.\n\n" +
      "This packet and the accompanying calendar reminder were generated by The Docket's Execution Agent. No external message has been sent on your behalf — forward it internally as your process requires.\n";
  }

  function downloadFile(filename, text, mime){
    var blob = new Blob([text], {type: mime || "text/plain"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }

  // Runs the actual post-determination workflow: assigns a case number, then branches into either
  // "issue and schedule" or "escalate and schedule review", producing real files at each automated step.
  async function runAgent5(structured, rows, determination, letter){
    var caseId = nextCaseId();
    var approved = determination === "Eligible for Administrative Approval";
    var steps = [];
    var record = {
      id: caseId, address: structured.address, project: structured.project_type,
      determination: determination, timestamp: Date.now(), letter: letter, structured: structured, rows: rows
    };

    steps.push({ label:"Case number assigned", detail: caseId });

    if(approved){
      var fee = computeFee(structured);
      steps.push({ label:"Permit fee calculated", detail:"$"+fee.toFixed(2)+" (estimated)" });

      var certText = buildPermitRecord(record, fee);
      steps.push({ label:"Permit record generated", detail: caseId+"-permit-record.txt",
        dl:{ filename: caseId+"-permit-record.txt", content: certText, mime:"text/plain" } });

      var inspDate = businessDaysFromNow(10);
      var icsInsp = buildICS({ title:"Final Building Inspection — "+(structured.address||caseId),
        description:"Automatically scheduled by The Docket upon administrative approval. Case "+caseId+".",
        start: inspDate, durationMinutes:60 });
      steps.push({ label:"Final inspection scheduled", detail: inspDate.toLocaleDateString()+" (10 business days out)",
        dl:{ filename: caseId+"-inspection.ics", content: icsInsp, mime:"text/calendar" } });

      record.status = "Permit Issued — Inspection Scheduled";
      record.fee = fee;
      record.inspectionDateISO = inspDate.toISOString();
      record.permitRecordText = certText;
      record.inspectionIcs = icsInsp;
    } else {
      var routing = rows.some(function(r){ return r.id === "ZN-108"; }) ? "Design Review Board" : "Licensed Plan Reviewer Queue";
      var sla = computeSLA(rows);
      steps.push({ label:"Routed to "+routing, detail: sla.priority+" priority" });

      var packet = buildRoutingPacket(record, routing, sla);
      steps.push({ label:"Routing packet generated", detail: caseId+"-routing-packet.txt",
        dl:{ filename: caseId+"-routing-packet.txt", content: packet, mime:"text/plain" } });

      var icsReview = buildICS({ title:"Review due: "+caseId+" ("+routing+")",
        description:"Automatically scheduled by The Docket. Priority: "+sla.priority+".",
        start: sla.dueDate, durationMinutes:30 });
      steps.push({ label:"Reviewer deadline scheduled", detail:"Due "+sla.dueDate.toLocaleDateString()+" ("+sla.days+" business days)",
        dl:{ filename: caseId+"-review-deadline.ics", content: icsReview, mime:"text/calendar" } });

      record.status = "Escalated — Routed to " + routing;
      record.routing = routing;
      record.priority = sla.priority;
      record.dueDateISO = sla.dueDate.toISOString();
      record.routingPacketText = packet;
      record.reviewIcs = icsReview;
    }

    steps.push({ label:"Filed to Case Queue", detail: record.status });

    saveQueueRecord(record);
    refreshSidebarStats();
    return { caseId: caseId, steps: steps, record: record, source: "local" };
  }

  // ---------------- rendering ----------------
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){ return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; });
  }
  function el(html){ var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function showCard(node){
    node.classList.add("show");
    if(window.gsap){ gsap.fromTo(node, {opacity:0, y:16, rotation:-1.2}, {opacity:1, y:0, rotation:0, duration:0.55, ease:"back.out(1.6)"}); }
    else { node.style.opacity = 1; node.style.transform = "none"; }
  }
  function wireTrace(card){
    var t = card.querySelector(".trace-toggle"), p = card.querySelector(".trace");
    if(t && p) t.addEventListener("click", function(){ p.classList.toggle("show"); });
  }
  function traceBlock(raw, reasoning){
    var reasoningHtml = reasoning ? '<div class="think-label">Agent reasoning (live, from the model)</div><div class="think">'+escapeHtml(reasoning)+'</div>' : "";
    return '<span class="trace-toggle">View agent detail</span><div class="trace">'+reasoningHtml+
      '<div class="think-label">Raw output</div><pre class="raw-out">'+escapeHtml(raw)+'</pre></div>';
  }
  function badge(n, source){ return "Agent " + n + " · " + (source === "live" ? "Live" : "Demo"); }

  function buildRail(){
    var steps = ["Intake","Code Research","Compliance","Determination","Execution"];
    var subs = ["Extract structured facts","Retrieve & apply code","Check every dimension","Draft the letter","Run the automated workflow"];
    document.getElementById("rail").innerHTML = steps.map(function(s,i){
      return '<div class="rail-step" data-i="'+i+'"><div class="rail-dot">'+(i+1)+'</div><div class="rail-txt"><b>'+s+'</b><span>'+subs[i]+'</span><span class="rail-live">contacting Groq…</span></div></div>'
        + (i < steps.length-1 ? '<div class="rail-line"></div>' : "");
    }).join("");
  }
  function setStepState(i, state){
    var stepEl = document.querySelector('.rail-step[data-i="'+i+'"]');
    if(!stepEl) return;
    stepEl.classList.remove("active","done","waiting");
    var dot = stepEl.querySelector(".rail-dot");
    if(state === "active"){ stepEl.classList.add("active"); dot.textContent = String(i+1); }
    else if(state === "done"){ stepEl.classList.add("done"); dot.textContent = "✓"; }
    else if(state === "waiting"){ stepEl.classList.add("waiting"); dot.textContent = "?"; }
  }

  function renderCard1(structured, source, raw, reasoning){
    var dims = structured.dimensions || {};
    function kv(label, val, unit){ if(val==null || val==="") return ""; return '<div><div class="k">'+label+'</div><div class="v">'+val+(unit?(" "+unit):"")+"</div></div>"; }
    var kvHtml = kv("Applicant", structured.applicant) + kv("Address", structured.address) + kv("Zone", structured.zone) +
      kv("Project", structured.project_type) + kv("Front setback", dims.front_setback_ft, "ft") + kv("Side setback", dims.side_setback_ft, "ft") +
      kv("Rear setback", dims.rear_setback_ft, "ft") + kv("Secondary frontage", dims.secondary_front_setback_ft, "ft") +
      kv("Height", dims.height_ft, "ft") + kv("Lot area", dims.lot_area_sqft, "sq ft") + kv("Existing coverage", dims.existing_coverage_sqft, "sq ft") +
      kv("Addition area", dims.addition_area_sqft, "sq ft") + kv("Coverage", dims.coverage_pct, "%");
    var card = el('<div class="doc-card"><h3>Intake Summary <span class="stamp-tag">'+badge(1,source)+'</span></h3><div class="kv-grid">'+kvHtml+"</div>"+traceBlock(raw, reasoning)+"</div>");
    document.getElementById("desk").appendChild(card);
    showCard(card); wireTrace(card);
  }

  function renderCard2(applicable, source, raw, reasoning){
    var html = applicable.map(function(a){
      var clause = window.ZONING_CODE.filter(function(c){ return c.id===a.id; })[0];
      return '<div class="clause"><div class="id">'+a.id+" — "+(clause?clause.topic:"")+'</div><div class="why">'+escapeHtml(a.why||"")+"</div></div>";
    }).join("") || '<div class="clause"><div class="why">No specific clauses were determined to apply.</div></div>';
    var card = el('<div class="doc-card"><h3>Applicable Code Sections <span class="stamp-tag">'+badge(2,source)+'</span></h3>'+html+traceBlock(raw, reasoning)+"</div>");
    document.getElementById("desk").appendChild(card);
    showCard(card); wireTrace(card);
  }

  function renderCard3(rows, narrative, determination, source, raw, reasoning){
    var rowsHtml = rows.map(function(r){
      if(r.status === "human") return '<div class="check-row"><span>'+r.topic+'</span><span class="val">Requires review<span class="glyph no">!</span></span></div>';
      if(r.status === "unknown") return '<div class="check-row"><span>'+r.topic+'</span><span class="val">No data<span class="glyph no">?</span></span></div>';
      var ok = r.status === "pass";
      var arrow = r.rule === "min" ? "≥" : "≤";
      return '<div class="check-row"><span>'+r.topic+'</span><span class="val">'+r.value+" "+r.unit+" (need "+arrow+" "+r.threshold+")"+
        '<span class="glyph '+(ok?"ok":"no")+'">'+(ok?"✓":"✕")+"</span></span></div>"+
        '<div class="gauge-bar" data-pct="'+(r.rule==="min" ? (r.value/r.threshold*100) : (r.threshold/r.value*100))+'" data-ok="'+ok+'"><span class="fill"></span></div>';
    }).join("");
    var color = determination === "Eligible for Administrative Approval" ? "var(--mint)" : "var(--garnet)";
    var card = el('<div class="doc-card"><h3>Compliance Check <span class="stamp-tag">'+badge(3,source)+'</span></h3>'+rowsHtml+
      '<div class="narrative">'+escapeHtml(narrative)+'</div>'+
      '<div class="check-row" style="border-top:2px solid var(--line-strong);margin-top:6px;"><span><b>Determination</b></span><span class="val" style="font-weight:700;color:'+color+'">'+determination+'</span></div>'+
      traceBlock(raw, reasoning)+"</div>");
    document.getElementById("desk").appendChild(card);
    showCard(card); wireTrace(card);
    var bars = card.querySelectorAll(".gauge-bar");
    Array.prototype.forEach.call(bars, function(b){
      var pct = Math.max(4, Math.min(140, parseFloat(b.getAttribute("data-pct")) || 0));
      var ok = b.getAttribute("data-ok") === "true";
      var fill = b.querySelector(".fill");
      fill.style.background = ok ? "var(--mint)" : "var(--garnet)";
      if(window.gsap) gsap.fromTo(fill, {width:"0%"}, {width: pct+"%", duration:0.7, ease:"power2.out", delay:0.15});
      else fill.style.width = pct + "%";
    });
  }

  function typewrite(target, text, onDone){
    var i = 0, chunk = 3, delay = 14;
    target.textContent = "";
    var timer = setInterval(function(){
      i += chunk;
      target.textContent = text.slice(0, i);
      if(i >= text.length){ clearInterval(timer); if(onDone) onDone(); }
    }, delay);
  }

  function renderCard4(letterText, determination, source, reasoning){
    var dateStr = new Date().toLocaleDateString("en-US", {year:"numeric", month:"long", day:"numeric"});
    var card = el('<div class="letter"><div class="letterhead"><span>Office of Planning &amp; Permitting</span><span>'+dateStr+'</span></div>'+
      '<div class="body-text"></div><div class="seal"><div class="ring"></div><span></span></div>'+
      '<div style="margin-top:10px;">'+traceBlock("Agent 4 (" + (source==="live"?"Live":"Demo") + ") — letter shown above is the raw output.", reasoning)+'</div></div>');
    document.getElementById("desk").appendChild(card);
    showCard(card); wireTrace(card);
    var bodyEl = card.querySelector(".body-text");
    var sealEl = card.querySelector(".seal");
    var sealTxt = card.querySelector(".seal span");
    typewrite(bodyEl, letterText, function(){
      var approved = determination === "Eligible for Administrative Approval";
      sealEl.classList.add(approved ? "approve" : "review", "show");
      sealTxt.style.whiteSpace = "pre-line";
      sealTxt.textContent = approved ? "APPROVED" : "NEEDS\nREVIEW";
    });
  }

  function renderCard5(exec, determination, letter){
    var steps = exec.steps;
    var stepsHtml = steps.map(function(s, i){
      var dlBtn = s.dl ? '<button class="ghost-btn step-dl" data-idx="'+i+'">Download</button>' : "";
      return '<div class="exec-step" style="animation-delay:'+(i*110)+'ms;">' +
        '<div class="exec-step-main"><span class="glyph ok">✓</span><div class="exec-step-text"><b>'+escapeHtml(s.label)+'</b><span class="exec-step-detail">'+escapeHtml(s.detail)+'</span></div></div>' +
        dlBtn +
      "</div>";
    }).join("");
    var card = el('<div class="doc-card exec-card"><h3>Execution Workflow <span class="stamp-tag">Agent 5 · '+steps.length+' automated steps</span></h3>' +
      '<p class="exec-intro">This isn\'t a filing message — it\'s a short workflow that actually ran: every line below produced a real, checkable result.</p>' +
      '<div class="exec-steps">'+stepsHtml+'</div>' +
      '<div class="exec-actions">' +
        '<button class="ghost-btn" data-dl="letter">Download Determination Letter (.txt)</button>' +
        '<button class="ghost-btn" data-dl="queue">View in Case Queue</button>' +
      "</div></div>");
    document.getElementById("desk").appendChild(card);
    showCard(card); wireTrace(card);
    card.querySelectorAll(".step-dl").forEach(function(btn){
      btn.addEventListener("click", function(){
        var idx = parseInt(btn.getAttribute("data-idx"), 10);
        var s = steps[idx];
        if(s && s.dl) downloadFile(s.dl.filename, s.dl.content, s.dl.mime);
      });
    });
    card.querySelectorAll("[data-dl]").forEach(function(btn){
      var kind = btn.getAttribute("data-dl");
      if(!kind) return;
      btn.addEventListener("click", function(){
        if(kind === "letter") downloadFile(exec.caseId + "-determination-letter.txt", letter, "text/plain");
        else if(kind === "queue") navigate("queue");
      });
    });
  }

  function updateChipIdle(){
    var chip = document.getElementById("statusChip"), txt = document.getElementById("statusTxt");
    if(STATE.apiKey){ chip.className = "status-chip live"; txt.textContent = "Key set — live AI ready"; }
    else { chip.className = "status-chip demo"; txt.textContent = "Demo mode"; }
  }
  function updateChipAfterRun(){
    var chip = document.getElementById("statusChip"), txt = document.getElementById("statusTxt");
    if(STATE.usedLive && !STATE.usedDemo){ chip.className = "status-chip live"; txt.textContent = "Live AI agents"; }
    else if(STATE.usedLive && STATE.usedDemo){ chip.className = "status-chip live"; txt.textContent = "Partially live — see badges"; }
    else { chip.className = "status-chip demo"; txt.textContent = "Demo mode"; }
  }

  // ---------------- orchestration ----------------
  async function runCase(rawText){
    document.getElementById("errBox").innerHTML = "";
    document.getElementById("docket").classList.add("show");
    document.getElementById("desk").innerHTML = "";
    document.getElementById("impact").style.display = "none";
    buildRail();
    STATE.usedLive = false; STATE.usedDemo = false; STATE.warned = false;

    var t0 = performance.now();

    setStepState(0, "active");
    var r1 = await runAgent1(rawText);
    var structured = r1.data;
    computeDerived(structured);
    setStepState(0, "done");
    renderCard1(structured, r1.source, r1.raw, r1.reasoning);

    var missing = findMissingInfo(structured);
    if(missing.length){
      structured = await promptForMissingInfo(missing, structured);
      computeDerived(structured);
    }

    setStepState(1, "active");
    var r2 = await runAgent2(structured, rawText);
    setStepState(1, "done");
    renderCard2(r2.data.applicable || [], r2.source, r2.raw, r2.reasoning);

    setStepState(2, "active");
    var r3 = await runAgent3(structured, r2.data.applicable || []);
    setStepState(2, "done");
    renderCard3(r3.rows, r3.narrative, r3.determination, r3.source, r3.raw, r3.reasoning);

    setStepState(3, "active");
    var r4 = await runAgent4(structured, r3.rows, r3.determination, r3.narrative);
    setStepState(3, "done");
    renderCard4(r4.letter, r3.determination, r4.source, r4.reasoning);

    setStepState(4, "active");
    var r5 = await runAgent5(structured, r3.rows, r3.determination, r4.letter);
    setStepState(4, "done");
    renderCard5(r5, r3.determination, r4.letter);

    var elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    document.getElementById("statTime").textContent = elapsed + "s";
    document.getElementById("impact").style.display = "flex";
    updateChipAfterRun();
  }

  // ---------------- Case Queue view ----------------
  function refreshSidebarStats(){
    var q = loadQueue();
    var approved = q.filter(function(r){ return r.determination === "Eligible for Administrative Approval"; }).length;
    var totalEl = document.getElementById("miniTotal"), apEl = document.getElementById("miniApproved"), cntEl = document.getElementById("queueCount");
    if(totalEl) totalEl.textContent = q.length;
    if(apEl) apEl.textContent = approved;
    if(cntEl) cntEl.textContent = q.length;
  }

  function renderQueueView(filter){
    filter = filter || "all";
    var q = loadQueue();
    var filtered = q.filter(function(r){
      if(filter === "approved") return r.determination === "Eligible for Administrative Approval";
      if(filter === "review") return r.determination !== "Eligible for Administrative Approval";
      return true;
    });
    var approvedCount = q.filter(function(r){ return r.determination === "Eligible for Administrative Approval"; }).length;
    document.getElementById("queueStats").innerHTML =
      '<div class="qstat"><b>'+q.length+'</b><span>Total Cases</span></div>' +
      '<div class="qstat"><b>'+(q.length ? Math.round(approvedCount/q.length*100) : 0)+'%</b><span>Auto-Approved</span></div>' +
      '<div class="qstat"><b>'+(q.length-approvedCount)+'</b><span>Escalated</span></div>';
    var rowsHtml = filtered.map(function(r){
      var approved = r.determination === "Eligible for Administrative Approval";
      return '<div class="qrow" data-id="'+r.id+'">' +
        '<div class="qcell qid">'+r.id+'</div>' +
        '<div class="qcell qaddr">'+escapeHtml(r.address||"—")+'</div>' +
        '<div class="qcell qproj">'+escapeHtml(r.project||"—")+'</div>' +
        '<div class="qcell"><span class="qbadge '+(approved?"ok":"no")+'">'+(approved?"Auto-Approved":"Needs Reviewer")+'</span></div>' +
        '<div class="qcell qtime">'+new Date(r.timestamp).toLocaleString()+'</div>' +
      "</div>";
    }).join("") || '<div class="qempty">No cases filed yet — run one from New Case.</div>';
    document.getElementById("queueTable").innerHTML = rowsHtml;
    Array.prototype.forEach.call(document.querySelectorAll(".qrow"), function(row){
      row.addEventListener("click", function(){ openCaseDetail(row.getAttribute("data-id")); });
    });
  }

  function openCaseDetail(id){
    var q = loadQueue();
    var record = q.filter(function(r){ return r.id===id; })[0];
    if(!record) return;
    var rowsHtml = (record.rows||[]).map(function(r){
      if(r.status === "human") return '<div class="check-row"><span>'+r.topic+'</span><span class="val">Requires review<span class="glyph no">!</span></span></div>';
      if(r.status === "unknown") return '<div class="check-row"><span>'+r.topic+'</span><span class="val">No data<span class="glyph no">?</span></span></div>';
      var ok = r.status === "pass";
      var arrow = r.rule === "min" ? "≥" : "≤";
      return '<div class="check-row"><span>'+r.topic+'</span><span class="val">'+r.value+" "+r.unit+" (need "+arrow+" "+r.threshold+")"+
        '<span class="glyph '+(ok?"ok":"no")+'">'+(ok?"✓":"✕")+"</span></span></div>";
    }).join("");
    var approved = record.determination === "Eligible for Administrative Approval";
    var workflowHtml = approved ?
      ('<div class="check-row"><span>Status</span><span class="val">'+escapeHtml(record.status||"Permit Issued")+'</span></div>' +
       '<div class="check-row"><span>Estimated fee</span><span class="val">$'+(record.fee!=null?record.fee.toFixed(2):"—")+'</span></div>' +
       '<div class="check-row"><span>Inspection scheduled</span><span class="val">'+(record.inspectionDateISO?new Date(record.inspectionDateISO).toLocaleDateString():"—")+'</span></div>') :
      ('<div class="check-row"><span>Status</span><span class="val">'+escapeHtml(record.status||"Escalated")+'</span></div>' +
       '<div class="check-row"><span>Routed to</span><span class="val">'+escapeHtml(record.routing||"—")+'</span></div>' +
       '<div class="check-row"><span>Priority</span><span class="val">'+escapeHtml(record.priority||"—")+'</span></div>' +
       '<div class="check-row"><span>Response due</span><span class="val">'+(record.dueDateISO?new Date(record.dueDateISO).toLocaleDateString():"—")+'</span></div>');
    document.getElementById("caseDetailBody").innerHTML =
      '<div class="view-head"><h2>'+record.id+'</h2><p class="view-sub">'+escapeHtml(record.address||"—")+' · '+escapeHtml(record.project||"—")+' · '+new Date(record.timestamp).toLocaleString()+'</p></div>' +
      '<div class="doc-card"><h3>Compliance Check <span class="stamp-tag">On file</span></h3>'+rowsHtml+
      '<div class="check-row" style="border-top:2px solid var(--line-strong);margin-top:6px;"><span><b>Determination</b></span><span class="val" style="font-weight:700;color:'+(approved?"var(--mint)":"var(--garnet)")+'">'+record.determination+'</span></div></div>' +
      '<div class="doc-card" style="margin-top:16px;"><h3>Execution Workflow <span class="stamp-tag">On file</span></h3>'+workflowHtml+'</div>' +
      '<div class="letter" style="margin-top:16px;"><div class="letterhead"><span>Office of Planning &amp; Permitting</span><span>'+new Date(record.timestamp).toLocaleDateString()+'</span></div>' +
      '<div class="body-text">'+escapeHtml(record.letter||"")+'</div></div>' +
      '<div class="exec-actions" style="max-width:820px;margin:16px auto 0;">' +
        '<button class="ghost-btn" id="caseDlLetter">Download Determination Letter (.txt)</button>' +
        (approved ?
          '<button class="ghost-btn" id="caseDlExtra">Download Permit Record (.txt)</button><button class="ghost-btn" id="caseDlIcs">Download Inspection (.ics)</button>' :
          '<button class="ghost-btn" id="caseDlExtra">Download Routing Packet (.txt)</button><button class="ghost-btn" id="caseDlIcs">Download Deadline (.ics)</button>') +
      "</div>";
    var dlLetter = document.getElementById("caseDlLetter");
    if(dlLetter) dlLetter.addEventListener("click", function(){ downloadFile(record.id + "-determination-letter.txt", record.letter || "", "text/plain"); });
    var dlExtra = document.getElementById("caseDlExtra");
    if(dlExtra) dlExtra.addEventListener("click", function(){
      if(approved) downloadFile(record.id + "-permit-record.txt", record.permitRecordText || "", "text/plain");
      else downloadFile(record.id + "-routing-packet.txt", record.routingPacketText || "", "text/plain");
    });
    var dlIcs = document.getElementById("caseDlIcs");
    if(dlIcs) dlIcs.addEventListener("click", function(){
      if(approved) downloadFile(record.id + "-inspection.ics", record.inspectionIcs || "", "text/calendar");
      else downloadFile(record.id + "-review-deadline.ics", record.reviewIcs || "", "text/calendar");
    });
    navigate("case");
  }

  // ---------------- router ----------------
  var VIEWS = ["new","queue","case","how"];
  function navigate(view){
    if(VIEWS.indexOf(view) === -1) view = "new";
    VIEWS.forEach(function(v){
      var node = document.getElementById("view-"+v);
      if(node) node.hidden = (v !== view);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".navlink"), function(a){
      a.classList.toggle("active", a.getAttribute("data-view") === view);
    });
    if(view === "queue") renderQueueView(STATE.queueFilter || "all");
    window.scrollTo(0,0);
  }

  // ---------------- wiring ----------------
  function init(){
    var exContainer = document.getElementById("examples");
    window.EXAMPLES.forEach(function(ex, idx){
      var b = document.createElement("button");
      b.className = "example-btn" + (idx===0 ? " active" : "");
      b.textContent = ex.label;
      b.addEventListener("click", function(){
        document.getElementById("appText").value = ex.text;
        STATE.currentExampleId = ex.id;
        Array.prototype.forEach.call(exContainer.children, function(el2){ el2.classList.remove("active"); });
        b.classList.add("active");
      });
      exContainer.appendChild(b);
    });
    document.getElementById("appText").value = window.EXAMPLES[0].text;
    STATE.currentExampleId = window.EXAMPLES[0].id;
    document.getElementById("appText").addEventListener("input", function(){ STATE.currentExampleId = null; });

    document.getElementById("saveKey").addEventListener("click", function(){
      var v = document.getElementById("apiKey").value.trim();
      STATE.apiKey = v || null;
      updateChipIdle();
    });

    document.getElementById("runBtn").addEventListener("click", function(){
      var text = document.getElementById("appText").value.trim();
      if(!text) return;
      var btn = document.getElementById("runBtn");
      btn.disabled = true;
      runCase(text).catch(function(e){
        document.getElementById("errBox").innerHTML = '<div class="err">Unexpected error: ' + escapeHtml(e.message||String(e)) + "</div>";
      }).finally(function(){ btn.disabled = false; });
    });

    Array.prototype.forEach.call(document.querySelectorAll(".navlink"), function(a){
      a.addEventListener("click", function(){ navigate(a.getAttribute("data-view")); });
    });
    var back = document.getElementById("backToQueue");
    if(back) back.addEventListener("click", function(){ navigate("queue"); });

    Array.prototype.forEach.call(document.querySelectorAll(".filter-btn"), function(btn){
      btn.addEventListener("click", function(){
        Array.prototype.forEach.call(document.querySelectorAll(".filter-btn"), function(b2){ b2.classList.remove("active"); });
        btn.classList.add("active");
        STATE.queueFilter = btn.getAttribute("data-filter");
        renderQueueView(STATE.queueFilter);
      });
    });

    var clearBtn = document.getElementById("clearQueueBtn");
    if(clearBtn) clearBtn.addEventListener("click", function(){
      clearQueue();
      refreshSidebarStats();
      renderQueueView(STATE.queueFilter || "all");
    });

    refreshSidebarStats();
    navigate("new");
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
