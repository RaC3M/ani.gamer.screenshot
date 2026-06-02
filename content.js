const PLAYER_SELECTORS = [
  '#ani_video_html5_api',
  '#ani_video',
  '.video-js',
  '.vjs-tech',
  'video',
  '#player',
  '.player',
  '.anime-player',
  '.ani-player',
  '.video-container',
  '.video-wrapper',
  '.videoArea',
  '.player_area',
  'iframe'
];
const DEFAULT_SHORTCUT = 'Shift+C';
const DEFAULT_GIF_SHORTCUT = 'Shift+G';
let pageShortcut = parseShortcut(DEFAULT_SHORTCUT, DEFAULT_SHORTCUT);
let gifShortcut = parseShortcut(DEFAULT_GIF_SHORTCUT, DEFAULT_GIF_SHORTCUT);
let gifBubble = null;
let gifBubbleState = null;

loadShortcutSetting();
document.addEventListener('keydown', handlePageShortcut, true);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.pageShortcut) {
    pageShortcut = parseShortcut(changes.pageShortcut.newValue || DEFAULT_SHORTCUT, DEFAULT_SHORTCUT);
  }

  if (areaName === 'sync' && changes.gifShortcut) {
    gifShortcut = parseShortcut(changes.gifShortcut.newValue || DEFAULT_GIF_SHORTCUT, DEFAULT_GIF_SHORTCUT);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_PLAYER_INFO') {
    sendResponse(getPlayerInfo());
    return false;
  }

  if (message?.type === 'GET_GIF_VIDEO_INFO') {
    sendResponse(getGifVideoInfo());
    return false;
  }

  if (message?.type === 'CAPTURE_GIF_FROM_VIDEO' || message?.type === 'CAPTURE_GIF_FRAMES_FROM_VIDEO') {
    captureGifFromVideo(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || 'GIF 影格擷取失敗'
        });
      });
    return true;
  }

  if (message?.type === 'SHOW_CAPTURE_TOAST') {
    showToast(message.text, message.tone, message.detail);
    sendResponse({
      ok: true
    });
    return false;
  }

  if (message?.type === 'SET_PAGE_SHORTCUT') {
    pageShortcut = parseShortcut(message.shortcut || DEFAULT_SHORTCUT);
    sendResponse({
      ok: true
    });
    return false;
  }

  if (message?.type === 'GIF_PROGRESS') {
    updateGifBubbleProgress(message);
    return false;
  }

  if (message?.type === 'SET_GIF_SHORTCUT') {
    gifShortcut = parseShortcut(message.shortcut || DEFAULT_GIF_SHORTCUT, DEFAULT_GIF_SHORTCUT);
    sendResponse({
      ok: true
    });
    return false;
  }

  return false;
});

async function loadShortcutSetting() {
  const settings = await chrome.storage.sync.get({
    pageShortcut: DEFAULT_SHORTCUT,
    gifShortcut: DEFAULT_GIF_SHORTCUT
  });

  pageShortcut = parseShortcut(settings.pageShortcut, DEFAULT_SHORTCUT);
  gifShortcut = parseShortcut(settings.gifShortcut, DEFAULT_GIF_SHORTCUT);
}

async function handlePageShortcut(event) {
  if (isTypingTarget(event.target)) {
    return;
  }

  if (matchesShortcut(event, gifShortcut)) {
    event.preventDefault();
    await openGifPanelFromShortcut();
    return;
  }

  if (!matchesShortcut(event, pageShortcut)) {
    return;
  }

  event.preventDefault();
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'CAPTURE_SCREENSHOT'
    });

    if (!result?.ok) {
      showToast(result?.message || '截圖失敗，可能受到網站限制', 'error');
    }
  } catch (error) {
    showToast('截圖失敗，可能受到網站限制', 'error');
  }
}

async function openGifPanelFromShortcut() {
  showGifBubble();
}

function matchesShortcut(event, shortcut) {
  return (
    event.shiftKey === shortcut.shift &&
    event.ctrlKey === shortcut.ctrl &&
    event.altKey === shortcut.alt &&
    event.metaKey === shortcut.meta &&
    !event.repeat &&
    getEventKey(event) === shortcut.key
  );
}

function parseShortcut(value, fallbackValue = DEFAULT_SHORTCUT) {
  const fallback = parseShortcutParts(fallbackValue) || {
    shift: true,
    ctrl: false,
    alt: false,
    meta: false,
    key: 'C'
  };

  return parseShortcutParts(value || fallbackValue) || fallback;
}

function parseShortcutParts(value) {
  const parts = String(value || DEFAULT_SHORTCUT)
    .toUpperCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const shortcut = {
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    key: ''
  };
  let hasModifier = false;

  for (const part of parts) {
    if (['CTRL', 'CONTROL'].includes(part)) {
      shortcut.ctrl = true;
      hasModifier = true;
    } else if (part === 'SHIFT') {
      shortcut.shift = true;
      hasModifier = true;
    } else if (part === 'ALT' || part === 'OPTION') {
      shortcut.alt = true;
      hasModifier = true;
    } else if (['META', 'CMD', 'COMMAND'].includes(part)) {
      shortcut.meta = true;
      hasModifier = true;
    } else if (/^[A-Z0-9]$/.test(part) || /^F([1-9]|1[0-2])$/.test(part)) {
      shortcut.key = part;
    }
  }

  return hasModifier && shortcut.key ? shortcut : null;
}

function getEventKey(event) {
  if (event.code?.startsWith('Key')) {
    return event.code.slice(3).toUpperCase();
  }

  if (event.code?.startsWith('Digit')) {
    return event.code.slice(5);
  }

  if (/^F([1-9]|1[0-2])$/.test(event.code)) {
    return event.code;
  }

  return String(event.key || '').toUpperCase();
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }

  const element = target instanceof Element ? target : target.parentElement;
  if (!element) {
    return false;
  }

  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
}

function getPlayerInfo() {
  return {
    rect: findPlayerRect(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    },
    title: getAnimeTitle()
  };
}

function getGifVideoInfo() {
  const video = findAnimeVideo();

  if (!video) {
    return {
      ok: false,
      message: '找不到影片元素'
    };
  }

  const timelineInfo = getVideoTimelineInfo(video);

  if (!Number.isFinite(timelineInfo.duration) || timelineInfo.duration <= 0) {
    return {
      ok: false,
      message: '影片尚未載入完成'
    };
  }

  return {
    ok: true,
    currentTime: timelineInfo.currentTime,
    duration: timelineInfo.duration,
    title: getAnimeTitle()
  };
}

async function captureGifFromVideo(options = {}) {
  const video = findAnimeVideo();

  if (!video) {
    return {
      ok: false,
      message: '找不到影片元素'
    };
  }

  const timelineInfo = getVideoTimelineInfo(video);

  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(timelineInfo.duration)) {
    return {
      ok: false,
      message: '影片尚未載入完成'
    };
  }
  /*
  if (typeof globalThis.GIF !== 'function') {
  return {
    ok: false,
    message: 'GIF.js 產生器未載入'
    };
  }*/

  const fps = normalizeGifFps(options.fps);
  const startTime = normalizeTimeValue(options.startTime, video.currentTime);
  const requestedEndTime = Number.isFinite(Number(options.endTime))
    ? Number(options.endTime)
    : startTime + normalizeGifDuration(options.durationSeconds);

  if (!Number.isFinite(startTime) || !Number.isFinite(requestedEndTime) || requestedEndTime <= startTime) {
    return {
      ok: false,
      message: 'GIF 時間範圍不正確'
    };
  }

  const safeStartTime = clampNumber(startTime, 0, timelineInfo.duration);
  const safeEndTime = Math.min(requestedEndTime, safeStartTime + 10, timelineInfo.duration);
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const outputWidth = normalizeGifOutputWidth(options.width, sourceWidth);
  const outputHeight = Math.max(1, Math.round(sourceHeight * (outputWidth / sourceWidth)));
  const sampleInterval = 1 / fps;
  const estimatedFrames = Math.ceil((safeEndTime - safeStartTime) * fps);
  const progressId = options.progressId || '';

  if (estimatedFrames <= 0) {
    return {
      ok: false,
      message: 'GIF 時間範圍不正確'
    };
  }

  if (estimatedFrames > 500) {
    return {
      ok: false,
      message: 'GIF 影格數過多，請縮短時間或降低 FPS'
    };
  }

  const frames = [];
  const originalTime = video.currentTime;
  const originalPaused = video.paused;
  const originalMuted = video.muted;
  const originalPlaybackRate = video.playbackRate;
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d', {
    willReadFrequently: true
  });

  if (!context) {
    return {
      ok: false,
      message: 'GIF 影格擷取失敗'
    };
  }

  try {
    video.muted = true;
    video.playbackRate = 1;
    await seekVideo(video, safeStartTime);
    await waitVideoFrame(video);
    try {
      await captureGifFramesByPlayback({
        video,
        frames,
        context,
        outputWidth,
        outputHeight,
        fps,
        sampleInterval,
        safeEndTime,
        estimatedFrames,
        progressId
      });
    } catch (error) {
      console.warn('Playback GIF capture failed, using seek fallback:', error);
      frames.length = 0;
      await captureGifFramesBySeek({
        video,
        frames,
        context,
        outputWidth,
        outputHeight,
        fps,
        safeStartTime,
        sampleInterval,
        estimatedFrames,
        progressId
      });
    }

    if (!frames.length) {
      return {
        ok: false,
        message: 'GIF 影格擷取失敗'
      };
    }

    await sendGifProgress(progressId, 70, 100, '產生 GIF 中...');

    const gifResult = await encodeGifWithGifJs(frames, {
      width: outputWidth,
      height: outputHeight,
      fps,
      progressId
    });

    await sendGifProgress(progressId, 95, 100, '產生 GIF 中...');

    return {
      ok: true,
      dataUrl: gifResult.dataUrl || '',
      resultToken: gifResult.resultToken || '',
      chunkCount: gifResult.chunkCount || 0,
      width: outputWidth,
      height: outputHeight,
      fps,
      frameCount: frames.length,
      startTime: safeStartTime,
      endTime: safeEndTime,
      title: getAnimeTitle()
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || 'GIF 影格擷取失敗'
    };
  } finally {
    video.muted = originalMuted;
    video.playbackRate = originalPlaybackRate;

    try {
      await seekVideo(video, originalTime);
    } catch (error) {
      console.warn('Failed to restore video time:', error);
    }

    if (originalPaused) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
  }
}
/*
function encodeGifWithGifJs(frames, options = {}) {
  return new Promise(async (resolve, reject) => {
    if (typeof globalThis.GIF !== 'function') {
      reject(new Error('GIF.js 未載入'));
      return;
    }

    if (!Array.isArray(frames) || frames.length === 0) {
      reject(new Error('沒有可用影格，無法產生 GIF'));
      return;
    }

    const width = Number(options.width);
    const height = Number(options.height);
    const fps = Math.max(1, Number(options.fps) || 30);
    const delay = Math.max(20, Math.round(1000 / fps));
    const progressId = options.progressId || '';

    const workerScript = chrome.runtime.getURL('gif.worker.js');

    console.log('GIF workerScript:', workerScript);

    const gif = new globalThis.GIF({
      workers: 2,
      workerScript,
      quality: 10,
      repeat: 0,
      width,
      height,
      background: '#ffffff',
      dither: 'FloydSteinberg-serpentine'
    });

    gif.on('progress', (progress) => {
      const percent = 70 + Math.round(progress * 25);
      sendGifProgress(progressId, percent, 100, '產生 GIF 中...').catch(() => {});
    });

    gif.on('finished', (blob) => {
      resolve(blob);
    });

    gif.on('abort', () => {
      reject(new Error('GIF.js 編碼已中止'));
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', {
      willReadFrequently: true
    });

    if (!context) {
      reject(new Error('GIF.js 建立 canvas 失敗'));
      return;
    }

    for (const frame of frames) {
      const imageData = frame.imageData || frame;

      if (!imageData || !imageData.data) {
        continue;
      }

      context.putImageData(imageData, 0, 0);

      gif.addFrame(canvas, {
        delay: frame.delayMilliseconds || delay,
        copy: true
      });
    }

    if (!gif.frames.length) {
      reject(new Error('沒有可用影格，無法產生 GIF'));
      return;
    }

    gif.render();
  });
}
*/
function encodeGifWithGifJs(frames, options = {}) {
  return new Promise(async (resolve, reject) => {
    const width = Number(options.width);
    const height = Number(options.height);
    const fps = Math.max(1, Number(options.fps) || 30);
    const delay = Math.max(20, Math.round(1000 / fps));

    if (!width || !height) {
      reject(new Error('GIF 尺寸錯誤'));
      return;
    }

    if (!Array.isArray(frames) || frames.length === 0) {
      reject(new Error('沒有可用影格，無法製作 GIF'));
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {
      willReadFrequently: true
    });

    if (!context) {
      reject(new Error('建立 GIF 影格 canvas 失敗'));
      return;
    }

    const progressId = options.progressId || '';
    const jobId = progressId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let addedFrames = 0;

    try {
      const startResponse = await chrome.runtime.sendMessage({
        type: 'ENCODE_GIF_OFFSCREEN_START',
        jobId,
        width,
        height,
        fps,
        progressId
      });

      if (!startResponse?.ok) {
        throw new Error(startResponse?.message || 'GIF 編碼失敗');
      }

      for (const frame of frames) {
        const imageData = frame.imageData || frame;

        if (!imageData?.data) {
          continue;
        }

        context.putImageData(imageData, 0, 0);
        const addResponse = await chrome.runtime.sendMessage({
          type: 'ENCODE_GIF_OFFSCREEN_ADD_FRAME',
          jobId,
          frameIndex: addedFrames,
          frameCount: frames.length,
          frame: {
            dataUrl: canvas.toDataURL('image/png'),
            delayMilliseconds: frame.delayMilliseconds || delay
          },
          progressId
        });

        if (!addResponse?.ok) {
          throw new Error(addResponse?.message || 'GIF 影格傳送失敗');
        }

        addedFrames += 1;
      }
    } catch (error) {
      chrome.runtime.sendMessage({
        type: 'ENCODE_GIF_OFFSCREEN_CANCEL',
        jobId,
        progressId
      }).catch(() => {});
      reject(new Error(error?.message || 'GIF 影格轉換失敗'));
      return;
    }

    if (!addedFrames) {
      reject(new Error('沒有可用影格，無法製作 GIF'));
      return;
    }

    chrome.runtime.sendMessage({
      type: 'ENCODE_GIF_OFFSCREEN_FINISH',
      jobId,
      progressId
    })
      .then((response) => {
        if (!response?.ok || (!response.dataUrl && !response.resultToken)) {
          throw new Error(response?.message || 'GIF 編碼失敗');
        }

        resolve(response);
      })
      .catch(reject);
  });
}
function findAnimeVideo() {
  const videos = Array.from(document.querySelectorAll('video'));

  if (!videos.length) {
    return null;
  }

  const scoredVideos = videos
    .map((video) => ({
      video,
      score: scoreVideoCandidate(video)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scoredVideos[0]?.video || videos[0];
}

function scoreVideoCandidate(video) {
  const rect = getVisibleRect(video);
  const timelineInfo = getVideoTimelineInfo(video);
  let score = 0;

  if (rect) {
    score += rect.width * rect.height;
  }

  if (video.id === 'ani_video_html5_api') {
    score += 1000000;
  }

  if (video.videoWidth && video.videoHeight) {
    score += 500000;
  }

  if (Number.isFinite(timelineInfo.duration) && timelineInfo.duration > 10) {
    score += 300000;
  }

  if (video.currentSrc || video.src) {
    score += 100000;
  }

  return score;
}

function getVideoTimelineInfo(video) {
  const durationCandidates = [
    video.duration,
    getSeekableDuration(video),
    readDurationFromPageText()
  ];
  const currentTime = normalizeTimeValue(video.currentTime, readCurrentTimeFromPageText() || 0);
  const duration = durationCandidates
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((max, value) => Math.max(max, value), 0);

  return {
    currentTime: clampNumber(currentTime, 0, duration || currentTime || 0),
    duration
  };
}

function getSeekableDuration(video) {
  try {
    const seekable = video.seekable;

    if (!seekable?.length) {
      return 0;
    }

    return seekable.end(seekable.length - 1);
  } catch (error) {
    return 0;
  }
}

function readCurrentTimeFromPageText() {
  const pair = readTimePairFromPageText();
  return pair?.current || 0;
}

function readDurationFromPageText() {
  const pair = readTimePairFromPageText();
  return pair?.duration || 0;
}

function readTimePairFromPageText() {
  const ariaPair = readTimePairFromAriaControls();

  if (ariaPair) {
    return ariaPair;
  }

  const controlPair = readTimePairFromPlayerControls();

  if (controlPair) {
    return controlPair;
  }

  const text = document.body?.innerText || '';
  const matches = Array.from(text.matchAll(/\b(\d{1,2}:)?\d{1,2}:\d{2}\b/g))
    .map((match) => parseTimeText(match[0]))
    .filter((value) => Number.isFinite(value));

  if (matches.length < 2) {
    return null;
  }

  let bestPair = null;

  for (let index = 0; index < matches.length - 1; index += 1) {
    const current = matches[index];
    const duration = matches[index + 1];

    if (duration > current && (!bestPair || duration > bestPair.duration)) {
      bestPair = {
        current,
        duration
      };
    }
  }

  return bestPair;
}

function readTimePairFromAriaControls() {
  const sliders = Array.from(document.querySelectorAll('[role="slider"][aria-valuemax], [aria-valuemax][aria-valuenow]'));

  for (const slider of sliders) {
    const current = Number(slider.getAttribute('aria-valuenow'));
    const duration = Number(slider.getAttribute('aria-valuemax'));

    if (Number.isFinite(current) && Number.isFinite(duration) && duration > current && duration > 10) {
      return {
        current,
        duration
      };
    }
  }

  return null;
}

function readTimePairFromPlayerControls() {
  const selectorPairs = [
    ['.vjs-current-time-display', '.vjs-duration-display'],
    ['.vjs-current-time', '.vjs-duration'],
    ['[class*="current-time"]', '[class*="duration"]'],
    ['[class*="elapsed"]', '[class*="duration"]']
  ];

  for (const [currentSelector, durationSelector] of selectorPairs) {
    const current = parseFirstTimeFromText(document.querySelector(currentSelector)?.textContent);
    const duration = parseFirstTimeFromText(document.querySelector(durationSelector)?.textContent);

    if (duration > current && duration > 10) {
      return {
        current,
        duration
      };
    }
  }

  return null;
}

function parseFirstTimeFromText(value) {
  const match = String(value || '').match(/\b(\d{1,2}:)?\d{1,2}:\d{2}\b/);
  return match ? parseTimeText(match[0]) : 0;
}

function parseTimeText(value) {
  const parts = String(value || '')
    .split(':')
    .map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return 0;
}

async function showGifBubble() {
  const videoInfo = getGifVideoInfo();

  if (!videoInfo.ok) {
    showToast(videoInfo.message || '讀取影片時間失敗', 'error');
    return;
  }

  const settings = await chrome.storage.sync.get({
    gifResolution: '720p',
    gifFps: 30
  });
  const startTime = clampNumber(videoInfo.currentTime, 0, videoInfo.duration);
  const endTime = Math.min(startTime + 5, videoInfo.duration);

  closeGifBubble();
  gifBubbleState = {
    startTime,
    endTime,
    duration: videoInfo.duration,
    settings,
    progressId: ''
  };

  const host = document.createElement('div');
  host.id = 'anime-screenshot-gif-bubble';
  const shadow = host.attachShadow({
    mode: 'open'
  });
  shadow.innerHTML = `
    <style>
      :host {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .panel {
        width: min(328px, calc(100vw - 32px));
        padding: 14px;
        border: 1px solid rgba(15, 118, 110, 0.24);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.24);
        color: #0f172a;
      }

      .head,
      .row,
      .values,
      .meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .head strong,
      .row span {
        font-size: 14px;
        font-weight: 800;
      }

      .close,
      .sync {
        border: 1px solid #0f766e;
        border-radius: 8px;
        background: #ffffff;
        color: #0f766e;
        cursor: pointer;
        font-size: 12px;
        font-weight: 800;
      }

      .close {
        width: 28px;
        height: 28px;
      }

      .sync {
        min-height: 28px;
        padding: 0 10px;
      }

      .hint,
      .meta,
      .progress {
        color: #64748b;
        font-size: 12px;
      }

      .hint {
        margin: 8px 0 10px;
      }

      .time-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .time-grid label {
        display: grid;
        gap: 4px;
      }

      .time-grid span {
        color: #334155;
        font-size: 12px;
        font-weight: 800;
      }

      .time-grid input {
        min-width: 0;
        height: 36px;
        padding: 0 9px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        color: #0f172a;
        font-size: 13px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }

      .create {
        width: 100%;
        min-height: 38px;
        margin-top: 12px;
        border: 0;
        border-radius: 8px;
        background: #0f766e;
        color: #ffffff;
        cursor: pointer;
        font-size: 14px;
        font-weight: 800;
      }

      .create:disabled {
        cursor: wait;
        opacity: 0.7;
      }

      .progress {
        min-height: 18px;
        margin: 8px 0 0;
      }
    </style>
    <div class="panel">
      <div class="head">
        <strong>GIF 製作</strong>
        <button class="close" type="button" aria-label="關閉">×</button>
      </div>
      <div class="row">
        <span>影片時間軸</span>
        <button class="sync" type="button">目前時間</button>
      </div>
      <div class="hint">輸入開始、結束或秒數，最長 10 秒。</div>
      <div class="time-grid">
        <label>
          <span>開始</span>
          <input class="start-input" type="text" inputmode="numeric" value="00:00">
        </label>
        <label>
          <span>結束</span>
          <input class="end-input" type="text" inputmode="numeric" value="00:05">
        </label>
        <label>
          <span>秒數</span>
          <input class="seconds-input" type="number" min="0.5" max="10" step="0.5" value="5">
        </label>
      </div>
      <div class="meta">
        <span class="length-text">長度 5 秒</span>
        <span class="duration-text">影片 00:00</span>
      </div>
      <button class="create" type="button">製作 GIF</button>
      <p class="progress" aria-live="polite">尚未製作 GIF</p>
    </div>
  `;

  gifBubble = {
    host,
    shadow
  };
  (document.fullscreenElement || document.documentElement).appendChild(host);
  wireGifBubble();
  renderGifBubbleTimeline();
}

function closeGifBubble() {
  gifBubble?.host?.remove();
  gifBubble = null;
  gifBubbleState = null;
}

function wireGifBubble() {
  const shadow = gifBubble.shadow;

  shadow.querySelector('.close').addEventListener('click', closeGifBubble);
  shadow.querySelector('.sync').addEventListener('click', syncGifBubbleToCurrentTime);
  shadow.querySelector('.create').addEventListener('click', createGifFromBubble);
  shadow.querySelector('.start-input').addEventListener('change', () => updateGifBubbleRange('start'));
  shadow.querySelector('.end-input').addEventListener('change', () => updateGifBubbleRange('end'));
  shadow.querySelector('.seconds-input').addEventListener('input', () => updateGifBubbleRange('seconds'));
}

function syncGifBubbleToCurrentTime() {
  const videoInfo = getGifVideoInfo();

  if (!videoInfo.ok) {
    return;
  }

  gifBubbleState.duration = videoInfo.duration;
  gifBubbleState.startTime = clampNumber(videoInfo.currentTime, 0, videoInfo.duration);
  gifBubbleState.endTime = Math.min(gifBubbleState.startTime + 5, videoInfo.duration);
  renderGifBubbleTimeline();
}

async function createGifFromBubble() {
  if (!gifBubbleState) {
    return;
  }

  const shadow = gifBubble.shadow;
  const createButton = shadow.querySelector('.create');
  const progress = shadow.querySelector('.progress');
  const fps = normalizeGifFps(gifBubbleState.settings.gifFps);
  const progressId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const durationSeconds = Math.max(0.5, gifBubbleState.endTime - gifBubbleState.startTime);
  const totalFrames = Math.ceil(durationSeconds * fps);

  gifBubbleState.progressId = progressId;
  createButton.disabled = true;
  progress.textContent = `製作中... 0/${totalFrames}`;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'CAPTURE_GIF',
      startTime: gifBubbleState.startTime,
      endTime: gifBubbleState.endTime,
      outputResolution: gifBubbleState.settings.gifResolution,
      fps,
      progressId
    });

    progress.textContent = result?.ok ? 'GIF 製作完成' : 'GIF 製作失敗，可能受到網站限制';
  } catch (error) {
    progress.textContent = 'GIF 製作失敗，可能受到網站限制';
  } finally {
    createButton.disabled = false;
  }
}

function updateGifBubbleProgress(message) {
  if (!gifBubbleState || message.progressId !== gifBubbleState.progressId || !gifBubble) {
    return;
  }

  gifBubble.shadow.querySelector('.progress').textContent = message.text || '製作中...';
}

function updateGifBubbleRange(changedField) {
  if (!gifBubbleState || !gifBubble) {
    return;
  }

  const shadow = gifBubble.shadow;
  const startInput = shadow.querySelector('.start-input');
  const endInput = shadow.querySelector('.end-input');
  const secondsInput = shadow.querySelector('.seconds-input');
  let startTime = parseTimeTextInput(startInput.value, gifBubbleState.startTime);
  let seconds = normalizeBubbleSeconds(secondsInput.value);
  let endTime = parseTimeTextInput(endInput.value, startTime + seconds);

  startTime = clampNumber(startTime, 0, gifBubbleState.duration);

  if (changedField === 'seconds' || changedField === 'start') {
    endTime = startTime + seconds;
  } else {
    endTime = clampNumber(endTime, 0, gifBubbleState.duration);
    seconds = endTime - startTime;
  }

  if (seconds < 0.5) {
    seconds = 0.5;
    endTime = startTime + seconds;
  }

  if (seconds > 10) {
    seconds = 10;
    endTime = startTime + seconds;
  }

  if (endTime > gifBubbleState.duration) {
    endTime = gifBubbleState.duration;
    seconds = Math.max(0.5, endTime - startTime);
  }

  if (endTime <= startTime) {
    startTime = Math.max(0, endTime - seconds);
  }

  gifBubbleState.startTime = roundTimelineValue(startTime);
  gifBubbleState.endTime = roundTimelineValue(endTime);
  renderGifBubbleTimeline();
}

function renderGifBubbleTimeline() {
  if (!gifBubbleState || !gifBubble) {
    return;
  }

  const shadow = gifBubble.shadow;
  const seconds = gifBubbleState.endTime - gifBubbleState.startTime;

  shadow.querySelector('.start-input').value = formatTimelineTime(gifBubbleState.startTime);
  shadow.querySelector('.end-input').value = formatTimelineTime(gifBubbleState.endTime);
  shadow.querySelector('.seconds-input').value = formatSecondsValue(seconds);
  shadow.querySelector('.length-text').textContent = `長度 ${formatTimelineDuration(gifBubbleState.endTime - gifBubbleState.startTime)}`;
  shadow.querySelector('.duration-text').textContent = `影片 ${formatTimelineTime(gifBubbleState.duration)}`;
}

function roundTimelineValue(value) {
  return Math.round(value * 10) / 10;
}

function normalizeBubbleSeconds(value) {
  const seconds = Number(value);
  return Math.min(Math.max(Number.isFinite(seconds) ? seconds : 5, 0.5), 10);
}

function formatSecondsValue(value) {
  const rounded = roundTimelineValue(value);
  return String(Number.isInteger(rounded) ? rounded : rounded.toFixed(1));
}

function parseTimeTextInput(value, fallback = 0) {
  const text = String(value || '').trim();

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }

  const parsed = parseTimeText(text);
  return parsed || fallback;
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

async function captureGifFramesByPlayback(options) {
  const {
    video,
    frames,
    context,
    outputWidth,
    outputHeight,
    fps,
    sampleInterval,
    safeEndTime,
    estimatedFrames,
    progressId
  } = options;

  await video.play();

  await new Promise((resolve, reject) => {
    let lastSampledMediaTime = null;
    let callbackId = 0;
    let finished = false;
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error('GIF 影格擷取失敗')));
    }, Math.max(5000, (safeEndTime - video.currentTime + 4) * 1000));

    const finish = (done) => {
      if (finished) {
        return;
      }

      finished = true;
      window.clearTimeout(timeout);

      if (callbackId && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(callbackId);
      }

      done();
    };

    const frameCallback = (now, metadata) => {
      if (finished) {
        return;
      }

      const mediaTime = Number(metadata?.mediaTime ?? video.currentTime);

      if (mediaTime >= safeEndTime || frames.length >= estimatedFrames) {
        finish(resolve);
        return;
      }

      if (lastSampledMediaTime === null || mediaTime - lastSampledMediaTime >= sampleInterval - 0.004) {
        try {
          pushGifFrame({
            frames,
            context,
            outputWidth,
            outputHeight,
            video,
            fps,
            estimatedFrames,
            progressId
          });
          lastSampledMediaTime = mediaTime;
        } catch (error) {
          finish(() => reject(error));
          return;
        }
      }

      callbackId = requestNextVideoFrame(video, frameCallback);
    };

    callbackId = requestNextVideoFrame(video, frameCallback);
  });
}

async function captureGifFramesBySeek(options) {
  const {
    video,
    frames,
    context,
    outputWidth,
    outputHeight,
    fps,
    safeStartTime,
    sampleInterval,
    estimatedFrames,
    progressId
  } = options;

  video.pause();

  for (let index = 0; index < estimatedFrames; index += 1) {
    await seekVideo(video, safeStartTime + index * sampleInterval);
    await waitVideoFrame(video);
    pushGifFrame({
      frames,
      context,
      outputWidth,
      outputHeight,
      video,
      fps,
      estimatedFrames,
      progressId
    });
  }
}

function pushGifFrame(options) {
  const {
    frames,
    context,
    outputWidth,
    outputHeight,
    video,
    fps,
    estimatedFrames,
    progressId
  } = options;

  try {
    context.drawImage(video, 0, 0, outputWidth, outputHeight);

    frames.push({
      imageData: context.getImageData(0, 0, outputWidth, outputHeight),
      delayCentiseconds: getGifFrameDelayCentiseconds(fps, frames.length)
    });

    sendGifProgress(
      progressId,
      Math.round((frames.length / estimatedFrames) * 50),
      100,
      '擷取 GIF 影格中...'
    );
  } catch (error) {
    console.error('pushGifFrame failed:', error);

    if (
      error?.name === 'SecurityError' ||
      String(error?.message || '').includes('tainted') ||
      String(error?.message || '').includes('cross-origin')
    ) {
      throw new Error('影片畫面無法被 canvas 讀取，可能是瀏覽器或影片來源限制');
    }

    throw new Error(error?.message || 'GIF 影格擷取失敗');
  }
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const safeTime = Math.max(0, Math.min(time, video.duration || time));
    let timer = 0;

    if (Math.abs(video.currentTime - safeTime) < 0.02) {
      resolve();
      return;
    }

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      window.clearTimeout(timer);
    };

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('影片 seek 失敗'));
    };

    timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 1200);

    video.addEventListener('seeked', onSeeked, {
      once: true
    });
    video.addEventListener('error', onError, {
      once: true
    });

    video.currentTime = safeTime;
  });
}

function waitVideoFrame(video) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };
    const timer = window.setTimeout(finish, 300);

    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        finish();
      });
      return;
    }

    window.requestAnimationFrame(() => {
      window.clearTimeout(timer);
      finish();
    });
  });
}

function requestNextVideoFrame(video, callback) {
  if ('requestVideoFrameCallback' in video) {
    return video.requestVideoFrameCallback(callback);
  }

  return window.requestAnimationFrame((now) => {
    callback(now, {
      mediaTime: video.currentTime
    });
  });
}

function getGifFrameDelayCentiseconds(fps, frameIndex) {
  const frameStart = Math.round((frameIndex * 100) / fps);
  const frameEnd = Math.round(((frameIndex + 1) * 100) / fps);
  return Math.max(1, frameEnd - frameStart);
}

async function sendGifProgress(progressId, done, total, text) {
  if (!progressId) {
    return;
  }

  updateGifBubbleProgress({
    progressId,
    done,
    total,
    text
  });

  try {
    await chrome.runtime.sendMessage({
      type: 'GIF_PROGRESS',
      progressId,
      done,
      total,
      text
    });
  } catch (error) {
    // Popup 關閉時不影響 GIF 產生。
  }
}

function findPlayerRect() {
  const candidates = [];

  PLAYER_SELECTORS.forEach((selector, index) => {
    document.querySelectorAll(selector).forEach((element) => {
      const rect = getVisibleRect(element);
      if (!rect) {
        return;
      }

      candidates.push({
        rect,
        score: scoreCandidate(element, rect, index)
      });
    });
  });

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].rect;
}

function getVisibleRect(element) {
  const style = window.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number(style.opacity) === 0
  ) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const width = right - left;
  const height = bottom - top;

  if (width < 120 || height < 80) {
    return null;
  }

  return {
    x: left,
    y: top,
    width,
    height
  };
}

function scoreCandidate(element, rect, selectorIndex) {
  const area = rect.width * rect.height;
  const tagName = element.tagName.toLowerCase();
  const className = String(element.className || '').toLowerCase();
  const id = String(element.id || '').toLowerCase();
  let score = area - selectorIndex * 1000;

  if (tagName === 'video') {
    score += 800000;
  }

  if (tagName === 'iframe') {
    score += 250000;
  }

  if (id.includes('video') || id.includes('player')) {
    score += 400000;
  }

  if (className.includes('video') || className.includes('player')) {
    score += 300000;
  }

  return score;
}

function getAnimeTitle() {
  const titleSelectors = [
    '.anime_name h1',
    '.anime_name',
    '.video-title',
    '.videoTitle',
    '.theme-title',
    'h1'
  ];

  for (const selector of titleSelectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) {
      return cleanTitle(text);
    }
  }

  return cleanTitle(document.title);
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\s*[-|｜]\s*巴哈姆特動畫瘋\s*$/u, '')
    .replace(/\s*[-|｜]\s*動畫瘋\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTimeValue(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeGifDuration(value) {
  const duration = Math.round(Number(value) || 5);
  return clampNumber(duration, 1, 10);
}

function normalizeGifFps(value) {
  const fps = Math.round(Number(value) || 30);

  if ([30, 50].includes(fps)) {
    return fps;
  }

  return 30;
}

function normalizeGifOutputWidth(value, sourceWidth) {
  const width = Math.round(Number(value) || Math.min(sourceWidth, 960));
  return clampNumber(width, 1, sourceWidth);
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('GIF 產生失敗')));
    reader.readAsDataURL(blob);
  });
}

function showToast(text, tone = 'success', detail = '') {
  const existing = document.getElementById('anime-screenshot-helper-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  const title = document.createElement('div');
  toast.id = 'anime-screenshot-helper-toast';
  title.textContent = text;
  toast.appendChild(title);

  if (detail) {
    const detailText = document.createElement('div');
    detailText.textContent = detail;
    detailText.style.marginTop = '4px';
    detailText.style.fontSize = '12px';
    detailText.style.fontWeight = '500';
    detailText.style.opacity = '0.9';
    detailText.style.maxWidth = '260px';
    detailText.style.overflow = 'hidden';
    detailText.style.textOverflow = 'ellipsis';
    detailText.style.whiteSpace = 'nowrap';
    toast.appendChild(detailText);
  }

  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.zIndex = '2147483647';
  toast.style.padding = '10px 14px';
  toast.style.borderRadius = '8px';
  toast.style.fontSize = '14px';
  toast.style.fontWeight = '600';
  toast.style.color = '#ffffff';
  toast.style.background = tone === 'error' ? '#b42318' : '#0f766e';
  toast.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.2)';
  toast.style.transition = 'opacity 160ms ease, transform 160ms ease';

  (document.fullscreenElement || document.documentElement).appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-4px)';
  }, 1800);

  window.setTimeout(() => {
    toast.remove();
  }, 2100);
}
