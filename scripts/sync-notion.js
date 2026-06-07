const https = require('https');
const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

function notionRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path,
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => resolve(JSON.parse(result)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function getText(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return prop.title.map(t => t.plain_text).join('');
  if (prop.type === 'rich_text') return prop.rich_text.map(t => t.plain_text).join('');
  if (prop.type === 'select') return prop.select?.name ?? '';
  return '';
}

async function fetchAllCards() {
  const cards = [];
  let cursor = undefined;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await notionRequest(`/v1/databases/${NOTION_DATABASE_ID}/query`, body);

    for (const page of res.results) {
      const p = page.properties;
      cards.push({
        category: getText(p['カテゴリ']),
        front: getText(p['表面']),
        back: getText(p['裏面']),
        english: getText(p['英語'])
      });
    }

    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return cards;
}

function buildDeck(cards) {
  const deck = { words: [], grammar: [], kanji: [] };
  for (const c of cards) {
    const cat = c.category;
    if (deck[cat]) {
      deck[cat].push({ front: c.front, back: c.back, english: c.english });
    }
  }
  return deck;
}

async function main() {
  console.log('Notionからカードデータを取得中...');
  const cards = await fetchAllCards();
  console.log(`${cards.length}件のカードを取得しました`);

  const deck = buildDeck(cards);
  console.log(`単語: ${deck.words.length}件, 文法: ${deck.grammar.length}件, 漢字: ${deck.kanji.length}件`);

  const deckJson = JSON.stringify(deck, null, 12)
    .replace(/"([^"]+)":/g, '$1:')  // キーのクォートを外す
    .split('\n').map((l, i) => i === 0 ? l : '        ' + l).join('\n');

  const html = fs.readFileSync('index.html', 'utf8');
  const updated = html.replace(
    /\/\/ NOTION_SYNC_START[\s\S]*?\/\/ NOTION_SYNC_END/,
    `// NOTION_SYNC_START\n        const deck = ${deckJson};\n        // NOTION_SYNC_END`
  );

  if (html === updated) {
    console.error('エラー: index.html に同期マーカーが見つかりません');
    process.exit(1);
  }

  fs.writeFileSync('index.html', updated, 'utf8');
  console.log('index.html を更新しました');
}

main().catch(e => { console.error(e); process.exit(1); });
