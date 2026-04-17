// TabMind Clustering Engine
// Two modes: fast heuristic clustering, and AI-powered semantic clustering

// --- Heuristic clustering by domain/keyword ---

const DOMAIN_CATEGORIES = {
  // Dev
  'github.com': 'Development',
  'stackoverflow.com': 'Development',
  'developer.mozilla.org': 'Development',
  'developer.chrome.com': 'Development',
  'npmjs.com': 'Development',
  'vercel.com': 'Development',
  'netlify.com': 'Development',
  'codepen.io': 'Development',
  'replit.com': 'Development',
  'codesandbox.io': 'Development',
  'docs.rs': 'Development',
  'crates.io': 'Development',
  'pypi.org': 'Development',
  'localhost': 'Development',
  '127.0.0.1': 'Development',

  // Research / Reading
  'arxiv.org': 'Research',
  'scholar.google.com': 'Research',
  'pubmed.ncbi.nlm.nih.gov': 'Research',
  'semanticscholar.org': 'Research',
  'wikipedia.org': 'Research',
  'medium.com': 'Research',
  'substack.com': 'Research',
  'notion.so': 'Research',

  // Social
  'twitter.com': 'Social',
  'x.com': 'Social',
  'reddit.com': 'Social',
  'facebook.com': 'Social',
  'instagram.com': 'Social',
  'linkedin.com': 'Social',
  'discord.com': 'Social',
  'slack.com': 'Social',
  'news.ycombinator.com': 'Social',

  // Shopping
  'amazon.com': 'Shopping',
  'flipkart.com': 'Shopping',
  'myntra.com': 'Shopping',
  'ebay.com': 'Shopping',
  'etsy.com': 'Shopping',
  'aliexpress.com': 'Shopping',

  // Video / Entertainment
  'youtube.com': 'Video',
  'netflix.com': 'Video',
  'twitch.tv': 'Video',
  'vimeo.com': 'Video',
  'hotstar.com': 'Video',

  // Work / Productivity
  'docs.google.com': 'Work',
  'sheets.google.com': 'Work',
  'drive.google.com': 'Work',
  'mail.google.com': 'Work',
  'calendar.google.com': 'Work',
  'notion.so': 'Work',
  'airtable.com': 'Work',
  'trello.com': 'Work',
  'jira.atlassian.com': 'Work',
  'asana.com': 'Work',
  'figma.com': 'Work',

  // News
  'bbc.com': 'News',
  'cnn.com': 'News',
  'reuters.com': 'News',
  'theverge.com': 'News',
  'techcrunch.com': 'News',
  'ycombinator.com': 'News',
  'nytimes.com': 'News',
};

const CATEGORY_COLORS = {
  'Development': '#3B8BD4',
  'Research':    '#7F77DD',
  'Social':      '#D4537E',
  'Shopping':    '#1D9E75',
  'Video':       '#D85A30',
  'Work':        '#BA7517',
  'News':        '#639922',
  'Other':       '#888780',
};

export function getDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function heuristicCluster(tabs) {
  const groups = {};

  for (const tab of tabs) {
    const domain = getDomain(tab.url);
    let category = 'Other';

    // Exact domain match
    if (DOMAIN_CATEGORIES[domain]) {
      category = DOMAIN_CATEGORIES[domain];
    } else {
      // Partial domain match (e.g. subdomain.github.com)
      for (const [key, cat] of Object.entries(DOMAIN_CATEGORIES)) {
        if (domain.endsWith(key)) { category = cat; break; }
      }
    }

    if (!groups[category]) {
      groups[category] = {
        id: category.toLowerCase().replace(/\s+/g, '-'),
        label: category,
        color: CATEGORY_COLORS[category] || CATEGORY_COLORS['Other'],
        tabs: [],
        source: 'heuristic',
      };
    }
    groups[category].tabs.push(tab);
  }

  return Object.values(groups).sort((a, b) => b.tabs.length - a.tabs.length);
}

// --- AI clustering via Anthropic API ---

export async function aiCluster(tabs, apiKey) {
  // Prepare a compact tab list
  const tabList = tabs.map((t, i) => `${i}: ${t.title} [${getDomain(t.url)}]`).join('\n');

  const prompt = `You are a tab organiser. Given this list of browser tabs, group them into meaningful clusters.
Each cluster should have a short, descriptive name (2-4 words).
Return ONLY valid JSON — no explanation, no markdown, no backticks.

Format:
{
  "clusters": [
    {
      "label": "Cluster Name",
      "color": "#hex",
      "tabIndexes": [0, 1, 2]
    }
  ]
}

Use these hex colors for variety: #3B8BD4 #7F77DD #1D9E75 #D85A30 #D4537E #BA7517 #639922 #888780

Tabs:
${tabList}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  // Strip any accidental markdown fences
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);

  return parsed.clusters.map(cluster => ({
    id: cluster.label.toLowerCase().replace(/\s+/g, '-'),
    label: cluster.label,
    color: cluster.color,
    tabs: cluster.tabIndexes.map(i => tabs[i]).filter(Boolean),
    source: 'ai',
  }));
}

// --- Duplicate detection ---

export function findDuplicates(tabs) {
  const urlCounts = new Map();
  // First pass: count occurrences of each URL
  for (const tab of tabs) {
    const key = tab.url.split('#')[0]; // ignore hash fragments
    if (!urlCounts.has(key)) urlCounts.set(key, []);
    urlCounts.get(key).push(tab.id);
  }
  // Second pass: mark ALL instances that share a URL
  const dupes = [];
  for (const [, ids] of urlCounts) {
    if (ids.length > 1) dupes.push(...ids);
  }
  return dupes;
}

// --- Fuzzy search (simple but effective) ---

export function fuzzySearch(tabs, query) {
  if (!query.trim()) return tabs;
  const q = query.toLowerCase();
  return tabs.filter(tab => {
    const haystack = (tab.title + ' ' + tab.url).toLowerCase();
    return haystack.includes(q);
  }).sort((a, b) => {
    // Rank title matches higher than URL matches
    const aTitle = a.title.toLowerCase().includes(q);
    const bTitle = b.title.toLowerCase().includes(q);
    if (aTitle && !bTitle) return -1;
    if (!aTitle && bTitle) return 1;
    return 0;
  });
}

// --- Age helpers ---

export function timeSince(ts) {
  if (!ts) return 'unknown';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return 'just now';
}
