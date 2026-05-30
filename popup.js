const DEFAULT_SETTINGS = {
  autoDownload: true,
  copyToClipboard: false,
  downloadSubfolder: 'AnimeScreenshots',
  pageShortcut: 'Shift+C',
  outputResolution: 'original'
};

const captureButton = document.getElementById('captureButton');
const autoDownloadInput = document.getElementById('autoDownload');
const copyToClipboardInput = document.getElementById('copyToClipboard');
const settingsButton = document.getElementById('settingsButton');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettingsButton = document.getElementById('closeSettingsButton');
const downloadSubfolderInput = document.getElementById('downloadSubfolder');
const clearFolderButton = document.getElementById('clearFolderButton');
const recordShortcutButton = document.getElementById('recordShortcutButton');
const shortcutDisplay = document.getElementById('shortcutDisplay');
const outputResolutionInput = document.getElementById('outputResolution');
const settingsMessage = document.getElementById('settingsMessage');
const statusText = document.getElementById('statusText');
const popupNotice = document.getElementById('popupNotice');
let currentShortcut = DEFAULT_SETTINGS.pageShortcut;
let isRecordingShortcut = false;

initPopup();

async function initPopup() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const status = await chrome.storage.local.get({
    lastStatusText: '尚未截圖'
  });

  autoDownloadInput.checked = settings.autoDownload;
  copyToClipboardInput.checked = settings.copyToClipboard;
  downloadSubfolderInput.value = normalizeDownloadSubfolder(settings.downloadSubfolder);
  currentShortcut = settings.pageShortcut;
  shortcutDisplay.textContent = currentShortcut;
  outputResolutionInput.value = normalizeStoredResolution(settings.outputResolution);
  statusText.textContent = status.lastStatusText;

  autoDownloadInput.addEventListener('change', saveQuickSettings);
  copyToClipboardInput.addEventListener('change', saveQuickSettings);
  captureButton.addEventListener('click', captureScreenshot);
  settingsButton.addEventListener('click', toggleSettingsPanel);
  closeSettingsButton.addEventListener('click', closeSettingsPanel);
  downloadSubfolderInput.addEventListener('change', saveDownloadSubfolder);
  downloadSubfolderInput.addEventListener('blur', saveDownloadSubfolder);
  clearFolderButton.addEventListener('click', clearDownloadSubfolder);
  recordShortcutButton.addEventListener('click', startShortcutRecording);
  outputResolutionInput.addEventListener('change', saveResolution);
}

async function saveQuickSettings() {
  await chrome.storage.sync.set({
    autoDownload: autoDownloadInput.checked,
    copyToClipboard: copyToClipboardInput.checked
  });
}

function toggleSettingsPanel() {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsMessage.textContent = '';
}

function closeSettingsPanel() {
  settingsPanel.hidden = true;
  settingsMessage.textContent = '';
}

async function saveDownloadSubfolder() {
  const value = normalizeDownloadSubfolder(downloadSubfolderInput.value);
  downloadSubfolderInput.value = value;

  await chrome.storage.sync.set({
    downloadSubfolder: value
  });

  showSettingsMessage(value ? `會存到 Downloads\\${value}` : '會直接存到 Downloads');
}

async function clearDownloadSubfolder() {
  downloadSubfolderInput.value = '';
  await saveDownloadSubfolder();
}

function startShortcutRecording() {
  if (isRecordingShortcut) {
    return;
  }

  isRecordingShortcut = true;
  shortcutDisplay.textContent = '錄製中...';
  recordShortcutButton.classList.add('is-recording');
  showSettingsMessage('請按下新的快捷鍵，按 Esc 取消');
  window.addEventListener('keydown', recordShortcut, true);
}

async function recordShortcut(event) {
  if (!isRecordingShortcut) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    stopShortcutRecording();
    shortcutDisplay.textContent = currentShortcut;
    showSettingsMessage('已取消錄製');
    return;
  }

  const shortcut = shortcutFromKeyboardEvent(event);

  if (!shortcut) {
    showSettingsMessage('請至少包含 Shift、Ctrl、Alt 或 Meta 其中一個。');
    return;
  }

  currentShortcut = shortcut;
  shortcutDisplay.textContent = shortcut;
  stopShortcutRecording();

  await chrome.storage.sync.set({
    pageShortcut: shortcut
  });
  await updateAnimePagesShortcut(shortcut);
  showSettingsMessage('快捷鍵已儲存');
}

function stopShortcutRecording() {
  isRecordingShortcut = false;
  recordShortcutButton.classList.remove('is-recording');
  window.removeEventListener('keydown', recordShortcut, true);
}

async function saveResolution() {
  await chrome.storage.sync.set({
    outputResolution: outputResolutionInput.value
  });
  showSettingsMessage('解析度已儲存');
}

async function captureScreenshot() {
  captureButton.disabled = true;
  statusText.textContent = '截圖中...';

  try {
    await saveDownloadSubfolder();

    const result = await chrome.runtime.sendMessage({
      type: 'CAPTURE_SCREENSHOT'
    });

    if (!result?.ok) {
      const message = result?.message || '截圖失敗';
      statusText.textContent = message;
      showPopupNotice(message, 'error');
      return;
    }

    const finalStatus = buildFinalStatus(result);

    await chrome.storage.local.set({
      lastStatusText: finalStatus,
      lastStatusAt: Date.now()
    });

    showPopupNotice(finalStatus, result.downloadError ? 'error' : 'success');
    statusText.textContent = finalStatus;
  } catch (error) {
    console.error(error);
    statusText.textContent = '截圖失敗';
    showPopupNotice('截圖失敗', 'error');
  } finally {
    captureButton.disabled = false;
  }
}

function buildFinalStatus(result) {
  if (result.clipboardError) {
    return `${result.statusText}，但複製失敗`;
  }

  if (result.downloadError) {
    return `${result.statusText}，但下載失敗`;
  }

  if (result.filename?.includes('/')) {
    return `${result.statusText}，已存到 ${result.filename.split('/')[0]}`;
  }

  return result.statusText;
}

function showPopupNotice(text, tone = 'success') {
  popupNotice.textContent = text;
  popupNotice.dataset.tone = tone;
  popupNotice.hidden = false;

  window.setTimeout(() => {
    popupNotice.hidden = true;
  }, 2600);
}

function showSettingsMessage(text) {
  settingsMessage.textContent = text;
}

async function updateAnimePagesShortcut(shortcut) {
  try {
    const tabs = await chrome.tabs.query({
      url: 'https://ani.gamer.com.tw/*'
    });

    for (const tab of tabs) {
      if (!tab.id) {
        continue;
      }

      chrome.tabs.sendMessage(tab.id, {
        type: 'SET_PAGE_SHORTCUT',
        shortcut
      }).catch(() => {});
    }
  } catch (error) {
    // 舊頁面重新整理後會讀取新設定。
  }
}

function shortcutFromKeyboardEvent(event) {
  const modifiers = [];
  const key = keyboardEventKey(event);

  if (event.ctrlKey) {
    modifiers.push('Ctrl');
  }

  if (event.shiftKey) {
    modifiers.push('Shift');
  }

  if (event.altKey) {
    modifiers.push('Alt');
  }

  if (event.metaKey) {
    modifiers.push('Meta');
  }

  if (!key || modifiers.length === 0) {
    return '';
  }

  return `${modifiers.join('+')}+${key}`;
}

function keyboardEventKey(event) {
  if (event.code?.startsWith('Key')) {
    return event.code.slice(3).toUpperCase();
  }

  if (event.code?.startsWith('Digit')) {
    return event.code.slice(5);
  }

  if (/^F([1-9]|1[0-2])$/.test(event.code)) {
    return event.code;
  }

  return '';
}

function normalizeDownloadSubfolder(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\.\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeStoredResolution(value) {
  if (['720p', '1080p', '1440p', 'original'].includes(value)) {
    return value;
  }

  if (value === '854' || value === '1280') {
    return '720p';
  }

  if (value === '1920') {
    return '1080p';
  }

  return 'original';
}
