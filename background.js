importScripts('gif-encoder.js');

const ANI_URL_PATTERN = /^https:\/\/ani\.gamer\.com\.tw\//;
const GIF_CAPTURE_INTERVAL_MS = 500;
const GIF_FRAMES_PER_SECOND = 2;
const DEFAULT_SETTINGS = {
  autoDownload: true,
  copyToClipboard: false,
  downloadSubfolder: 'AnimeScreenshots',
  organizeByAnimeName: true,
  pageShortcut: 'Shift+C',
  outputResolution: 'original',
  gifDurationSeconds: 5,
  gifResolution: '720p'
};

class FriendlyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FriendlyError';
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CAPTURE_SCREENSHOT') {
    captureActiveTab(sender.tab, {
      returnDataUrl: Boolean(message.returnDataUrl)
    })
      .then(sendResponse)
      .catch((error) => {
        console.error(error);
        sendResponse({
          ok: false,
          statusText: '截圖失敗',
          message: '截圖失敗，可能受到網站限制'
        });
      });

    return true;
  }

  if (message?.type === 'CAPTURE_GIF') {
    captureGif(sender.tab, {
      durationSeconds: message.durationSeconds,
      outputResolution: message.outputResolution,
      progressId: message.progressId
    })
      .then(sendResponse)
      .catch((error) => {
        console.error(error);
        sendResponse({
          ok: false,
          statusText: 'GIF 製作失敗',
          message: 'GIF 製作失敗，可能受到網站限制'
        });
      });

    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'capture-screenshot') {
    return;
  }

  captureActiveTab().catch((error) => {
    console.error(error);
  });
});

async function captureActiveTab(sourceTab, options = {}) {
  const tab = sourceTab?.id ? sourceTab : await getActiveTab();
  const settings = await getSettings();

  if (!tab?.id || !ANI_URL_PATTERN.test(tab.url || '')) {
    const result = {
      ok: false,
      statusText: '截圖失敗',
      message: '請先切換到動畫瘋播放頁面'
    };
    await saveLastStatus(result.statusText);
    return result;
  }

  try {
    const playerInfo = await getPlayerInfo(tab.id);
    const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    });
    const processed = await cropScreenshot(screenshotUrl, playerInfo, settings);

    if (processed.probablyBlack) {
      throw new FriendlyError('截圖失敗，可能受到網站限制');
    }

    const filename = buildFilename(playerInfo.title, settings);
    const actions = await runOutputActions(processed.dataUrl, filename, settings, {
      skipDownload: options.returnDataUrl
    });
    const statusText = processed.usedPlayer
      ? '截圖成功'
      : '找不到播放器，已截取可見畫面';

    if (!options.returnDataUrl) {
      const toastText = actions.downloadError ? '截圖成功，但下載失敗' : '截圖成功';
      await showPageToast(tab.id, toastText, actions.downloadError ? 'error' : 'success', filename);
    }

    await saveLastStatus(statusText);

    return {
      ok: true,
      statusText,
      filename,
      dataUrl: options.returnDataUrl ? processed.dataUrl : '',
      usedPlayer: processed.usedPlayer,
      downloaded: actions.downloaded,
      copied: actions.copied,
      clipboardError: actions.clipboardError,
      downloadError: actions.downloadError
    };
  } catch (error) {
    const message = error instanceof FriendlyError
      ? error.message
      : '截圖失敗，可能受到網站限制';

    await showPageToast(tab.id, '截圖失敗，可能受到網站限制', 'error');
    await saveLastStatus('截圖失敗');

    return {
      ok: false,
      statusText: '截圖失敗',
      message
    };
  }
}

async function captureGif(sourceTab, options = {}) {
  const tab = sourceTab?.id ? sourceTab : await getActiveTab();
  const settings = await getSettings();
  const durationSeconds = normalizeGifDurationSeconds(options.durationSeconds || settings.gifDurationSeconds);
  const outputResolution = normalizeGifResolution(options.outputResolution || settings.gifResolution);
  const frameCount = Math.max(1, durationSeconds * GIF_FRAMES_PER_SECOND);
  const progressId = options.progressId || '';

  if (!tab?.id || !ANI_URL_PATTERN.test(tab.url || '')) {
    const result = {
      ok: false,
      statusText: 'GIF 製作失敗',
      message: '請先切換到動畫瘋播放頁面'
    };
    await saveLastStatus(result.statusText);
    return result;
  }

  try {
    const playerInfo = await getPlayerInfo(tab.id);
    const frames = [];
    let targetSize = null;
    let usedPlayer = false;

    await sendGifProgress(progressId, 0, frameCount);

    for (let index = 0; index < frameCount; index += 1) {
      if (index > 0) {
        await delay(GIF_CAPTURE_INTERVAL_MS);
      }

      const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png'
      });
      const processed = await renderScreenshotCanvas(screenshotUrl, playerInfo, outputResolution);

      if (processed.probablyBlack) {
        throw new FriendlyError('GIF 製作失敗，可能受到網站限制');
      }

      if (!targetSize) {
        targetSize = {
          width: processed.canvas.width,
          height: processed.canvas.height
        };
      }

      frames.push({
        imageData: getCanvasImageData(processed.canvas, targetSize),
        delayCentiseconds: Math.round(100 / GIF_FRAMES_PER_SECOND)
      });
      usedPlayer = usedPlayer || processed.usedPlayer;

      await sendGifProgress(progressId, index + 1, frameCount);
    }

    const gifBytes = encodeGif(frames, {
      width: targetSize.width,
      height: targetSize.height,
      delayCentiseconds: Math.round(100 / GIF_FRAMES_PER_SECOND),
      loop: 0
    });
    const gifBlob = new Blob([gifBytes], {
      type: 'image/gif'
    });
    const filename = buildFilename(playerInfo.title, settings, 'gif');
    const dataUrl = await blobToDataUrl(gifBlob);
    let downloadError = '';

    try {
      await downloadWithChrome(dataUrl, filename);
    } catch (error) {
      downloadError = '下載失敗';
      console.warn(error);
    }

    const statusText = downloadError ? 'GIF 製作完成，但下載失敗' : 'GIF 製作完成';
    await showPageToast(tab.id, statusText, downloadError ? 'error' : 'success', filename);
    await saveLastStatus(statusText);

    return {
      ok: true,
      statusText,
      filename,
      frameCount,
      usedPlayer,
      downloaded: !downloadError,
      downloadError
    };
  } catch (error) {
    const message = error instanceof FriendlyError
      ? error.message
      : 'GIF 製作失敗，可能受到網站限制';

    await showPageToast(tab.id, 'GIF 製作失敗，可能受到網站限制', 'error');
    await saveLastStatus('GIF 製作失敗');

    return {
      ok: false,
      statusText: 'GIF 製作失敗',
      message
    };
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored
  };
}

async function saveLastStatus(statusText) {
  await chrome.storage.local.set({
    lastStatusText: statusText,
    lastStatusAt: Date.now()
  });
}

async function getPlayerInfo(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'GET_PLAYER_INFO'
    });

    return response || {};
  } catch (error) {
    return {};
  }
}

async function showPageToast(tabId, text, tone, detail = '') {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_CAPTURE_TOAST',
      text,
      tone,
      detail
    });
  } catch (error) {
    // Content script 不可用時不影響截圖結果。
  }
}

async function cropScreenshot(dataUrl, playerInfo, settings) {
  const processed = await renderScreenshotCanvas(dataUrl, playerInfo, settings.outputResolution);
  const outputBlob = await processed.canvas.convertToBlob({
    type: 'image/png'
  });

  return {
    dataUrl: await blobToDataUrl(outputBlob),
    usedPlayer: processed.usedPlayer,
    probablyBlack: processed.probablyBlack
  };
}

async function renderScreenshotCanvas(dataUrl, playerInfo, outputResolution) {
  const imageBlob = await dataUrlToBlob(dataUrl);
  const bitmap = await createImageBitmap(imageBlob);
  const rect = normalizeCropRect(playerInfo?.rect, playerInfo?.viewport, bitmap);
  const source = rect || {
    x: 0,
    y: 0,
    width: bitmap.width,
    height: bitmap.height
  };
  const canvas = new OffscreenCanvas(source.width, source.height);
  const context = canvas.getContext('2d', {
    willReadFrequently: true
  });

  context.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    source.width,
    source.height
  );

  const outputCanvas = resizeCanvas(canvas, outputResolution);
  const probablyBlack = Boolean(rect) && isCanvasProbablyBlack(outputCanvas);

  return {
    canvas: outputCanvas,
    usedPlayer: Boolean(rect),
    probablyBlack
  };
}

function getCanvasImageData(canvas, targetSize) {
  let outputCanvas = canvas;

  if (targetSize && (canvas.width !== targetSize.width || canvas.height !== targetSize.height)) {
    outputCanvas = resizeCanvasToDimensions(canvas, targetSize.width, targetSize.height);
  }

  const context = outputCanvas.getContext('2d', {
    willReadFrequently: true
  });

  return context.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
}

function resizeCanvasToDimensions(canvas, width, height) {
  const resizedCanvas = new OffscreenCanvas(width, height);
  const context = resizedCanvas.getContext('2d', {
    willReadFrequently: true
  });

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, width, height);

  return resizedCanvas;
}

function resizeCanvas(canvas, outputResolution) {
  const maxHeight = getMaxOutputHeight(outputResolution);

  if (!maxHeight || canvas.height <= maxHeight) {
    return canvas;
  }

  const targetHeight = Math.round(maxHeight);
  const targetWidth = Math.max(1, Math.round(canvas.width * (targetHeight / canvas.height)));
  const resizedCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = resizedCanvas.getContext('2d', {
    willReadFrequently: true
  });

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, targetWidth, targetHeight);

  return resizedCanvas;
}

function getMaxOutputHeight(outputResolution) {
  if (outputResolution === '720p' || outputResolution === '854' || outputResolution === '1280') {
    return 720;
  }

  if (outputResolution === '1080p' || outputResolution === '1920') {
    return 1080;
  }

  if (outputResolution === '1440p') {
    return 1440;
  }

  return 0;
}

function normalizeGifDurationSeconds(value) {
  return clamp(Math.round(Number(value) || DEFAULT_SETTINGS.gifDurationSeconds), 1, 10);
}

function normalizeGifResolution(value) {
  if (['720p', '1080p', '1440p'].includes(value)) {
    return value;
  }

  return DEFAULT_SETTINGS.gifResolution;
}

function normalizeCropRect(rect, viewport, bitmap) {
  if (!rect || !viewport?.width || !viewport?.height) {
    return null;
  }

  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;
  const x = clamp(Math.round(rect.x * scaleX), 0, bitmap.width - 1);
  const y = clamp(Math.round(rect.y * scaleY), 0, bitmap.height - 1);
  const right = clamp(Math.round((rect.x + rect.width) * scaleX), x + 1, bitmap.width);
  const bottom = clamp(Math.round((rect.y + rect.height) * scaleY), y + 1, bitmap.height);
  const width = right - x;
  const height = bottom - y;

  if (width < 120 || height < 80) {
    return null;
  }

  return {
    x,
    y,
    width,
    height
  };
}

function isCanvasProbablyBlack(canvas) {
  const sampleWidth = Math.min(96, canvas.width);
  const sampleHeight = Math.min(54, canvas.height);
  const sampleCanvas = new OffscreenCanvas(sampleWidth, sampleHeight);
  const sampleContext = sampleCanvas.getContext('2d', {
    willReadFrequently: true
  });

  sampleContext.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);

  const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let brightnessTotal = 0;
  let brightPixels = 0;
  let visiblePixels = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 10) {
      continue;
    }

    const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    brightnessTotal += brightness;
    visiblePixels += 1;

    if (brightness > 32) {
      brightPixels += 1;
    }
  }

  if (!visiblePixels) {
    return true;
  }

  const averageBrightness = brightnessTotal / visiblePixels;
  const brightRatio = brightPixels / visiblePixels;

  return averageBrightness < 8 && brightRatio < 0.004;
}

async function runOutputActions(dataUrl, filename, settings, options = {}) {
  const result = {
    downloaded: false,
    copied: false,
    clipboardError: '',
    downloadError: ''
  };

  if (settings.autoDownload && !options.skipDownload) {
    try {
      await downloadWithChrome(dataUrl, filename);
      result.downloaded = true;
    } catch (error) {
      result.downloadError = '下載失敗';
      console.warn(error);
    }
  }

  if (settings.copyToClipboard) {
    try {
      await copyImageToClipboard(dataUrl);
      result.copied = true;
    } catch (error) {
      result.clipboardError = '複製到剪貼簿失敗';
      console.warn(error);
    }
  }

  return result;
}

async function downloadWithChrome(dataUrl, filename) {
  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false
  });
}

async function copyImageToClipboard(dataUrl) {
  if (!chrome.offscreen) {
    throw new Error('此 Chrome 版本不支援 offscreen document');
  }

  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_COPY_IMAGE',
    dataUrl
  });

  if (!response?.ok) {
    throw new Error(response?.message || '複製到剪貼簿失敗');
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['CLIPBOARD'],
    justification: '複製使用者手動截取的圖片到剪貼簿'
  });
}

function buildFilename(title, settings, extension = 'png') {
  const animeName = sanitizeFilename(title);
  const baseName = animeName || (extension === 'gif' ? 'AnimeGif' : 'AnimeScreenshot');
  const filename = `${baseName}_${formatTimestamp(new Date())}.${extension}`;
  const folder = sanitizeDownloadSubfolder(settings.downloadSubfolder);
  const pathParts = [];

  if (folder) {
    pathParts.push(folder);
  }

  if (settings.organizeByAnimeName && animeName) {
    pathParts.push(animeName);
  }

  pathParts.push(filename);

  return pathParts.join('/');
}

function sanitizeFilename(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function sanitizeDownloadSubfolder(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\.\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function formatTimestamp(date) {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

async function sendGifProgress(progressId, done, total) {
  if (!progressId) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'GIF_PROGRESS',
      progressId,
      done,
      total
    });
  } catch (error) {
    // Popup 關閉時不影響 GIF 產生。
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
