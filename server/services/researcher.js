/**
 * Miwa Research Service
 *
 * Searches PubMed and Brave Search for clinical articles and uses GPT-4o to
 * synthesize them into a personalized weekly brief for each clinician.
 *
 * Two modes:
 *   1. Weekly brief — broad mental health research (runs Monday 8am)
 *   2. Crisis brief  — triggered when a DETERIORATION or RISK alert fires,
 *      searches for articles specific to what that client is going through
 *
 * Sources:
 *   - PubMed E-utilities (always, free, peer-reviewed journals only)
 *   - Brave Search API (if BRAVE_SEARCH_API_KEY is set, supplements with
 *     recent clinical news, guidelines, and articles not yet in PubMed)
 */

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { MODELS, callAI, synthesizeResearch } = require('../lib/aiExecutor');
const { sendMail } = require('./mailer');

// ── PubMed helpers ────────────────────────────────────────────────────────────

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const PUBMED_HEADERS = { 'User-Agent': 'MiwaResearch/1.0 (research@miwa.care)' };

async function searchPubMed(query, maxResults = 5) {
  try {
    const thisYear = new Date().getFullYear();
    const minYear = thisYear - 2; // last 2 years only

    const searchUrl =
      `${PUBMED_BASE}/esearch.fcgi?db=pubmed` +
      `&term=${encodeURIComponent(query + ' [Title/Abstract]')}` +
      `&retmax=${maxResults}&sort=relevance&retmode=json` +
      `&datetype=pdat&mindate=${minYear}&maxdate=${thisYear}`;

    const searchRes = await fetch(searchUrl, { headers: PUBMED_HEADERS });
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (!ids.length) return [];

    // Fetch summaries for found IDs
    const summaryUrl =
      `${PUBMED_BASE}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl, { headers: PUBMED_HEADERS });
    if (!summaryRes.ok) return [];
    const summaryData = await summaryRes.json();

    return ids.map(id => {
      const a = summaryData.result?.[id];
      if (!a) return null;
      return {
        pmid: id,
        title: a.title || 'Untitled',
        authors: (a.authors || []).slice(0, 3).map(au => au.name).join(', '),
        journal: a.fulljournalname || a.source || '',
        date: a.pubdate || '',
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        source: 'pubmed',
      };
    }).filter(Boolean);
  } catch (err) {
    console.error('[researcher] PubMed search error:', err.message);
    return [];
  }
}

// Small delay to respect rate limits
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── OpenAlex helpers (free, no API key, 200M+ works) ─────────────────────────

async function searchOpenAlex(query, maxResults = 5) {
  try {
    const thisYear = new Date().getFullYear();
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}` +
      `&filter=from_publication_date:${thisYear - 2}-01-01,is_oa:true,type:article` +
      `&sort=relevance_score:desc&per_page=${maxResults}` +
      `&mailto=research@miwa.care`;

    const res = await fetch(url, { headers: { 'User-Agent': 'MiwaResearch/1.0 (research@miwa.care)' } });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results || []).map(work => {
      const authors = (work.authorships || []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(', ');
      const journal = work.primary_location?.source?.display_name || '';
      const doi = work.doi ? `https://doi.org/${work.doi.replace('https://doi.org/', '')}` : '';
      return {
        title: work.title || 'Untitled',
        authors,
        journal,
        date: work.publication_date || '',
        url: doi || work.primary_location?.landing_page_url || `https://openalex.org/works/${work.id}`,
        source: 'openalex',
        cited_by: work.cited_by_count || 0,
      };
    }).filter(a => a.title && a.title !== 'Untitled');
  } catch (err) {
    console.error('[researcher] OpenAlex search error:', err.message);
    return [];
  }
}

// ── Brave Search helpers ──────────────────────────────────────────────────────

const BRAVE_SEARCH_BASE = 'https://api.search.brave.com/res/v1/web/search';

// Domains we trust for clinical content — Brave results are filtered to prefer these
const TRUSTED_DOMAINS = [
  'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'nih.gov',
  'jamanetwork.com', 'thelancet.com', 'nejm.org', 'bmj.com',
  'psychiatryonline.org', 'apa.org', 'guilford.com',
  'samhsa.gov', 'who.int', 'cdc.gov', 'nami.org',
  'psychiatrictimes.com', 'psychologytoday.com',
  'frontiersin.org', 'springer.com', 'wiley.com', 'elsevier.com',
  'tandfonline.com', 'sage.com', 'sagepub.com',
  'sciencedirect.com', 'nature.com', 'cell.com',
];

async function searchBrave(query, maxResults = 5) {
  if (!process.env.BRAVE_SEARCH_API_KEY) return [];
  try {
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(maxResults, 20)),
      freshness: 'py', // past year
      result_filter: 'web',
    });

    const res = await fetch(`${BRAVE_SEARCH_BASE}?${params}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY,
      },
    });
    if (!res.ok) return [];

    const data = await res.json();
    const results = data.web?.results || [];

    return results
      .filter(r => r.url && r.title)
      .map(r => {
        let hostname = '';
        try { hostname = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
        return {
          pmid: null,
          title: r.title,
          authors: r.extra_snippets?.[0] || '',
          journal: hostname,
          date: r.age || '',
          url: r.url,
          source: 'brave',
          trusted: TRUSTED_DOMAINS.some(d => hostname.includes(d.replace(/^www\./, ''))),
        };
      })
      // Prefer trusted clinical sources but include others too
      .sort((a, b) => (b.trusted ? 1 : 0) - (a.trusted ? 1 : 0));
  } catch (err) {
    console.error('[researcher] Brave Search error:', err.message);
    return [];
  }
}

/**
 * Run multiple Brave Search queries for one topic to get broad coverage:
 * - Main topic query
 * - Systematic reviews / meta-analyses
 * - Clinical guidelines / treatment protocols
 */
async function deepSearchBrave(topic, baseDelay = 0) {
  if (!process.env.BRAVE_SEARCH_API_KEY) return [];

  const queries = [
    `${topic} clinical research 2024 2025`,
    `${topic} systematic review meta-analysis`,
    `${topic} evidence-based treatment guidelines`,
  ];

  const allResults = [];
  for (const q of queries) {
    const results = await searchBrave(q, 4);
    allResults.push(...results);
    await sleep(baseDelay + 250); // polite delay between requests
  }
  return allResults;
}

// ── Topic detection from caseload ─────────────────────────────────────────────

async function buildCaseloadTopics(db, therapistId) {
  const topics = new Set();

  // Core weekly topics — always included
  topics.add('cognitive behavioral therapy clinical outcomes randomized controlled trial');
  topics.add('telehealth psychotherapy effectiveness mental health');

  // Pull patient presenting concerns + client type
  let patients;
  try {
    patients = await db.all(
      `SELECT presenting_concerns, client_type FROM patients
       WHERE therapist_id = ? AND (status IS NULL OR status != 'inactive')`,
      therapistId
    );
  } catch {
    // Fallback if status column doesn't exist
    patients = await db.all(
      `SELECT presenting_concerns, client_type FROM patients WHERE therapist_id = ?`,
      therapistId
    );
  }

  const concerns = patients.flatMap(p => {
    const raw = (p.presenting_concerns || '') + ' ' + (p.client_type || '');
    return raw.toLowerCase().split(/[,;\n]+/).map(s => s.trim()).filter(s => s.length > 3);
  });

  // Map common concern keywords to PubMed-friendly search terms
  const CONCERN_MAP = {
    anxiety: 'anxiety disorder treatment evidence-based intervention',
    depression: 'major depressive disorder treatment outcomes',
    trauma: 'PTSD trauma-informed care treatment efficacy',
    grief: 'grief bereavement therapy intervention',
    adhd: 'ADHD adult treatment psychotherapy',
    ocd: 'OCD exposure response prevention efficacy',
    bipolar: 'bipolar disorder psychotherapy outcomes',
    eating: 'eating disorder treatment CBT outcomes',
    substance: 'substance use disorder treatment psychotherapy',
    relationship: 'couples therapy relationship distress intervention',
    family: 'family therapy systemic intervention outcomes',
    child: 'child adolescent psychotherapy clinical trial',
    suicide: 'suicide prevention safety planning intervention',
    self: 'self-harm non-suicidal self-injury treatment',
    sleep: 'insomnia CBT sleep intervention outcomes',
    anger: 'anger management DBT intervention efficacy',
  };

  for (const concern of concerns) {
    for (const [keyword, searchTerm] of Object.entries(CONCERN_MAP)) {
      if (concern.includes(keyword)) {
        topics.add(searchTerm);
        break;
      }
    }
  }

  // Check recent unread alerts — add crisis-specific topics
  let alerts = [];
  try {
    alerts = await db.all(
      `SELECT alert_type, description FROM proactive_alerts
       WHERE therapist_id = ? AND dismissed_at IS NULL
       AND created_at > datetime('now', '-7 days')`,
      therapistId
    );
  } catch {
    // proactive_alerts table may not exist yet
  }

  for (const alert of alerts) {
    if (alert.alert_type === 'DETERIORATION') {
      topics.add('mental health deterioration early intervention prevention');
    }
    if (alert.alert_type === 'RISK_REVIEW_DUE') {
      topics.add('suicide risk assessment safety planning clinician guide');
    }
  }

  return [...topics].slice(0, 6); // cap at 6 topics (Brave does deep search per topic)
}

// ── AI synthesis ──────────────────────────────────────────────────────────────

async function synthesizeBrief(articles, topics, briefType, therapistName, therapistId = null) {
  const articleList = articles
    .map((a, i) => {
      const meta = [a.authors, a.journal, a.date].filter(Boolean).join(', ');
      const sourceTag = a.source === 'pubmed' ? '[PubMed]' : a.source === 'openalex' ? '[OpenAlex]' : '[Web]';
      return `${i + 1}. ${sourceTag} "${a.title}"${meta ? ` — ${meta}` : ''}\n   URL: ${a.url}`;
    })
    .join('\n\n');

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const isDaily = briefType !== 'crisis';
  const introInstruction = isDaily
    ? 'Write a daily clinical research brief for a licensed therapist.'
    : 'A crisis alert fired on this clinician\'s caseload. Write a targeted research brief with articles directly relevant to the situation.';

  const systemPrompt =
    `You are Miwa, an AI clinical research assistant. ${introInstruction}\n\n` +
    `Guidelines:\n` +
    `- Be concise and practical — clinicians are busy\n` +
    `- Highlight clinical takeaways, not just methodology\n` +
    `- Format with clear sections using markdown\n` +
    `- Articles come from PubMed, OpenAlex, and web search — treat all as sources but note peer-reviewed ones\n` +
    `- Never fabricate findings — only reference what's in the provided articles\n` +
    `- Synthesize across multiple articles when they cover the same theme\n` +
    `- Tone: warm, collegial, like a knowledgeable colleague sharing a finding\n` +
    `- End with one actionable suggestion the clinician could try today\n` +
    `- IMPORTANT: This is a DAILY brief. Never use the word "Weekly" anywhere in your response.`;

  const userPrompt =
    `Date: ${dateStr}\n` +
    `Clinician: ${therapistName || 'Clinician'}\n` +
    `Caseload topics: ${topics.join(', ')}\n\n` +
    `Articles found:\n${articleList}\n\n` +
    `Write the ${isDaily ? 'daily research brief' : 'crisis-relevant research note'} now. ` +
    `Keep it under 600 words. Use markdown headers. Synthesize the best findings across all sources.`;

  // Routes research synthesis through the centralized Azure OpenAI path.
  // Cost is logged against therapistId when provided.
  return synthesizeResearch(systemPrompt, userPrompt, 1400, { therapistId });
}

// ── Email delivery ────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMd(s) {
  // Escape first, then apply inline markdown so user text can't inject HTML.
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return out;
}

function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let listType = null; // 'ul' | 'ol' | null
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      html.push(`<p>${paraBuf.map(inlineMd).join('<br>')}</p>`);
      paraBuf = [];
    }
  };
  const closeList = () => {
    if (listType) { html.push(`</${listType}>`); listType = null; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (!line.trim()) { flushPara(); closeList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushPara(); closeList();
      const level = Math.min(h[1].length + 1, 6); // bump so # → h2 (h1 reserved for header)
      html.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul'; }
      html.push(`<li>${inlineMd(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; }
      html.push(`<li>${inlineMd(ol[1])}</li>`);
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushPara(); closeList();
      html.push('<hr>');
      continue;
    }

    closeList();
    paraBuf.push(line);
  }

  flushPara(); closeList();
  return html.join('\n');
}

async function sendBriefEmail(therapist, title, content, articles) {
  try {
    const articleLinksHtml = articles
      .map(a => `<li><a href="${a.url}" target="_blank">${a.title}</a> — ${a.authors} (${a.journal})</li>`)
      .join('\n');

    const bodyHtml = mdToHtml(content);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a2e; max-width: 600px; margin: 0 auto; padding: 24px; }
    .header { background: linear-gradient(135deg, #6047EE, #0ac5a2); padding: 20px 24px; border-radius: 12px; margin-bottom: 24px; }
    .header h1 { color: white; margin: 0; font-size: 20px; }
    .header p { color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 13px; }
    .content { line-height: 1.7; font-size: 14px; }
    .content h2 { font-size: 16px; color: #6047EE; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin: 24px 0 8px; }
    .content h3 { font-size: 14px; color: #1a1a2e; margin: 18px 0 6px; }
    .content h4 { font-size: 13px; color: #1a1a2e; margin: 14px 0 4px; }
    .content p { margin: 8px 0; }
    .content ul, .content ol { padding-left: 20px; margin: 8px 0; }
    .content li { margin-bottom: 6px; }
    .content strong { color: #1a1a2e; font-weight: 600; }
    .content a { color: #6047EE; }
    .content hr { border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0; }
    .sources { margin-top: 24px; padding: 16px; background: #f8f7ff; border-radius: 8px; }
    .sources h3 { margin: 0 0 12px; font-size: 13px; color: #6047EE; text-transform: uppercase; letter-spacing: 0.05em; }
    .sources li { font-size: 12px; margin-bottom: 6px; }
    .sources a { color: #6047EE; text-decoration: none; }
    .footer { margin-top: 24px; font-size: 11px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Miwa Research Brief</h1>
    <p>${title}</p>
  </div>
  <div class="content">
    ${bodyHtml}
  </div>
  <div class="sources">
    <h3>Source Articles</h3>
    <ul>${articleLinksHtml}</ul>
  </div>
  <div class="footer">
    Miwa Care · AI-powered clinical research · <a href="https://miwa.care">miwa.care</a><br>
    Articles sourced from PubMed and clinical web sources
  </div>
</body>
</html>`;

    await sendMail({
      to: therapist.email,
      subject: `Miwa Research Brief: ${title}`,
      html: htmlContent,
      text: `${title}\n\n${content}`,
    });

    return true;
  } catch (err) {
    console.error('[researcher] Email send error:', err.message);
    return false;
  }
}

// ── Main entry points ─────────────────────────────────────────────────────────

/**
 * Generate and store a research brief for one therapist.
 * briefType: 'weekly' | 'crisis'
 */
async function generateBriefForTherapist(therapistId, briefType = 'daily') {
  console.log(`[researcher] === Starting brief generation for therapist_id=${therapistId} type=${briefType} ===`);

  const db = getAsyncDb();

  const therapist = await db.get(
    'SELECT id, email, full_name, first_name FROM therapists WHERE id = ?',
    therapistId
  );
  if (!therapist) {
    console.error(`[researcher] Therapist not found: id=${therapistId}`);
    throw new Error('Therapist not found');
  }

  const therapistName = therapist.first_name || therapist.full_name || 'Clinician';
  console.log(`[researcher] Therapist: ${therapistName} (${therapist.email})`);

  // Detect caseload-relevant topics
  const topics = await buildCaseloadTopics(db, therapistId);
  console.log(`[researcher] Topics (${topics.length}):`, topics);

  // ── Get previously used article URLs/PMIDs to avoid repeats ─────────────
  const previousArticles = new Set();
  try {
    const recentBriefs = await db.all(
      "SELECT articles_json FROM research_briefs WHERE therapist_id = ? AND created_at > datetime('now', '-14 days')",
      therapistId
    );
    for (const b of recentBriefs) {
      try {
        const arts = JSON.parse(b.articles_json || '[]');
        for (const a of arts) {
          if (a.pmid) previousArticles.add(a.pmid);
          if (a.url) previousArticles.add(a.url);
        }
      } catch {}
    }
  } catch {}
  console.log(`[researcher] Filtering against ${previousArticles.size} previously used articles`);

  // ── Phase 1: PubMed (peer-reviewed, authoritative) ──────────────────────────
  // Daily briefs: 1-2 articles per topic, 3 max total. Weekly/crisis: more.
  // Daily: 2-3 articles, Crisis: 2-3 articles, Manual "weekly" button: 3-4 articles
  const articlesPerTopic = 2;
  const maxTotalArticles = briefType === 'crisis' ? 3 : 3;

  const allArticles = [];
  for (const topic of topics) {
    const articles = await searchPubMed(topic, articlesPerTopic);
    allArticles.push(...articles);
    await sleep(400);
    if (allArticles.length >= maxTotalArticles * 2) break; // don't over-fetch
  }

  console.log(`[researcher] PubMed found ${allArticles.length} articles`);

  // Phase 1b: OpenAlex (open-access peer-reviewed)
  for (const topic of topics.slice(0, 3)) {
    const oaArticles = await searchOpenAlex(topic, 3);
    allArticles.push(...oaArticles);
    await sleep(300);
  }

  // Phase 2: Brave deep search across topics
  if (process.env.BRAVE_SEARCH_API_KEY) {
    console.log(`[researcher] Running Brave deep search across ${topics.length} topics`);
    for (const topic of topics.slice(0, 3)) {
      const braveArticles = await deepSearchBrave(topic, 100);
      allArticles.push(...braveArticles);
    }
  }

  // ── Deduplicate + filter out previously used articles ──────────────────────
  const seenPmids = new Set();
  const seenUrls = new Set();
  const deduped = allArticles.filter(a => {
    // Skip if used in a previous brief
    if (a.pmid && previousArticles.has(a.pmid)) return false;
    if (a.url && previousArticles.has(a.url)) return false;
    // Normal dedup
    if (a.pmid) {
      if (seenPmids.has(a.pmid)) return false;
      seenPmids.add(a.pmid);
    } else {
      if (seenUrls.has(a.url)) return false;
      seenUrls.add(a.url);
    }
    return true;
  });

  // Prioritize: PubMed first, then OpenAlex, then Brave
  const uniqueArticles = [
    ...deduped.filter(a => a.source === 'pubmed'),
    ...deduped.filter(a => a.source === 'openalex'),
    ...deduped.filter(a => a.source === 'brave' && a.trusted),
    ...deduped.filter(a => a.source === 'brave' && !a.trusted),
  ].slice(0, maxTotalArticles);

  console.log(`[researcher] Found ${uniqueArticles.length} unique articles (PubMed: ${uniqueArticles.filter(a => a.source === 'pubmed').length}, Brave: ${uniqueArticles.filter(a => a.source === 'brave').length})`);

  if (!uniqueArticles.length) {
    console.error(`[researcher] No articles found for therapist_id=${therapistId}. Topics searched: ${topics.join(', ')}`);
    throw new Error('No research articles found. Try again in a few minutes — PubMed or OpenAlex may be temporarily unavailable.');
  }

  // AI synthesis — cost tracked against this therapist
  const content = await synthesizeBrief(uniqueArticles, topics, briefType, therapistName, therapistId);

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const title = briefType === 'crisis'
    ? `Clinical Research Alert — ${dateStr}`
    : `Daily Research Brief — ${dateStr}`;

  // Store in DB
  await db.insert(
    `INSERT INTO research_briefs (therapist_id, brief_type, title, content, articles_json, topics_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    therapistId, briefType, title, content,
    JSON.stringify(uniqueArticles), JSON.stringify(topics)
  );

  // Send email
  const emailed = await sendBriefEmail(therapist, title, content, uniqueArticles);

  await db.run(
    `UPDATE research_briefs SET sent_email = ? WHERE id = (
       SELECT id FROM research_briefs WHERE therapist_id = ? ORDER BY created_at DESC LIMIT 1
     )`,
    emailed ? 1 : 0, therapistId
  );

  await persistIfNeeded();

  console.log(`[researcher] Brief generated for therapist_id=${therapistId} type=${briefType} emailed=${emailed}`);
}

/**
 * Run daily brief for ALL therapists.
 * Called by scheduler every day at 6am per therapist timezone.
 */
async function runDailyBriefs() {
  const db = getAsyncDb();
  const therapists = await db.all('SELECT DISTINCT therapist_id FROM patients');

  console.log(`[researcher] Starting weekly briefs for ${therapists.length} therapist(s)`);

  for (const { therapist_id } of therapists) {
    try {
      await generateBriefForTherapist(therapist_id, 'daily');
      await sleep(2000); // space out Azure AI + PubMed calls between therapists
    } catch (err) {
      console.error(`[researcher] Failed brief for therapist_id=${therapist_id}: ${err.message}`);
    }
  }
}

/**
 * Trigger a crisis brief for a specific therapist when a critical alert fires.
 * Called by the alerts scheduler when DETERIORATION or RISK_REVIEW_DUE alert is created.
 */
async function triggerCrisisBrief(therapistId) {
  // Debounce: only generate crisis brief once per 24 hours per therapist
  const db = getAsyncDb();
  const recent = await db.get(
    `SELECT id FROM research_briefs
     WHERE therapist_id = ? AND brief_type = 'crisis'
     AND created_at > datetime('now', '-24 hours')`,
    therapistId
  );
  if (recent) return; // already sent today

  try {
    await generateBriefForTherapist(therapistId, 'crisis');
  } catch (err) {
    console.error(`[researcher] Crisis brief failed for therapist_id=${therapistId}: ${err.message}`);
  }
}

module.exports = { runDailyBriefs, triggerCrisisBrief, generateBriefForTherapist };
