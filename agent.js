// ==========================================
// CONFIGURATION
// ==========================================
const MODEL_NAME = 'gemini-3.5-flash-lite'; // Change AI model name here in one second (e.g. 'gemini-3.5-flash-lite', 'gemini-2.5-flash', etc.)
const AUTO_OPEN_BROWSER = true;             // Set to false to switch off opening browser automatically

// ==========================================
// IMPORTS (Node.js built-ins only)
// ==========================================
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const SCRIPT_DIR = __dirname;
const KEY_FILE = path.join(SCRIPT_DIR, 'key.txt');
const COMPOSIO_KEY_FILE = path.join(SCRIPT_DIR, 'composio-key.txt');
const DIGEST_FILE = path.join(SCRIPT_DIR, 'digest.html');
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || 'your-email@example.com'; // Set RECIPIENT_EMAIL in env

// Trade & Geographic Settings
// Niche: Cafe & restaurant owners in India needing food photos/videos for Zomato, Swiggy, Instagram
const SEARCH_QUERY = 'cafes OR restaurants OR "food delivery" OR Swiggy OR Zomato India';
const RSS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent(SEARCH_QUERY)}&hl=en-IN&gl=IN&ceid=IN:en`;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location));
      }
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

function parseRss(xml) {
  const items = [];
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  for (const itemXml of itemMatches) {
    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
    const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i);

    let rawTitle = titleMatch ? titleMatch[1].trim() : '';
    // Unescape XML entities
    rawTitle = rawTitle.replace(/&amp;/g, '&')
                       .replace(/&lt;/g, '<')
                       .replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"')
                       .replace(/&#39;/g, "'");

    let source = sourceMatch ? sourceMatch[1].trim() : '';
    let headline = rawTitle;
    if (!source && rawTitle.includes(' - ')) {
      const parts = rawTitle.split(' - ');
      source = parts.pop().trim();
      headline = parts.join(' - ').trim();
    } else if (source && headline.endsWith(` - ${source}`)) {
      headline = headline.slice(0, -(source.length + 3)).trim();
    }

    const link = linkMatch ? linkMatch[1].trim() : '#';
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';

    items.push({ headline, source: source || 'Google News', link, pubDate });
  }

  // Deduplicate stories by normalized headline
  const uniqueItems = [];
  const seenHeadlines = new Set();

  for (const item of items) {
    const norm = item.headline.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!seenHeadlines.has(norm)) {
      seenHeadlines.add(norm);
      uniqueItems.push(item);
    }
    if (uniqueItems.length >= 5) break;
  }

  return uniqueItems;
}

function callAI(key, stories) {
  return new Promise((resolve, reject) => {
    const isSkOr = key.startsWith('sk-or-');
    const prompt = `You are an AI analyst advising cafe and restaurant owners in India who rely on food photography, short-form food videos, and food delivery platforms (Zomato, Swiggy, Instagram).

Analyze these 5 latest news stories. For EACH story, write EXACTLY two distinct lines:
Line 1: What happened (one clear factual sentence).
Line 2: What it means for my clients (one clear sentence on how cafe owners should use this, e.g., menu promos, video content ideas, food styling, platform algorithms, or diner demand).

Format your output EXACTLY as:
1.
Happened: [What happened]
Means: [What it means for my clients]

2.
Happened: [What happened]
Means: [What it means for my clients]

Stories:
${stories.map((s, i) => `${i + 1}. ${s.headline} (Source: ${s.source})`).join('\n')}
`;

    if (isSkOr) {
      // OpenRouter API
      const postData = JSON.stringify({
        model: MODEL_NAME,
        messages: [{ role: 'user', content: prompt }]
      });
      const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'CafeNewsDigest'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.choices && data.choices[0] && data.choices[0].message) {
              resolve(data.choices[0].message.content);
            } else {
              reject(new Error(data.error ? (data.error.message || JSON.stringify(data.error)) : 'OpenRouter error'));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    } else {
      // Gemini API
      const postData = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${key}`;
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.candidates && data.candidates[0] && data.candidates[0].content) {
              const part = data.candidates[0].content.parts[0];
              resolve(part.text || '');
            } else if (data.error) {
              reject(new Error(data.error.message || 'Gemini error'));
            } else {
              reject(new Error('Unexpected Gemini API response structure'));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    }
  });
}

function parseAISummaries(aiText, storyCount) {
  const summaries = [];
  for (let i = 1; i <= storyCount; i++) {
    const regex = new RegExp(`(?:${i}\\.|Story\\s*${i}[:.]?)([\\s\\S]*?)(?=(?:\\d+\\.|Story\\s*\\d+[:.]?)|$)`, 'i');
    const match = aiText.match(regex);
    if (match) {
      const block = match[1].trim();
      const happenedMatch = block.match(/(?:Happened|What happened):\s*(.*)/i);
      const meansMatch = block.match(/(?:Means|What it means|What it means for my clients):\s*(.*)/i);
      
      let happened = happenedMatch ? happenedMatch[1].trim() : '';
      let means = meansMatch ? meansMatch[1].trim() : '';

      if (!happened && !means) {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        happened = lines[0] || '';
        means = lines[1] || '';
      }
      summaries.push({ happened, means });
    } else {
      summaries.push({ happened: '', means: '' });
    }
  }
  return summaries;
}

function generateHtml(stories, summaries, notice, generatedAt) {
  const storyCards = stories.map((s, idx) => {
    const summary = summaries[idx] || {};
    const hasSummary = summary.happened || summary.means;
    return `
      <article class="story-card">
        <div class="story-num">0${idx + 1}</div>
        <div class="story-content">
          <div class="story-meta">
            <span class="source-tag">${escapeHtml(s.source)}</span>
            <span class="pub-date">${escapeHtml(s.pubDate)}</span>
          </div>
          <h2 class="story-title"><a href="${escapeHtml(s.link)}" target="_blank" rel="noopener">${escapeHtml(s.headline)}</a></h2>
          ${hasSummary ? `
            <div class="summary-box">
              <p class="summary-line"><strong class="label">What happened:</strong> ${escapeHtml(summary.happened)}</p>
              <p class="summary-line"><strong class="label">What it means for your cafe:</strong> ${escapeHtml(summary.means)}</p>
            </div>
          ` : ''}
        </div>
      </article>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Cafe & Dining Intelligence — India Edition</title>
  <style>
    :root {
      --bg: #0f1117;
      --card-bg: #181b24;
      --accent: #ff6b35;
      --accent-soft: rgba(255, 107, 53, 0.12);
      --text: #f0f2f5;
      --text-muted: #9aa1b0;
      --border: #262b38;
      --card-border: #232733;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 40px 20px 80px 20px;
    }
    .container {
      max-width: 840px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 36px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }
    .badge {
      display: inline-block;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 4px 10px;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      border-radius: 4px;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 2.2rem;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 8px;
      color: #ffffff;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 1rem;
    }
    .notice-banner {
      background: #382414;
      border: 1px solid #7c441c;
      color: #ffc996;
      padding: 14px 18px;
      border-radius: 8px;
      margin-bottom: 30px;
      font-size: 0.95rem;
    }
    .story-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      display: flex;
      gap: 20px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    }
    .story-num {
      font-size: 1.8rem;
      font-weight: 800;
      color: var(--accent);
      opacity: 0.8;
      line-height: 1;
      padding-top: 4px;
    }
    .story-content { flex: 1; }
    .story-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 0.85rem;
    }
    .source-tag {
      background: #232938;
      color: #79a2ff;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .pub-date { color: var(--text-muted); }
    .story-title {
      font-size: 1.3rem;
      font-weight: 700;
      margin-bottom: 14px;
      line-height: 1.35;
    }
    .story-title a {
      color: #ffffff;
      text-decoration: none;
      transition: color 0.15s ease;
    }
    .story-title a:hover {
      color: var(--accent);
    }
    .summary-box {
      background: #11131a;
      border-left: 3px solid var(--accent);
      border-radius: 0 8px 8px 0;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .summary-line {
      font-size: 0.95rem;
      color: #d8dce6;
    }
    .label {
      color: #ff9b71;
      font-weight: 600;
    }
    footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="badge">Daily Intelligence</div>
      <h1>Cafe & Food Industry Digest</h1>
      <p class="subtitle">Focus: Indian cafe & restaurant market, visual food content, Swiggy, Zomato & Instagram &bull; ${escapeHtml(generatedAt)}</p>
    </header>

    ${notice ? `<div class="notice-banner"><strong>Notice:</strong> ${escapeHtml(notice)}</div>` : ''}

    <main>
      ${storyCards}
    </main>

    <footer>
      Generated automatically by CafeNewsDigest agent &bull; Open in browser active
    </footer>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openInBrowser(filePath) {
  if (!AUTO_OPEN_BROWSER) return;
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWindows) {
    exec(`start "" "${filePath}"`);
  } else if (isMac) {
    exec(`open "${filePath}"`);
  } else {
    exec(`xdg-open "${filePath}"`);
  }
}

async function sendDigestEmail(composioKey, htmlContent, dateStr) {
  // Step A: Fetch connected accounts to find active Gmail account and its user_id
  const accountsRes = await fetch('https://backend.composio.dev/api/v3/connected_accounts', {
    headers: { 'x-api-key': composioKey }
  });

  if (!accountsRes.ok) {
    const errorText = await accountsRes.text();
    console.error(`Failed to fetch connected accounts from Composio (status ${accountsRes.status}): ${errorText}`);
    return;
  }

  const accountsData = await accountsRes.json();
  const items = accountsData.items || [];
  const activeGmail = items.find(acc => {
    const isGmail = (acc.toolkit && acc.toolkit.slug === 'gmail') ||
                    (acc.appUniqueId && acc.appUniqueId.toLowerCase().includes('gmail')) ||
                    (acc.id && acc.id.toLowerCase().includes('gmail'));
    const isActive = acc.status === 'ACTIVE' || (acc.data && acc.data.status === 'ACTIVE');
    return isGmail && isActive;
  });

  if (!activeGmail || !activeGmail.user_id) {
    console.log('Connect Gmail in Composio');
    return;
  }

  const userId = activeGmail.user_id;

  // Step B: Post to execute GMAIL_SEND_EMAIL
  const subject = `Cafe & Dining News Digest (India) — ${dateStr}`;
  const payload = {
    user_id: userId,
    version: 'latest',
    arguments: {
      recipient_email: RECIPIENT_EMAIL,
      subject: subject,
      body: htmlContent,
      is_html: true
    }
  };

  const sendRes = await fetch('https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL', {
    method: 'POST',
    headers: {
      'x-api-key': composioKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const sendData = await sendRes.json();
  if (sendData && sendData.successful === true) {
    console.log(`Email successfully sent to ${RECIPIENT_EMAIL} via Composio.`);
  } else {
    console.log(sendData && sendData.error ? sendData.error : JSON.stringify(sendData));
  }
}

async function main() {
  console.log('--------------------------------------------------');
  console.log('Cafe News Digest Agent starting...');
  console.log(`Current Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log(`Configured Model: ${MODEL_NAME}`);
  console.log(`Auto-open browser: ${AUTO_OPEN_BROWSER}`);
  console.log('--------------------------------------------------');

  // Step 1: Read key if available
  let apiKey = '';
  if (fs.existsSync(KEY_FILE)) {
    apiKey = fs.readFileSync(KEY_FILE, 'utf8').trim();
  }

  // Step 2: Fetch RSS Feed
  console.log(`Fetching latest stories from Google News (India)...`);
  let stories = [];
  try {
    const rssXml = await fetchText(RSS_URL);
    stories = parseRss(rssXml);
    console.log(`Found and parsed ${stories.length} top unique stories.`);
  } catch (err) {
    console.error(`Failed to fetch RSS: ${err.message}`);
  }

  if (stories.length === 0) {
    console.log('No stories retrieved. Exiting.');
    return;
  }

  // Step 3: Summarize via AI
  let summaries = [];
  let notice = '';

  if (!apiKey) {
    notice = 'Summaries are missing because key.txt was not found. Please place your API key in key.txt to generate AI summaries.';
    console.log(`[WARN] ${notice}`);
  } else {
    try {
      console.log(`Sending top ${stories.length} stories to AI model (${MODEL_NAME})...`);
      const aiResponse = await callAI(apiKey, stories);
      summaries = parseAISummaries(aiResponse, stories.length);
      console.log('AI summaries generated successfully.');
    } catch (err) {
      notice = `Summaries are missing because the AI request failed: ${err.message}`;
      console.log(`[WARN] ${notice}`);
    }
  }

  // Step 4: Write digest.html
  const nowStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const htmlContent = generateHtml(stories, summaries, notice, nowStr);
  fs.writeFileSync(DIGEST_FILE, htmlContent, 'utf8');
  console.log(`\nDigest saved to: ${DIGEST_FILE}`);

  // Step 5: Print digest in terminal
  console.log('\n==================================================');
  console.log(`DAILY CAFE & FOOD DIGEST (INDIA) — ${nowStr}`);
  console.log('==================================================\n');
  if (notice) {
    console.log(`[NOTICE]: ${notice}\n`);
  }

  stories.forEach((s, i) => {
    const sum = summaries[i] || {};
    console.log(`${i + 1}. ${s.headline}`);
    console.log(`   Source: ${s.source} | Date: ${s.pubDate}`);
    console.log(`   Link: ${s.link}`);
    if (sum.happened) {
      console.log(`   What happened: ${sum.happened}`);
    }
    if (sum.means) {
      console.log(`   What it means for your cafe: ${sum.means}`);
    }
    console.log('');
  });
  console.log('==================================================\n');

  // Step 6: Email digest via Composio
  if (fs.existsSync(COMPOSIO_KEY_FILE)) {
    const composioKey = fs.readFileSync(COMPOSIO_KEY_FILE, 'utf8').trim();
    if (composioKey) {
      console.log('Sending digest via email with Composio...');
      try {
        await sendDigestEmail(composioKey, htmlContent, nowStr);
      } catch (err) {
        console.error('Email sending error:', err.message);
      }
    } else {
      console.log('Email delivery is off: composio-key.txt is empty.');
    }
  } else {
    console.log('Email delivery is off: composio-key.txt is missing.');
  }

  // Step 7: Open in default browser
  console.log('Opening digest in default browser...');
  openInBrowser(DIGEST_FILE);
}

main().catch(err => {
  console.error('Fatal error in agent run:', err);
});
