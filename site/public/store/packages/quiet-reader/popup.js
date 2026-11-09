const $ = sel => document.querySelector(sel);
const toggle = $('#toggle');
const state = $('#state');
const hint = $('#hint');

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function fail(message) {
  state.textContent = 'Unavailable';
  hint.textContent = message;
  toggle.disabled = true;
}

toggle.addEventListener('click', async () => {
  const tab = await activeTab();
  // Never inject into a privileged or non-web page.
  if (!tab || tab.id == null || !/^https?:\/\//i.test(tab.url || '')) {
    fail('Open a web page first, then start the reader from there.');
    return;
  }
  toggle.disabled = true;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['reader.js']
    });
    const outcome = result && result.result;
    if (outcome === 'opened') {
      state.textContent = 'Reading';
      hint.textContent = 'Quiet Reader is open on the page. Click again to close it.';
      toggle.textContent = 'Close reader';
    } else {
      state.textContent = 'Ready';
      hint.textContent = 'Turn the current article into a calm reading surface.';
      toggle.textContent = 'Open reader';
    }
  } catch (error) {
    fail('Flowr could not read this page. Some pages block extensions.');
  } finally {
    toggle.disabled = false;
  }
});