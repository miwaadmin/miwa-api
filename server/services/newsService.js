/**
 * Mental Health News Service
 *
 * Every 6 hours: fetches the last 24 hours of mental health news via Brave Search,
 * summarises each article with Azure OpenAI Haiku, stores results in mental_health_news.
 *
 * Only stores articles with real URLs — no hallucinated sources.
 */

const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
const { MODELS, callAI } = require('../lib/aiExecutor');

// Trusted mental health / clinical domains (whitelist)
const TRUSTED_DOMAINS = [
  'psychiatry.org', 'apa.org', 'nimh.nih.gov', 'samhsa.gov', 'who.int',
  'ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'jamanetwork.com',
  'lancet.com', 'bmj.com', 'nejm.org', 'frontiersin.org',
  'psychologytoday.com', 'mdedge.com', 'psychiatrictimes.com',
  'healthline.com', 'medicalnewstoday.com', 'verywellmind.com',
  'nami.org', 'mhanational.org', 'mentalhealthamerica.net',
  'reuters.com', 'apnews.com', 'bbc.com', 'theguardian.com', 'nytimes.com',
];

function isTrustedDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return TRUSTED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

async function searchBraveNews(query) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY not set');

  const params = new URLSearchParams({
    q: query,
    count: '15',
    freshness: 'pd', // past day
    result_filter: 'web',
  });

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) throw new Error(`Brave Search error: ${res.status}`);
  const data = await res.json();
  return (data.web?.results || []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || '',
    source: r.meta_url?.hostname?.replace(/^www\./, '') || '',
    published_at: r.age || null,
  }));
}

async function summariseArticle(title, description) {
  if (!description || description.length < 40) return description || title;
  try {
    const system = `You are a clinical information specialist writing for practicing therapists and counselors.

Summarise the following mental health news article in 4-5 sentences. Your summary should:
1. State the key finding or news clearly in the first sentence
2. Explain the clinical significance — why should a therapist care?
3. Include any relevant data points, study details, or population served
4. End with a practical takeaway or implication for clinical practice

Be factual, direct, and clinically relevant. Do not add information not in the snippet. Write in prose, not bullets.`;
    const user = `Title: ${title}\n\nSnippet: ${description}`;
    return await callAI(MODELS.AZURE_MAIN, system, user, 400);
  } catch {
    return description;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAndStoreNews() {
  const db = getAsyncDb();

  const queries = [
    'mental health treatment research 2025',
    'psychiatry psychology clinical news',
    'therapy counseling evidence-based practice',
    'anxiety depression PTSD treatment update',
  ];

  const seen = new Set();
  const candidates = [];

  for (const q of queries) {
    try {
      const results = await searchBraveNews(q);
      for (const r of results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        candidates.push(r);
      }
    } catch (err) {
      console.warn(`[newsService] Query failed: "${q}" — ${err.message}`);
    }
    // Polite delay between Brave Search requests to avoid 429 rate limits
    await sleep(800);
  }

  // Prefer trusted domains; sort rest after
  const trusted = candidates.filter(r => isTrustedDomain(r.url));
  const others  = candidates.filter(r => !isTrustedDomain(r.url));
  const ordered = [...trusted, ...others].slice(0, 5);

  let inserted = 0;
  for (const article of ordered) {
    try {
      // Skip if already stored
      const existing = await db.get('SELECT id FROM mental_health_news WHERE url = ?', article.url);
      if (existing) continue;

      const summary = await summariseArticle(article.title, article.description);

      await db.insert(
        `INSERT INTO mental_health_news (title, url, source, published_at, summary) VALUES (?, ?, ?, ?, ?)`,
        article.title,
        article.url,
        article.source || null,
        article.published_at || null,
        summary,
      );
      inserted++;
    } catch (err) {
      // Ignore duplicate URL constraint violations
      if (!err.message?.includes('UNIQUE')) {
        console.warn(`[newsService] Failed to store article: ${err.message}`);
      }
    }
  }

  // Prune articles older than 72 hours to keep DB lean
  try {
    await db.run(`DELETE FROM mental_health_news WHERE fetched_at < datetime('now', '-72 hours')`);
  } catch {}
  await persistIfNeeded();

  console.log(`[newsService] Fetched ${ordered.length} articles, inserted ${inserted} new`);
  return inserted;
}

/**
 * Returns the latest stored news articles (up to limit).
 */
async function getLatestNews(limit = 5) {
  const db = getAsyncDb();
  return db.all(
    `SELECT id, title, url, source, published_at, summary, fetched_at
     FROM mental_health_news
     ORDER BY fetched_at DESC, id DESC
     LIMIT ?`,
    limit
  );
}

module.exports = { fetchAndStoreNews, getLatestNews };
