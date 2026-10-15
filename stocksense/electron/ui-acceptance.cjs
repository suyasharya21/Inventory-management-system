const { existsSync, readFileSync, writeFileSync } = require('node:fs');

const port = Number(process.env.STOCKSENSE_CDP_PORT || 9223);
const baseUrl = `http://127.0.0.1:${port}`;
const actions = [];
const speechWavPath = process.env.STOCKSENSE_SPEECH_WAV;
const speechWavBase64 = speechWavPath && existsSync(speechWavPath) ? readFileSync(speechWavPath).toString('base64') : '';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function connect() {
  let target;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const targets = await fetch(`${baseUrl}/json/list`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page' && (item.url.includes('127.0.0.1:5173') || item.url.startsWith('file:')));
      if (target) break;
    } catch {}
    await delay(250);
  }
  if (!target) throw new Error('Could not find the StockSense Electron page.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, send };
}

async function main() {
  const client = await connect();
  const { send } = client;
  await send('Runtime.enable');
  await send('Page.enable');

  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const waitFor = async (expression, message, timeout = 10000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(message);
  };
  const step = async (name, action) => { await action(); actions.push(name); };
  const clickText = (text) => evaluate(`window.__qa.clickText(${JSON.stringify(text)})`);
  const clickNav = (text) => evaluate(`window.__qa.clickNav(${JSON.stringify(text)})`);
  const clickTitle = (title) => evaluate(`window.__qa.clickTitle(${JSON.stringify(title)})`);
  const setLabel = (label, value) => evaluate(`window.__qa.setLabel(${JSON.stringify(label)}, ${JSON.stringify(String(value))})`);
  const setSelector = (selector, value) => evaluate(`window.__qa.setSelector(${JSON.stringify(selector)}, ${JSON.stringify(String(value))})`);
  const hasText = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;

  if (process.env.STOCKSENSE_CDP_EVAL) {
    console.log(JSON.stringify(await evaluate(process.env.STOCKSENSE_CDP_EVAL), null, 2));
    client.socket.close();
    return;
  }

  await waitFor("document.body.innerText.includes('Create your StockSense account')", 'First-run account setup did not appear.');
  await evaluate(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__qa = {
      clickText(text) { const buttons = [...document.querySelectorAll('button')]; const element = buttons.find((item) => normalize(item.innerText) === text) || buttons.find((item) => normalize(item.querySelector('.stat-label')?.textContent) === text); if (!element) return false; element.click(); return true; },
      clickNav(text) { const element = [...document.querySelectorAll('.nav-item')].find((item) => normalize(item.innerText) === text); if (!element) return false; element.click(); return true; },
      clickTitle(title) { const element = [...document.querySelectorAll('[title]')].find((item) => item.getAttribute('title') === title); if (!element) return false; element.click(); return true; },
      setLabel(label, value) { const field = [...document.querySelectorAll('label.field')].find((item) => normalize(item.querySelector('.field-label')?.textContent) === label); const element = field?.querySelector('input, textarea, select'); if (!element) return false; setValue(element, value); return true; },
      setSelector(selector, value) { const element = document.querySelector(selector); if (!element) return false; setValue(element, value); return true; },
      value(label) { const field = [...document.querySelectorAll('label.field')].find((item) => normalize(item.querySelector('.field-label')?.textContent) === label); return field?.querySelector('input, textarea, select')?.value ?? null; },
      buttonState(title) { const element = [...document.querySelectorAll('[title]')].find((item) => item.getAttribute('title') === title); return element ? { exists: true, disabled: element.disabled } : { exists: false, disabled: false }; },
    };
    return true;
  })()`);

  try {
    await step('Google sign-in is visibly unavailable', async () => {
      const googleButton = await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((item) => item.innerText.includes('Google sign-in'));
        return button ? { exists: true, disabled: button.disabled, text: button.innerText.trim() } : { exists: false };
      })()`);
      expect(googleButton.exists && googleButton.disabled, 'Google sign-in is not disabled.');
      expect(googleButton.text.includes('Coming soon'), 'Google sign-in does not explain that it is coming soon.');
    });

    await step('first-run account and business onboarding', async () => {
      expect(await setLabel('Your name', 'UI Owner'), 'Name field was not found.');
      expect(await setLabel('Email address', 'ui-owner@example.test'), 'Email field was not found.');
      expect(await setLabel('Password', 'secure-pass-123'), 'Password field was not found.');
      expect(await clickText('Create account and continue'), 'Create account button was not found.');
      await waitFor(hasText('Tell us about your business'), 'Business setup did not appear.');
      expect(await setLabel('Business name', 'UI Acceptance Store'), 'Business name field was not found.');
      expect(await clickText('Finish setup'), 'Finish setup button was not found.');
      await waitFor(hasText('Current business status'), 'Overview did not appear after onboarding.');
    });

    await step('empty inventory and product creation', async () => {
      expect(await clickNav('Inventory'), 'Inventory navigation was not found.');
      await waitFor(hasText('Products and stock'), 'Inventory did not open.');
      expect(await clickText('New product'), 'New product button was not found.');
      expect(await setLabel('Product name', 'Coca-Cola 500ml'), 'Product name field was not found.');
      expect(await setLabel('Product code (SKU)', 'COKE-500'), 'Product code field was not found.');
      expect(await setLabel('Category', 'Beverages'), 'Category field was not found.');
      expect(await setLabel('Opening quantity', 20), 'Opening quantity field was not found.');
      expect(await setLabel('Selling price per item', 100), 'Selling price field was not found.');
      expect(await setLabel('Cost price per item', 60), 'Cost price field was not found.');
      expect(await setLabel('Low-stock reminder quantity', 5), 'Low-stock reminder field was not found.');
      expect(await setLabel('Minimum sales expected in 30 days', 10), 'Aging sales target field was not found.');
      expect(await clickText('Create product'), 'Create product button was not found.');
      await waitFor(hasText('Product created with opening stock'), 'Product creation did not complete.');
      expect(await evaluate("document.body.innerText.includes('Coca-Cola 500ml')"), 'Created product is missing from inventory.');
    });

    await step('duplicate warning and existing-product route', async () => {
      await clickText('New product');
      await setLabel('Product name', 'Coca Cola 500 ml');
      await setLabel('Category', 'Beverages');
      await setLabel('Opening quantity', 1);
      await setLabel('Selling price per item', 100);
      await setLabel('Cost price per item', 60);
      await setLabel('Minimum sales expected in 30 days', 10);
      await clickText('Create product');
      await waitFor(hasText('Potential duplicates found'), 'Duplicate warning did not appear.');
      await clickText('Use existing');
      await waitFor(hasText('Price and cost history'), 'Use existing did not open the matching product.');
      await clickTitle('Close');
    });

    await step('discounted sale with live totals', async () => {
      expect(await clickTitle('Record sale'), 'Record sale action was not found.');
      await setLabel('Quantity', 2);
      await setLabel('Discount %', 10);
      expect(await evaluate("window.__qa.value('Selling price per item').includes('100')"), 'Standard selling price is incorrect.');
      expect(await evaluate("window.__qa.value('Total before discount').includes('200')"), 'Total before discount is incorrect.');
      expect(Number(await evaluate("window.__qa.value('Price per item after discount')")) === 90, 'Final unit price did not update to 90.');
      expect(await evaluate("window.__qa.value('Total after discount').includes('180')"), 'Total after discount is incorrect.');
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync('/tmp/stocksense-sale-discount.png', Buffer.from(screenshot.data, 'base64'));
      await clickText('Confirm sale');
      await waitFor(hasText('Sale recorded'), 'Discounted sale did not save.');
    });

    await step('cost update and current-price feedback', async () => {
      await clickTitle('Update prices');
      await setLabel('Cost price', 70);
      await setLabel('Change reason', 'Supplier cost changed');
      await clickText('Update prices');
      await waitFor(hasText('Prices updated.'), 'Cost update did not save.');
    });

    await step('archive and restore product', async () => {
      await evaluate('window.confirm = () => true');
      await clickTitle('Archive product');
      await waitFor(hasText('moved to Archived products'), 'Archive action did not complete.');
      await clickText('Archived products');
      await waitFor("window.__qa.buttonState('Restore product').exists", 'Archived product was not listed with a restore action.');
      expect(await clickTitle('Restore product'), 'Restore product action was not found.');
      await waitFor(hasText('restored to active products'), 'Restore action did not complete.');
      await clickText('Active products');
      await waitFor("window.__qa.buttonState('Record sale').exists", 'Restored product did not return to active inventory.');
    });

    let voiceTyping;
    await step('Quick Add spoken-style damage flow and guidance controls', async () => {
      await clickNav('Quick Add');
      await waitFor(hasText('Tell StockSense what happened'), 'Quick Add did not open.');
      await waitFor("window.__qa.buttonState('Start voice typing').exists && !window.__qa.buttonState('Start voice typing').disabled", 'Voice typing did not become available.');
      voiceTyping = await evaluate("window.__qa.buttonState('Start voice typing')");
      expect(voiceTyping.exists && !voiceTyping.disabled, 'Voice typing control is missing or disabled in Quick Add.');
      if (speechWavBase64) {
        const speechResult = await evaluate(`(() => {
          const bytes = Uint8Array.from(atob(${JSON.stringify(speechWavBase64)}), (character) => character.charCodeAt(0));
          return window.appApi.speech.transcribe({ audio: bytes.buffer, language: 'en', prompt: '' })
            .then(async (result) => ({ result, parsed: await window.appApi.smartEntry.parse(result.transcript) }));
        })()`);
        expect(/damage/i.test(speechResult.result.transcript), `Speech engine returned an unexpected transcript: ${speechResult.result.transcript}`);
        expect(speechResult.parsed.intent === 'damage' && speechResult.parsed.extracted.quantity === 2, `Spoken damage command was not parsed safely: ${JSON.stringify(speechResult)}`);
      }
      await setSelector('.composer-form textarea', 'damaged 2 Coca-Cola bottles');
      await clickText('Understand command');
      await waitFor(hasText('Damaged Stock'), 'Damage command was not understood.');
      expect(Number(await evaluate("window.__qa.value('Quantity')")) === 2, 'Parsed damage quantity is incorrect.');
      await clickText('Confirm action');
      await waitFor(hasText('The action was saved'), 'Parsed damage action did not save.');
    });

    let askVoiceTyping;
    await step('Ask Your Data product-sales question', async () => {
      await clickNav('Ask Your Data');
      await waitFor(hasText('Ask about your business'), 'Ask Your Data did not open.');
      askVoiceTyping = await evaluate("window.__qa.buttonState('Start voice typing')");
      expect(askVoiceTyping.exists, 'Voice typing control is missing from Ask Your Data.');
      await setSelector('.nlp-composer textarea', 'how many coca cola sold in last 1 week?');
      await clickText('Ask');
      await waitFor(hasText('2 unit(s) of Coca-Cola 500ml'), 'Coca-Cola sales question was not answered correctly.');
      expect(await evaluate("document.body.innerText.includes('Discounts given')"), 'Ask Your Data answer does not show discounts.');
    });

    await step('sales and current-stock report views', async () => {
      await clickText('Open matching records');
      await waitFor(hasText('Business reports'), 'Matching sales report did not open.');
      await waitFor("[...document.querySelectorAll('.report-title h2')].some((item) => item.textContent === 'Sales')", 'Sales report did not load.');
      expect(await evaluate("(() => { const labels = [...document.querySelectorAll('.data-table th')].map((item) => item.textContent); return labels.includes('Discount Amount') && labels.includes('Total After Discount'); })()"), 'Sales report is missing discount columns.');
      await evaluate("[...document.querySelectorAll('.report-catalog button')].find((item) => item.querySelector('strong')?.textContent === 'Current Stock and Prices')?.click()");
      await waitFor("[...document.querySelectorAll('.report-title h2')].some((item) => item.textContent === 'Current Stock and Prices')", 'Current stock report did not load.');
      expect(await evaluate("document.body.innerText.includes('70.00')"), 'Updated cost is not visible in the current stock report.');
    });

    await step('clickable overview action', async () => {
      await clickNav('Overview');
      await waitFor(hasText('Current business status'), 'Overview did not open.');
      await waitFor(hasText('Aging products (selling slowly)'), 'Aging products section did not appear.');
      expect(await evaluate("document.body.innerText.toLowerCase().includes('no sales in selected dates') || document.body.innerText.toLowerCase().includes('below expected sales')"), 'Aging product sales status is missing.');
      await evaluate("document.querySelector('.aging-products-panel')?.scrollIntoView({ block: 'center' })");
      const dashboardScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync('/tmp/stocksense-aging-dashboard.png', Buffer.from(dashboardScreenshot.data, 'base64'));
      expect(await clickText('Open aging report'), 'Aging report action was not found.');
      await waitFor("[...document.querySelectorAll('.report-title h2')].some((item) => item.textContent === 'Aging Products')", 'Aging Products report did not open.');
      expect(await evaluate("document.body.innerText.toLowerCase().includes('minimum expected sales in 30 days')"), 'Aging report is missing the saved product threshold.');
      const reportScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync('/tmp/stocksense-aging-report.png', Buffer.from(reportScreenshot.data, 'base64'));
      await clickNav('Overview');
      await waitFor(hasText('Current business status'), 'Overview did not reopen.');
      expect(await clickText('Sales after discounts'), 'Clickable sales summary was not found.');
      await waitFor(hasText('Business reports'), 'Sales summary did not open Reports.');
    });

    await step('forecast, unusual activity, change history, backup, and settings pages', async () => {
      await clickNav('Future Sales & Advice');
      await waitFor(hasText('Future sales and purchase advice'), 'Future sales page did not open.');
      await clickText('7 days');
      await waitFor(hasText('Next 7 days'), 'Seven-day estimate did not apply.');
      await clickNav('Unusual Activity');
      await waitFor(hasText('Unusual activity'), 'Unusual Activity did not open.');
      await clickText('Check now');
      await waitFor(hasText('Items to review'), 'Unusual activity check did not complete.');
      await clickNav('Change History');
      await waitFor(hasText('Protected history verified'), 'Change History verification did not pass.');
      await clickNav('Backups');
      await waitFor(hasText('Connect Google Drive'), 'Google Drive backup control is missing.');
      await clickNav('Settings');
      await waitFor(hasText('Business and app settings'), 'Settings did not open.');
      await setLabel('Tax ID', 'GST-UI-TEST');
      await clickText('Save settings');
      await waitFor(hasText('Business profile and branding saved'), 'Settings did not save.');
      expect(await clickText('Green'), 'Theme option was not found.');
      await clickText('Save settings');
    });

    await step('sign out and sign back in', async () => {
      await clickTitle('Sign out');
      await waitFor(hasText('Welcome back'), 'Sign-out did not return to sign-in.');
      await setLabel('Email address', 'ui-owner@example.test');
      await setLabel('Password', 'secure-pass-123');
      await evaluate("document.querySelector('.access-form button[type=submit]').click()");
      await waitFor(hasText('Current business status'), 'Sign-in did not reopen the business.');
    });

    const finalScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync('/tmp/stocksense-ui-final.png', Buffer.from(finalScreenshot.data, 'base64'));
    console.log(JSON.stringify({ actions, voiceTyping, askVoiceTyping, screenshots: ['/tmp/stocksense-sale-discount.png', '/tmp/stocksense-aging-dashboard.png', '/tmp/stocksense-aging-report.png', '/tmp/stocksense-ui-final.png'] }, null, 2));
  } catch (error) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync('/tmp/stocksense-ui-failure.png', Buffer.from(screenshot.data, 'base64'));
    throw error;
  } finally {
    client.socket.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
