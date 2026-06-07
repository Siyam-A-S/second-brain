const sampleDrops = [
  {
    id: "professor-lecture",
    label: "Professor lecture note",
    source: "Database Management course",
    title: "Normalization lecture",
    summary: "Professor notes on 1NF, 2NF, 3NF, and dependency cleanup before the midterm.",
    content:
      "Lecture notes: normalization, functional dependencies, relational decomposition, and exam hints from Database Management.",
    hints: ["Database Management", "lecture", "normalization", "professor"],
    kind: "course",
    what: "Definitions and examples for normal forms.",
    why: "Likely exam material and a recurring course concept.",
    how: "Attach to the course topic, then connect to schema design notes.",
    when: "Use during midterm review and before schema assignments."
  },
  {
    id: "ai-chat",
    label: "AI chat response",
    source: "Database Management course",
    title: "Indexing explanation",
    summary: "Chat response comparing B-tree indexes, hash indexes, and query planner tradeoffs.",
    content:
      "AI response: B-tree indexes support range queries, hash indexes support equality lookups, and planners choose based on selectivity.",
    hints: ["Database Management", "index", "query planner"],
    kind: "course",
    what: "Index types and query planner behavior.",
    why: "Clarifies lecture notes with examples Nathan can reuse.",
    how: "Place after recent course notes and link to query optimization.",
    when: "Use when studying indexes or designing assignment queries."
  },
  {
    id: "sql-boot",
    label: "SQL boot commands",
    source: "Fullstack project",
    title: "Database boot commands",
    summary: "Commands for creating tables, seeding users, and starting the local Postgres service.",
    content:
      "docker compose up db; psql -f schema.sql; npm run seed; restart API after migrations complete.",
    hints: ["fullstack app", "schema", "boot commands", "Postgres"],
    kind: "project",
    what: "Operational commands for the old web app database.",
    why: "Useful for resurrecting the project without rereading the repo.",
    how: "Route to the project topic despite database vocabulary overlap.",
    when: "Use before demoing or debugging the fullstack app."
  },
  {
    id: "research-paper",
    label: "Research PDF excerpt",
    source: "New topic",
    title: "Retrieval augmented note taking",
    summary: "Paper excerpt about personal knowledge systems, retrieval quality, and cognitive load.",
    content:
      "Research excerpt: retrieval augmented personal notes reduce context switching when summaries, provenance, and selective expansion are visible.",
    hints: ["personal knowledge systems", "cognitive load", "retrieval"],
    kind: "new",
    what: "A new research direction outside the database topics.",
    why: "It should not pollute the course or project boards.",
    how: "Create a new topic and make it available for later linking.",
    when: "Use when planning product or onboarding decisions."
  }
];

const blankTopics = [
  {
    id: "database-course",
    title: "Database Management Course",
    summary: "Lecture notes, professor handouts, AI explanations, assignments, and exam review.",
    kind: "course",
    importance: 0.86,
    validation: "approved",
    hints: ["database management", "lecture", "professor", "index", "normalization"],
    cards: [
      {
        id: "erd-basics",
        title: "ER diagrams and relationships",
        summary: "Class notes on entities, attributes, cardinality, and weak relationships.",
        kind: "course",
        confidence: 0.88,
        createdAt: Date.now() - 1000 * 60 * 54,
        validation: "approved",
        what: "Core ER modeling vocabulary.",
        why: "Foundation for every design assignment.",
        how: "Review before transforming diagrams into relational tables.",
        when: "Before weekly homework and office hours."
      }
    ]
  },
  {
    id: "fullstack-project",
    title: "Fullstack SQL Project",
    summary: "Schemas, seed scripts, migrations, and local database commands for an older web app.",
    kind: "project",
    importance: 0.62,
    validation: "approved",
    hints: ["fullstack", "schema", "boot commands", "postgres", "migration"],
    cards: [
      {
        id: "schema-notes",
        title: "User and session schema",
        summary: "Saved schema for auth tables, token cleanup, and local seed assumptions.",
        kind: "project",
        confidence: 0.91,
        createdAt: Date.now() - 1000 * 60 * 60 * 26,
        validation: "approved",
        what: "Table design and auth persistence notes.",
        why: "Prevents relearning the old project structure.",
        how: "Use with migrations before running the local app.",
        when: "Before debugging auth or onboarding a teammate."
      }
    ]
  }
];

let state = {
  topics: structuredClone(blankTopics),
  activeTopicId: "database-course",
  selectedCardId: null,
  savedTokens: 0,
  avoidedFiles: 0,
  lastRoute: null,
  newCardId: null
};

const elements = {
  dropZone: document.querySelector("#drop-zone"),
  dropMessage: document.querySelector("#drop-message"),
  dropIcon: document.querySelector("#drop-icon"),
  pasteBox: document.querySelector("#paste-box"),
  ingestPaste: document.querySelector("#ingest-paste"),
  sampleStack: document.querySelector("#sample-stack"),
  resetDemo: document.querySelector("#reset-demo"),
  runDemo: document.querySelector("#run-demo"),
  exportContext: document.querySelector("#export-context"),
  topicTabs: document.querySelector("#topic-tabs"),
  activeTopicTitle: document.querySelector("#active-topic-title"),
  insightRow: document.querySelector("#insight-row"),
  cardsGrid: document.querySelector("#cards-grid"),
  selectedCard: document.querySelector("#selected-card"),
  latestRoute: document.querySelector("#latest-route"),
  localStatus: document.querySelector("#local-status"),
  tokenStatus: document.querySelector("#token-status"),
  routingStatus: document.querySelector("#routing-status"),
  loadMeterFill: document.querySelector("#load-meter-fill"),
  reviewCount: document.querySelector("#review-count"),
  topicCount: document.querySelector("#topic-count"),
  savedCount: document.querySelector("#saved-count"),
  toast: document.querySelector("#toast")
};

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreTopic(drop, topic) {
  const haystack = normalize([topic.title, topic.summary, topic.hints.join(" ")].join(" "));
  const needles = drop.hints.flatMap((hint) => normalize(hint).split(" ")).filter((word) => word.length > 3);
  const overlap = needles.filter((word) => haystack.includes(word)).length / Math.max(needles.length, 1);
  const validationBoost = topic.validation === "approved" ? 0.08 : 0;
  const importanceBoost = topic.importance * 0.08;
  return Math.min(0.98, overlap * 0.76 + validationBoost + importanceBoost);
}

function chooseTopic(drop) {
  const scored = state.topics
    .map((topic) => ({ topic, score: scoreTopic(drop, topic) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (best && best.score >= 0.52) {
    return {
      topic: best.topic,
      score: best.score,
      strategy: "Existing topic",
      reason: `Matched ${drop.source} against ${best.topic.title}`
    };
  }

  const topic = {
    id: `topic-${Date.now()}`,
    title: deriveTopicTitle(drop),
    summary: drop.summary,
    kind: "new",
    importance: 0.68,
    validation: "unreviewed",
    hints: drop.hints,
    cards: []
  };
  state.topics.unshift(topic);

  return {
    topic,
    score: 0.47,
    strategy: "New topic",
    reason: "No existing topic was confident enough"
  };
}

function deriveTopicTitle(drop) {
  if (drop.source === "New topic") {
    return "Knowledge Systems Research";
  }
  return drop.source || drop.title;
}

function ingestDrop(drop) {
  setProcessing(true, "Reading source and comparing board topology...");

  window.setTimeout(() => {
    const route = chooseTopic(drop);
    const card = {
      id: `${drop.id}-${Date.now()}`,
      title: drop.title,
      summary: drop.summary,
      kind: drop.kind,
      confidence: route.score,
      createdAt: Date.now(),
      validation: "unreviewed",
      what: drop.what,
      why: drop.why,
      how: drop.how,
      when: drop.when
    };

    route.topic.cards.unshift(card);
    state.activeTopicId = route.topic.id;
    state.selectedCardId = card.id;
    state.savedTokens += Math.round(drop.content.length * 1.6 + 900);
    state.avoidedFiles += 1;
    state.lastRoute = {
      strategy: route.strategy,
      topicTitle: route.topic.title,
      confidence: route.score,
      reason: route.reason,
      cardTitle: card.title
    };
    state.newCardId = card.id;

    setProcessing(false, `${route.strategy}: ${route.topic.title}`);
    render();
    showToast(`${card.title} routed to ${route.topic.title}`);

    window.setTimeout(() => {
      state.newCardId = null;
      renderCards();
    }, 700);
  }, 720);
}

function ingestRawText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    showToast("Paste text first");
    return;
  }

  const title = trimmed.split(/\n|\.|:/).find(Boolean)?.slice(0, 54) || "Untitled note";
  ingestDrop({
    id: `paste-${Date.now()}`,
    label: "Pasted text",
    source: "New topic",
    title,
    summary: trimmed.replace(/\s+/g, " ").slice(0, 148),
    content: trimmed,
    hints: extractHints(trimmed),
    kind: "note",
    what: trimmed.slice(0, 78),
    why: "Fresh information from the user should become searchable quickly.",
    how: "Create or route based on repeated terms and existing topic hints.",
    when: "Use when the user needs this context again."
  });
  elements.pasteBox.value = "";
}

function extractHints(text) {
  const words = normalize(text)
    .split(" ")
    .filter((word) => word.length > 5);
  return Array.from(new Set(words)).slice(0, 5);
}

function setProcessing(isProcessing, message) {
  elements.dropZone.classList.toggle("dragging", isProcessing);
  elements.dropIcon.textContent = isProcessing ? "..." : "+";
  elements.dropMessage.textContent = message;
  elements.routingStatus.textContent = isProcessing ? "Routing" : message;
}

function render() {
  renderSamples();
  renderTabs();
  renderInsights();
  renderCards();
  renderSelected();
  renderRoute();
  renderStats();
}

function renderSamples() {
  elements.sampleStack.innerHTML = sampleDrops
    .map(
      (sample) => `
        <button class="sample-card" data-sample="${sample.id}" type="button">
          <strong>${sample.label}</strong>
          <span>${sample.source}</span>
        </button>
      `
    )
    .join("");
}

function renderTabs() {
  elements.topicTabs.innerHTML = state.topics
    .map(
      (topic) => `
        <button class="topic-tab ${topic.id === state.activeTopicId ? "active" : ""}" data-topic="${topic.id}" type="button">
          ${topic.title} (${topic.cards.length})
        </button>
      `
    )
    .join("");
}

function renderInsights() {
  const activeTopic = getActiveTopic();
  elements.activeTopicTitle.textContent = activeTopic ? activeTopic.title : "Blank board";

  if (!activeTopic) {
    elements.insightRow.innerHTML = "";
    return;
  }

  const newest = activeTopic.cards[0];
  const reviewCount = activeTopic.cards.filter((card) => card.validation === "unreviewed").length;
  elements.insightRow.innerHTML = `
    <div class="insight-card">
      <strong>${newest ? newest.title : "No cards yet"}</strong>
      <span>Newest item stays at the top of this topic.</span>
    </div>
    <div class="insight-card">
      <strong>${reviewCount} to review</strong>
      <span>Approvals and pins improve future routing.</span>
    </div>
    <div class="insight-card">
      <strong>${Math.round(activeTopic.importance * 100)} topic weight</strong>
      <span>Importance nudges the board without hiding recency.</span>
    </div>
  `;
}

function renderCards() {
  const activeTopic = getActiveTopic();
  if (!activeTopic || activeTopic.cards.length === 0) {
    elements.cardsGrid.innerHTML = `
      <div class="empty-board">
        <div>
          <img src="./assets/vault-constellation.svg" alt="" />
          <h3>Drop the first useful thing</h3>
          <p>The board will create a topic, add a card, and explain why it landed there.</p>
        </div>
      </div>
    `;
    return;
  }

  elements.cardsGrid.innerHTML = activeTopic.cards
    .map(
      (card) => `
        <article class="topic-card ${card.id === state.newCardId ? "new-card" : ""} ${card.id === state.selectedCardId ? "selected" : ""}" data-card="${card.id}">
          <div class="card-top">
            <div class="card-kind ${kindClass(card.kind)}">${kindInitial(card.kind)}</div>
            <span class="badge">${card.validation}</span>
          </div>
          <h3>${card.title}</h3>
          <p>${card.summary}</p>
          <div class="cue-grid">
            ${cue("WHAT", card.what)}
            ${cue("WHY", card.why)}
            ${cue("HOW", card.how)}
            ${cue("WHEN", card.when)}
          </div>
          <div class="topic-card-footer">
            <span class="confidence">${Math.round(card.confidence * 100)}% fit</span>
            <span class="timestamp">${relativeTime(card.createdAt)}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSelected() {
  const card = getSelectedCard();
  if (!card) {
    elements.selectedCard.innerHTML = `
      <img src="./assets/vault-constellation.svg" alt="" />
      <strong>Nothing selected</strong>
      <span>Choose a card to inspect WHAT, WHY, HOW, and WHEN cues.</span>
    `;
    elements.selectedCard.classList.add("empty");
    return;
  }

  elements.selectedCard.classList.remove("empty");
  elements.selectedCard.innerHTML = `
    <div class="detail-group">
      <strong>${card.title}</strong>
      <p>${card.summary}</p>
    </div>
    ${detail("WHAT", card.what)}
    ${detail("WHY", card.why)}
    ${detail("HOW", card.how)}
    ${detail("WHEN", card.when)}
    <div class="route-row">
      <button class="mini-action" data-validate="approved">Approve</button>
      <button class="mini-action" data-validate="pinned">Pin</button>
      <button class="mini-action" data-validate="rejected">Reject</button>
    </div>
  `;
}

function renderRoute() {
  if (!state.lastRoute) {
    elements.latestRoute.className = "route-card empty";
    elements.latestRoute.innerHTML = `
      <strong>No routing decision yet</strong>
      <span>Drop content to see topic fit, confidence, and card movement.</span>
    `;
    return;
  }

  elements.latestRoute.className = "route-card";
  elements.latestRoute.innerHTML = `
    <strong>${state.lastRoute.strategy}: ${state.lastRoute.topicTitle}</strong>
    <span>${state.lastRoute.cardTitle}</span>
    <span>${Math.round(state.lastRoute.confidence * 100)}% confidence. ${state.lastRoute.reason}.</span>
  `;
}

function renderStats() {
  const allCards = state.topics.flatMap((topic) => topic.cards);
  const reviewCount = allCards.filter((card) => card.validation === "unreviewed").length;
  const load = Math.max(8, Math.min(92, 70 - state.avoidedFiles * 7 - allCards.filter((card) => card.validation !== "unreviewed").length * 4));

  elements.reviewCount.textContent = String(reviewCount);
  elements.topicCount.textContent = String(state.topics.length);
  elements.savedCount.textContent = String(state.avoidedFiles);
  elements.loadMeterFill.style.width = `${load}%`;
  elements.tokenStatus.textContent = `Context saved: ${state.savedTokens.toLocaleString()} tokens`;
  elements.localStatus.textContent = `${allCards.length} local cards`;
}

function cue(label, text) {
  return `
    <div class="cue-line">
      <span class="cue-label">${label}</span>
      <span>${text}</span>
    </div>
  `;
}

function detail(label, text) {
  return `
    <div class="detail-group">
      <strong>${label}</strong>
      <p>${text}</p>
    </div>
  `;
}

function kindClass(kind) {
  if (kind === "course") return "kind-course";
  if (kind === "project") return "kind-project";
  if (kind === "new") return "kind-new";
  return "kind-note";
}

function kindInitial(kind) {
  if (kind === "course") return "C";
  if (kind === "project") return "P";
  if (kind === "new") return "N";
  return "T";
}

function relativeTime(time) {
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function getActiveTopic() {
  return state.topics.find((topic) => topic.id === state.activeTopicId) || state.topics[0] || null;
}

function getSelectedCard() {
  for (const topic of state.topics) {
    const card = topic.cards.find((item) => item.id === state.selectedCardId);
    if (card) return card;
  }
  return null;
}

function exportContext() {
  const lines = ["# Second Brain Demo Export", ""];
  for (const topic of state.topics) {
    lines.push(`## ${topic.title}`, topic.summary, "");
    for (const card of topic.cards) {
      lines.push(`### ${card.title}`, `WHAT: ${card.what}`, `WHY: ${card.why}`, `HOW: ${card.how}`, `WHEN: ${card.when}`, "");
    }
  }
  navigator.clipboard
    .writeText(lines.join("\n"))
    .then(() => showToast("Board context copied"))
    .catch(() => showToast("Clipboard unavailable in this browser"));
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function resetDemo() {
  state = {
    topics: structuredClone(blankTopics),
    activeTopicId: "database-course",
    selectedCardId: null,
    savedTokens: 0,
    avoidedFiles: 0,
    lastRoute: null,
    newCardId: null
  };
  setProcessing(false, "Drop a file, paste text below, or run a sample.");
  render();
}

function runOnboardingSequence() {
  resetDemo();
  sampleDrops.forEach((sample, index) => {
    window.setTimeout(() => ingestDrop(sample), index * 1100);
  });
}

function wireEvents() {
  elements.sampleStack.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sample]");
    if (!button) return;
    const sample = sampleDrops.find((item) => item.id === button.dataset.sample);
    if (sample) ingestDrop(sample);
  });

  elements.topicTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-topic]");
    if (!button) return;
    state.activeTopicId = button.dataset.topic;
    state.selectedCardId = null;
    render();
  });

  elements.cardsGrid.addEventListener("click", (event) => {
    const cardEl = event.target.closest("[data-card]");
    if (!cardEl) return;
    state.selectedCardId = cardEl.dataset.card;
    renderCards();
    renderSelected();
  });

  elements.selectedCard.addEventListener("click", (event) => {
    const button = event.target.closest("[data-validate]");
    const card = getSelectedCard();
    if (!button || !card) return;
    card.validation = button.dataset.validate;
    showToast(`${card.title} marked ${card.validation}`);
    render();
  });

  elements.ingestPaste.addEventListener("click", () => ingestRawText(elements.pasteBox.value));
  elements.resetDemo.addEventListener("click", resetDemo);
  elements.runDemo.addEventListener("click", runOnboardingSequence);
  elements.exportContext.addEventListener("click", exportContext);

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
    elements.dropMessage.textContent = "Release to ingest locally.";
  });

  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("dragging");
    elements.dropMessage.textContent = "Drop a file, paste text below, or run a sample.";
  });

  elements.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
    const file = event.dataTransfer.files[0];
    const text = event.dataTransfer.getData("text/plain");
    if (file) {
      const content = await file.text().catch(() => file.name);
      ingestRawText(content);
      return;
    }
    ingestRawText(text);
  });
}

wireEvents();
render();
