const DEFAULT_SETTINGS = {
  autoDownload: true,
  copyToClipboard: false,
  downloadSubfolder: 'AnimeScreenshots',
  organizeByAnimeName: true,
  pageShortcut: 'Shift+C',
  gifShortcut: 'Shift+G',
  outputResolution: 'original',
  gifDurationSeconds: 5,
  gifResolution: '720p',
  gifFps: 30
};
const MIN_GIF_SECONDS = 0.5;
const MAX_GIF_SECONDS = 10;

const captureButton = document.getElementById('captureButton');
const gifPanel = document.getElementById('gifPanel');
const autoDownloadInput = document.getElementById('autoDownload');
const copyToClipboardInput = document.getElementById('copyToClipboard');
const settingsButton = document.getElementById('settingsButton');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettingsButton = document.getElementById('closeSettingsButton');
const downloadSubfolderInput = document.getElementById('downloadSubfolder');
const clearFolderButton = document.getElementById('clearFolderButton');
const organizeByAnimeNameInput = document.getElementById('organizeByAnimeName');
const recordShortcutButton = document.getElementById('recordShortcutButton');
const shortcutDisplay = document.getElementById('shortcutDisplay');
const recordGifShortcutButton = document.getElementById('recordGifShortcutButton');
const gifShortcutDisplay = document.getElementById('gifShortcutDisplay');
const outputResolutionInput = document.getElementById('outputResolution');
const gifStartTimeInput = document.getElementById('gifStartTime');
const gifEndTimeInput = document.getElementById('gifEndTime');
const gifClipSecondsInput = document.getElementById('gifClipSeconds');
const gifDurationValue = document.getElementById('gifDurationValue');
const gifVideoDurationValue = document.getElementById('gifVideoDurationValue');
const syncGifTimelineButton = document.getElementById('syncGifTimelineButton');
const gifResolutionInput = document.getElementById('gifResolution');
const gifFpsInput = document.getElementById('gifFps');
const createGifButton = document.getElementById('createGifButton');
const gifProgress = document.getElementById('gifProgress');
const settingsMessage = document.getElementById('settingsMessage');
const statusText = document.getElementById('statusText');
const popupNotice = document.getElementById('popupNotice');
let currentShortcut = DEFAULT_SETTINGS.pageShortcut;
let currentGifShortcut = DEFAULT_SETTINGS.gifShortcut;
let recordingShortcutType = '';
let activeGifProgressId = '';
let gifVideoInfo = {
  currentTime: 0,
  duration: 10
};

initPopup();
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

async function initPopup() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const status = await chrome.storage.local.get({
    lastStatusText: '尚未截圖'
  });

  autoDownloadInput.checked = settings.autoDownload;
  copyToClipboardInput.checked = settings.copyToClipboard;
  downloadSubfolderInput.value = normalizeDownloadSubfolder(settings.downloadSubfolder);
  organizeByAnimeNameInput.checked = settings.organizeByAnimeName;
  currentShortcut = settings.pageShortcut;
  currentGifShortcut = settings.gifShortcut;
  shortcutDisplay.textContent = currentShortcut;
  gifShortcutDisplay.textContent = currentGifShortcut;
  outputResolutionInput.value = normalizeStoredResolution(settings.outputResolution);
  gifResolutionInput.value = normalizeGifResolution(settings.gifResolution);
  gifFpsInput.value = normalizeGifFps(settings.gifFps);
  statusText.textContent = status.lastStatusText;
  await loadGifVideoTimeline(settings);

  autoDownloadInput.addEventListener('change', saveQuickSettings);
  copyToClipboardInput.addEventListener('change', saveQuickSettings);
  captureButton.addEventListener('click', captureScreenshot);
  settingsButton.addEventListener('click', toggleSettingsPanel);
  closeSettingsButton.addEventListener('click', closeSettingsPanel);
  downloadSubfolderInput.addEventListener('change', saveDownloadSubfolder);
  downloadSubfolderInput.addEventListener('blur', saveDownloadSubfolder);
  clearFolderButton.addEventListener('click', clearDownloadSubfolder);
  organizeByAnimeNameInput.addEventListener('change', saveOrganizeSetting);
  recordShortcutButton.addEventListener('click', () => startShortcutRecording('screenshot'));
  recordGifShortcutButton.addEventListener('click', () => startShortcutRecording('gif'));
  outputResolutionInput.addEventListener('change', saveResolution);
  gifStartTimeInput.addEventListener('change', () => updateGifTimeline('start'));
  gifEndTimeInput.addEventListener('change', () => updateGifTimeline('end'));
  gifClipSecondsInput.addEventListener('input', () => updateGifTimeline('seconds'));
  syncGifTimelineButton.addEventListener('click', syncGifTimelineToCurrentTime);
  gifResolutionInput.addEventListener('change', saveGifSettings);
  gifFpsInput.addEventListener('change', saveGifSettings);
  createGifButton.addEventListener('click', createGif);
  await focusGifPanelIfRequested();
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

async function saveOrganizeSetting() {
  await chrome.storage.sync.set({
    organizeByAnimeName: organizeByAnimeNameInput.checked
  });

  showSettingsMessage(
    organizeByAnimeNameInput.checked
      ? '會依動畫名稱建立資料夾'
      : '已關閉動畫名稱資料夾'
  );
}

function startShortcutRecording(type) {
  if (recordingShortcutType) {
    return;
  }

  recordingShortcutType = type;
  const display = type === 'gif' ? gifShortcutDisplay : shortcutDisplay;
  const button = type === 'gif' ? recordGifShortcutButton : recordShortcutButton;

  display.textContent = '錄製中...';
  button.classList.add('is-recording');
  showSettingsMessage('請按下新的快捷鍵，按 Esc 取消');
  window.addEventListener('keydown', recordShortcut, true);
}

async function recordShortcut(event) {
  if (!recordingShortcutType) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    stopShortcutRecording();
    shortcutDisplay.textContent = currentShortcut;
    gifShortcutDisplay.textContent = currentGifShortcut;
    showSettingsMessage('已取消錄製');
    return;
  }

  const shortcut = shortcutFromKeyboardEvent(event);

  if (!shortcut) {
    showSettingsMessage('請至少包含 Shift、Ctrl、Alt 或 Meta 其中一個。');
    return;
  }

  const type = recordingShortcutType;

  if (type === 'gif') {
    currentGifShortcut = shortcut;
    gifShortcutDisplay.textContent = shortcut;
    await chrome.storage.sync.set({
      gifShortcut: shortcut
    });
    await updateAnimePagesGifShortcut(shortcut);
  } else {
    currentShortcut = shortcut;
    shortcutDisplay.textContent = shortcut;
    await chrome.storage.sync.set({
      pageShortcut: shortcut
    });
    await updateAnimePagesShortcut(shortcut);
  }

  stopShortcutRecording();
  showSettingsMessage('快捷鍵已儲存');
}

function stopShortcutRecording() {
  recordingShortcutType = '';
  recordShortcutButton.classList.remove('is-recording');
  recordGifShortcutButton.classList.remove('is-recording');
  window.removeEventListener('keydown', recordShortcut, true);
}

async function saveResolution() {
  await chrome.storage.sync.set({
    outputResolution: outputResolutionInput.value
  });
  showSettingsMessage('解析度已儲存');
}

async function saveGifSettings() {
  const gifResolution = normalizeGifResolution(gifResolutionInput.value);
  const gifFps = normalizeGifFps(gifFpsInput.value);

  gifResolutionInput.value = gifResolution;
  gifFpsInput.value = gifFps;

  await chrome.storage.sync.set({
    gifResolution,
    gifFps
  });
  showSettingsMessage('GIF 設定已儲存');
}

async function loadGifVideoTimeline(settings) {
  const videoInfo = await getGifVideoInfo();
  const duration = normalizeTimelineDuration(videoInfo?.duration);
  const currentTime = normalizeTimelineTime(videoInfo?.currentTime, duration);
  const defaultLength = normalizeGifDuration(settings.gifDurationSeconds);
  const endTime = Math.min(currentTime + defaultLength, duration);
  const startTime = Math.max(0, endTime - defaultLength);

  gifVideoInfo = {
    currentTime,
    duration
  };
  setupGifTimelineRange(duration, startTime, endTime);
}

async function getGifVideoInfo() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_GIF_VIDEO_INFO'
    });

    return response?.ok ? response : null;
  } catch (error) {
    return null;
  }
}

function setupGifTimelineRange(duration, startTime, endTime) {
  gifStartTimeInput.value = formatTimelineTime(startTime);
  gifEndTimeInput.value = formatTimelineTime(endTime);
  gifClipSecondsInput.value = formatSecondsValue(endTime - startTime);
  updateGifTimeline();
}

function updateGifTimeline(changedField = '') {
  const duration = gifVideoInfo.duration;
  let startTime = parseTimelineTimeInput(gifStartTimeInput.value, gifVideoInfo.currentTime);
  let seconds = normalizeClipSeconds(gifClipSecondsInput.value);
  let endTime = parseTimelineTimeInput(gifEndTimeInput.value, startTime + seconds);

  startTime = normalizeTimelineTime(startTime, duration);

  if (changedField === 'seconds' || changedField === 'start') {
    endTime = startTime + seconds;
  } else {
    endTime = normalizeTimelineTime(endTime, duration);
    seconds = endTime - startTime;
  }

  if (seconds < MIN_GIF_SECONDS) {
    seconds = MIN_GIF_SECONDS;
    endTime = startTime + seconds;
  }

  if (seconds > MAX_GIF_SECONDS) {
    seconds = MAX_GIF_SECONDS;
    endTime = startTime + seconds;
  }

  if (endTime > duration) {
    endTime = duration;
    seconds = Math.max(MIN_GIF_SECONDS, endTime - startTime);
  }

  if (endTime <= startTime) {
    startTime = Math.max(0, endTime - seconds);
  }

  gifStartTimeInput.value = formatTimelineTime(startTime);
  gifEndTimeInput.value = formatTimelineTime(endTime);
  gifClipSecondsInput.value = formatSecondsValue(seconds);
  gifDurationValue.textContent = `長度 ${formatTimelineDuration(endTime - startTime)}`;
  gifVideoDurationValue.textContent = `影片 ${formatTimelineTime(duration)}`;
}

async function syncGifTimelineToCurrentTime() {
  const videoInfo = await getGifVideoInfo();

  if (videoInfo?.duration) {
    gifVideoInfo.duration = normalizeTimelineDuration(videoInfo.duration);
    gifVideoInfo.currentTime = normalizeTimelineTime(videoInfo.currentTime, gifVideoInfo.duration);
  }

  const startTime = gifVideoInfo.currentTime;
  const endTime = Math.min(startTime + 5, gifVideoInfo.duration);
  setupGifTimelineRange(gifVideoInfo.duration, startTime, endTime);
  showSettingsMessage('已同步到目前播放時間');
}

async function createGif() {
  updateGifTimeline();
  const startTime = parseTimelineTimeInput(gifStartTimeInput.value, 0);
  const endTime = parseTimelineTimeInput(gifEndTimeInput.value, startTime + normalizeClipSeconds(gifClipSecondsInput.value));
  const gifDurationSeconds = Math.max(MIN_GIF_SECONDS, endTime - startTime);
  const gifResolution = normalizeGifResolution(gifResolutionInput.value);
  const gifFps = normalizeGifFps(gifFpsInput.value);
  const progressId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const totalFrames = Math.ceil(Number(gifDurationSeconds) * Number(gifFps));

  activeGifProgressId = progressId;
  createGifButton.disabled = true;
  captureButton.disabled = true;
  statusText.textContent = 'GIF 製作中...';
  gifProgress.textContent = `擷取 GIF 影格中... 0/${totalFrames}`;

  try {
    await saveDownloadSubfolder();
    await saveGifSettings();

    const result = await chrome.runtime.sendMessage({
      type: 'CAPTURE_GIF',
      startTime,
      endTime,
      outputResolution: gifResolution,
      fps: Number(gifFps),
      progressId
    });

    if (!result?.ok) {
      const message = result?.message || 'GIF 製作失敗';
      statusText.textContent = message;
      gifProgress.textContent = message;
      showPopupNotice(message, 'error');
      return;
    }

    const finalStatus = buildFinalStatus(result);

    await chrome.storage.local.set({
      lastStatusText: finalStatus,
      lastStatusAt: Date.now()
    });

    statusText.textContent = finalStatus;
    gifProgress.textContent = finalStatus;
    showPopupNotice(finalStatus, result.downloadError ? 'error' : 'success');
  } catch (error) {
    console.error(error);
    statusText.textContent = 'GIF 製作失敗';
    gifProgress.textContent = 'GIF 製作失敗';
    showPopupNotice('GIF 製作失敗', 'error');
  } finally {
    activeGifProgressId = '';
    createGifButton.disabled = false;
    captureButton.disabled = false;
  }
}

function handleRuntimeMessage(message) {
  if (message?.type !== 'GIF_PROGRESS' || message.progressId !== activeGifProgressId) {
    return false;
  }

  if (message.text) {
    gifProgress.textContent = `${message.text} ${message.done}/${message.total}`;
  } else {
    gifProgress.textContent = `製作中 ${message.done}/${message.total}`;
  }
  return false;
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
    return `${result.statusText}，已存到 ${getDownloadFolderLabel(result.filename)}`;
  }

  return result.statusText;
}

function getDownloadFolderLabel(filename) {
  const parts = filename.split('/').filter(Boolean);
  parts.pop();
  return parts.join('\\') || 'Downloads';
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

async function updateAnimePagesGifShortcut(shortcut) {
  try {
    const tabs = await chrome.tabs.query({
      url: 'https://ani.gamer.com.tw/*'
    });

    for (const tab of tabs) {
      if (!tab.id) {
        continue;
      }

      chrome.tabs.sendMessage(tab.id, {
        type: 'SET_GIF_SHORTCUT',
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

function normalizeGifDuration(value) {
  return Math.min(Math.max(Math.round(Number(value) || DEFAULT_SETTINGS.gifDurationSeconds), 1), 10);
}

function normalizeGifResolution(value) {
  if (['720p', '1080p', '1440p'].includes(value)) {
    return value;
  }

  return DEFAULT_SETTINGS.gifResolution;
}

function normalizeGifFps(value) {
  const fps = Math.round(Number(value) || DEFAULT_SETTINGS.gifFps);

  if ([30, 50].includes(fps)) {
    return String(fps);
  }

  return String(DEFAULT_SETTINGS.gifFps);
}

function normalizeTimelineDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : 10;
}

function normalizeTimelineTime(value, duration) {
  const time = Number(value);
  return Math.min(Math.max(Number.isFinite(time) ? time : 0, 0), duration);
}

function normalizeClipSeconds(value) {
  const seconds = Number(value);
  return Math.min(Math.max(Number.isFinite(seconds) ? seconds : 5, MIN_GIF_SECONDS), MAX_GIF_SECONDS);
}

function formatSecondsValue(value) {
  const rounded = roundTimelineValue(value);
  return String(Number.isInteger(rounded) ? rounded : rounded.toFixed(1));
}

function parseTimelineTimeInput(value, fallback = 0) {
  const text = String(value || '').trim();

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }

  const parts = text
    .split(':')
    .map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) {
    return fallback;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return fallback;
}

function roundTimelineValue(value) {
  return Math.round(value * 10) / 10;
}

function formatTimelineDuration(seconds) {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)} 秒`;
}

function formatTimelineTime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${padTime(hours)}:${padTime(minutes)}:${padTime(secs)}`;
  }

  return `${padTime(minutes)}:${padTime(secs)}`;
}

function padTime(value) {
  return String(value).padStart(2, '0');
}

async function focusGifPanelIfRequested() {
  const request = await chrome.storage.local.get({
    openGifPanelRequestedAt: 0
  });

  if (!request.openGifPanelRequestedAt || Date.now() - request.openGifPanelRequestedAt > 15000) {
    return;
  }

  await chrome.storage.local.remove('openGifPanelRequestedAt');
  focusGifPanel();
}

function focusGifPanel() {
  gifPanel.scrollIntoView({
    block: 'start'
  });
  gifPanel.classList.add('is-highlighted');
  statusText.textContent = 'GIF 製作';

  window.setTimeout(() => {
    gifPanel.classList.remove('is-highlighted');
  }, 1400);
}
