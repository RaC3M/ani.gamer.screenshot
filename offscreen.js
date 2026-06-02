const gifJobs = new Map();
const gifResults = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OFFSCREEN_COPY_IMAGE') {
    copyImage(message.dataUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || '複製到剪貼簿失敗'
        });
      });

    return true;
  }

  if (message?.type === 'OFFSCREEN_ENCODE_GIF') {
    encodeGifInOffscreen(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || 'GIF 編碼失敗'
        });
      });

    return true;
  }

  if (message?.type === 'OFFSCREEN_ENCODE_GIF_START') {
    startGifJob(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || 'GIF 編碼失敗'
        });
      });

    return true;
  }

  if (message?.type === 'OFFSCREEN_ENCODE_GIF_ADD_FRAME') {
    addGifJobFrame(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || 'GIF 影格加入失敗'
        });
      });

    return true;
  }

  if (message?.type === 'OFFSCREEN_ENCODE_GIF_FINISH') {
    finishGifJob(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || 'GIF 編碼失敗'
        });
      });

    return true;
  }

  if (message?.type === 'OFFSCREEN_ENCODE_GIF_CANCEL') {
    gifJobs.delete(message.jobId || '');
    sendResponse({
      ok: true
    });

    return false;
  }

  if (message?.type === 'OFFSCREEN_ENCODE_GIF_GET_RESULT_CHUNK') {
    getGifResultChunk(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || 'GIF 結果讀取失敗'
        });
      });

    return true;
  }

  if (message?.type === 'OFFSCREEN_ENCODE_GIF_CLEAR_RESULT') {
    gifResults.delete(message.jobId || '');
    sendResponse({
      ok: true
    });

    return false;
  }

  return false;
});

async function copyImage(dataUrl) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('此 Chrome 版本不支援圖片剪貼簿 API');
  }

  const response = await fetch(dataUrl);
  const blob = await response.blob();

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type || 'image/png']: blob
    })
  ]);
}

async function startGifJob(message) {
  const jobId = String(message.jobId || '');
  const width = Number(message.width);
  const height = Number(message.height);
  const fps = Math.max(1, Number(message.fps) || 30);

  if (!jobId) {
    throw new Error('GIF job 缺少 ID');
  }

  if (!width || !height) {
    throw new Error('GIF 尺寸錯誤');
  }

  gifJobs.delete(jobId);

  const gif = createGifEncoder(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', {
    willReadFrequently: true
  });

  if (!context) {
    throw new Error('GIF.js 建立 canvas 失敗');
  }

  gifJobs.set(jobId, {
    gif,
    canvas,
    context,
    delay: Math.max(20, Math.round(1000 / fps)),
    frameCount: 0,
    progressId: message.progressId || ''
  });

  return {
    ok: true
  };
}

async function addGifJobFrame(message) {
  const jobId = String(message.jobId || '');
  const job = gifJobs.get(jobId);

  if (!job) {
    throw new Error('GIF job 不存在');
  }

  if (!message.frame?.dataUrl) {
    throw new Error('GIF 影格資料缺失');
  }

  const image = await loadImageFromDataUrl(message.frame.dataUrl);
  job.context.clearRect(0, 0, job.canvas.width, job.canvas.height);
  job.context.drawImage(image, 0, 0, job.canvas.width, job.canvas.height);
  job.gif.addFrame(job.canvas, {
    delay: message.frame.delayMilliseconds || job.delay,
    copy: true
  });
  job.frameCount += 1;

  const total = Math.max(1, Number(message.frameCount) || job.frameCount);
  const done = 50 + Math.round((job.frameCount / total) * 20);
  sendGifProgress(job.progressId, done, '加入 GIF 影格中...');

  return {
    ok: true
  };
}

async function finishGifJob(message) {
  const jobId = String(message.jobId || '');
  const job = gifJobs.get(jobId);

  if (!job) {
    throw new Error('GIF job 不存在');
  }

  try {
    if (!job.gif.frames.length) {
      throw new Error('沒有可用影格，無法製作 GIF');
    }

    const blob = await renderGifJob(job);
    const dataUrl = await blobToDataUrl(blob);
    const chunks = splitStringIntoChunks(dataUrl, 4 * 1024 * 1024);
    gifResults.set(jobId, {
      chunks
    });

    return {
      ok: true,
      resultToken: jobId,
      chunkCount: chunks.length
    };
  } finally {
    gifJobs.delete(jobId);
  }
}

function createGifEncoder(width, height) {
  if (typeof GIF !== 'function') {
    throw new Error('GIF.js 未載入');
  }

  return new GIF({
    workers: 2,
    workerScript: chrome.runtime.getURL('gif.worker.js'),
    quality: 10,
    repeat: 0,
    width,
    height,
    background: '#ffffff',
    dither: 'FloydSteinberg-serpentine'
  });
}

function renderGifJob(job) {
  return new Promise((resolve, reject) => {
    job.gif.on('finished', resolve);
    job.gif.on('abort', () => reject(new Error('GIF.js 編碼已中止')));
    job.gif.on('progress', (progress) => {
      sendGifProgress(job.progressId, 70 + Math.round(progress * 25), '產生 GIF 中...');
    });
    job.gif.render();
  });
}

async function getGifResultChunk(message) {
  const result = gifResults.get(message.jobId || '');
  const index = Number(message.chunkIndex);

  if (!result || !Number.isInteger(index) || index < 0 || index >= result.chunks.length) {
    throw new Error('GIF 結果分段不存在');
  }

  return {
    ok: true,
    chunk: result.chunks[index],
    chunkIndex: index,
    chunkCount: result.chunks.length
  };
}

function splitStringIntoChunks(value, chunkSize) {
  const chunks = [];

  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }

  return chunks;
}

function sendGifProgress(progressId, done, text) {
  if (!progressId) {
    return;
  }

  chrome.runtime.sendMessage({
    type: 'GIF_PROGRESS',
    progressId,
    done,
    total: 100,
    text
  }).catch(() => {});
}

async function encodeGifInOffscreen(message) {
  if (typeof GIF !== 'function') {
    throw new Error('GIF.js 未載入');
  }

  const width = Number(message.width);
  const height = Number(message.height);
  const fps = Math.max(1, Number(message.fps) || 30);
  const delay = Math.max(20, Math.round(1000 / fps));
  const frames = Array.isArray(message.frames) ? message.frames : [];

  if (!width || !height) {
    throw new Error('GIF 尺寸錯誤');
  }

  if (!frames.length) {
    throw new Error('沒有可用影格，無法產生 GIF');
  }

  const gif = new GIF({
    workers: 2,
    workerScript: chrome.runtime.getURL('gif.worker.js'),
    quality: 10,
    repeat: 0,
    width,
    height,
    background: '#ffffff',
    dither: 'FloydSteinberg-serpentine'
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', {
    willReadFrequently: true
  });

  if (!context) {
    throw new Error('GIF.js 建立 canvas 失敗');
  }

  for (const frame of frames) {
    if (!frame?.dataUrl) {
      continue;
    }

    const image = await loadImageFromDataUrl(frame.dataUrl);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    gif.addFrame(canvas, {
      delay: frame.delayMilliseconds || delay,
      copy: true
    });
  }

  if (!gif.frames.length) {
    throw new Error('沒有可用影格，無法製作 GIF');
  }

  const blob = await new Promise((resolve, reject) => {
    gif.on('finished', resolve);
    gif.on('abort', () => reject(new Error('GIF.js 編碼已中止')));
    gif.on('progress', (progress) => {
      chrome.runtime.sendMessage({
        type: 'GIF_PROGRESS',
        progressId: message.progressId || '',
        done: 70 + Math.round(progress * 25),
        total: 100,
        text: '產生 GIF 中...'
      }).catch(() => {});
    });
    gif.render();
  });

  return {
    ok: true,
    dataUrl: await blobToDataUrl(blob)
  };
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('GIF 影格圖片載入失敗'));
    image.src = dataUrl;
  });
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return `data:${blob.type || 'image/gif'};base64,${btoa(binary)}`;
}
