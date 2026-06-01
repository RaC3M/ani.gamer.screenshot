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
let pageShortcut = parseShortcut(DEFAULT_SHORTCUT);

loadShortcutSetting();
document.addEventListener('keydown', handlePageShortcut, true);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.pageShortcut) {
    pageShortcut = parseShortcut(changes.pageShortcut.newValue || DEFAULT_SHORTCUT);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_PLAYER_INFO') {
    sendResponse(getPlayerInfo());
    return false;
  }

  if (message?.type === 'CAPTURE_GIF_FRAMES_FROM_VIDEO') {
    captureGifFramesFromVideo(message)
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

  return false;
});

async function loadShortcutSetting() {
  const settings = await chrome.storage.sync.get({
    pageShortcut: DEFAULT_SHORTCUT
  });

  pageShortcut = parseShortcut(settings.pageShortcut);
}

async function handlePageShortcut(event) {
  if (!matchesShortcut(event, pageShortcut) || isTypingTarget(event.target)) {
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

function parseShortcut(value) {
  const fallback = {
    shift: true,
    ctrl: false,
    alt: false,
    meta: false,
    key: 'C'
  };
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

  return hasModifier && shortcut.key ? shortcut : fallback;
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

async function captureGifFramesFromVideo(options = {}) {
  const video = findAnimeVideo();

  if (!video) {
    return {
      ok: false,
      message: '找不到影片元素'
    };
  }

  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
    return {
      ok: false,
      message: '影片尚未載入完成'
    };
  }

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

  const safeStartTime = clampNumber(startTime, 0, video.duration);
  const safeEndTime = Math.min(requestedEndTime, safeStartTime + 15, video.duration);
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const outputWidth = normalizeGifOutputWidth(options.width, sourceWidth);
  const outputHeight = Math.max(1, Math.round(sourceHeight * (outputWidth / sourceWidth)));
  const frameDelay = Math.round(1000 / fps);
  const sampleInterval = 1 / fps;
  const estimatedFrames = Math.ceil((safeEndTime - safeStartTime) * fps);

  if (estimatedFrames <= 0) {
    return {
      ok: false,
      message: 'GIF 時間範圍不正確'
    };
  }

  if (estimatedFrames > 180) {
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

  try {
    video.pause();
    video.muted = true;
    video.playbackRate = 1;

    for (let index = 0; index < estimatedFrames; index += 1) {
      const captureTime = Math.min(safeStartTime + index * sampleInterval, safeEndTime);
      const dataUrl = await captureVideoFrameAtTime(video, captureTime, outputWidth, outputHeight);

      frames.push({
        dataUrl,
        delay: frameDelay,
        time: captureTime
      });
    }

    return {
      ok: true,
      frames,
      width: outputWidth,
      height: outputHeight,
      fps,
      delay: frameDelay,
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

async function captureVideoFrameAtTime(video, time, width, height) {
  await seekVideo(video, time);
  await waitVideoFrame(video);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', {
    willReadFrequently: true
  });

  if (!context) {
    throw new Error('GIF 影格擷取失敗');
  }

  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

function findAnimeVideo() {
  return document.querySelector('#ani_video_html5_api') || document.querySelector('video');
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
  return clampNumber(duration, 1, 15);
}

function normalizeGifFps(value) {
  const fps = Math.round(Number(value) || 8);

  if ([5, 8, 12].includes(fps)) {
    return fps;
  }

  return 8;
}

function normalizeGifOutputWidth(value, sourceWidth) {
  const width = Math.round(Number(value) || Math.min(sourceWidth, 960));
  return clampNumber(width, 1, sourceWidth);
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

  document.documentElement.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-4px)';
  }, 1800);

  window.setTimeout(() => {
    toast.remove();
  }, 2100);
}
