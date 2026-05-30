chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'OFFSCREEN_COPY_IMAGE') {
    return false;
  }

  copyImage(message.dataUrl)
    .then(() => {
      sendResponse({
        ok: true
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        message: error?.message || '複製到剪貼簿失敗'
      });
    });

  return true;
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
