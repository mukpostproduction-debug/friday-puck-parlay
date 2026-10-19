/**
 * Bet The Show - Autonomous UI Visual Inspection Engine
 * Drives native Google Chrome directly via puppeteer-core without external driver downloads.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = '/Users/jacksonmcmurdo/.gemini/antigravity-ide/brain/aed86c81-0b05-47b9-b499-7bca32d08bff';
const PORT = 8349;

// Lightweight static file server for local QA
function createStaticServer() {
  const root = path.resolve(__dirname, '..');
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.json': 'application/json'
  };

  const server = http.createServer((req, res) => {
    let filePath = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise(resolve => {
    server.listen(PORT, () => resolve(server));
  });
}

async function runQA() {
  console.log('🚀 Starting static test server on port', PORT);
  const server = await createStaticServer();

  console.log('🌐 Launching native Google Chrome from:', CHROME_PATH);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    const targetUrl = `http://localhost:${PORT}/index.html`;

    // 1. Desktop 1280x900
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    await page.goto(targetUrl, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));

    // Desktop Slip
    await page.screenshot({ path: path.join(OUT_DIR, 'qa_desktop_slip.png') });
    console.log('📸 Captured: qa_desktop_slip.png');

    // Desktop Live Tracker
    await page.click('#tabLiveTracker');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT_DIR, 'qa_desktop_live.png') });
    console.log('📸 Captured: qa_desktop_live.png');

    // Desktop Squad Stats
    await page.click('#tabStats');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT_DIR, 'qa_desktop_stats.png') });
    console.log('📸 Captured: qa_desktop_stats.png');

    // 2. iPhone 15 Pro (393x852 @ 2x)
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT_DIR, 'qa_mobile_stats.png') });
    console.log('📸 Captured: qa_mobile_stats.png');

    // Mobile Slip
    await page.click('#tabSlipBuilder');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT_DIR, 'qa_mobile_slip.png') });
    console.log('📸 Captured: qa_mobile_slip.png');

    console.log('✅ Visual QA Suite completed successfully!');
  } finally {
    await browser.close();
    server.close();
  }
}

runQA().catch(err => {
  console.error('❌ QA Suite Error:', err);
  process.exit(1);
});
