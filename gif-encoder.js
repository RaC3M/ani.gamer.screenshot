(function exposeGifEncoder(root) {
  const COLOR_TABLE_SIZE = 256;
  const LZW_MIN_CODE_SIZE = 8;

  class ByteWriter {
    constructor() {
      this.chunks = [];
      this.current = new Uint8Array(8192);
      this.offset = 0;
      this.length = 0;
    }

    writeByte(value) {
      if (this.offset >= this.current.length) {
        this.chunks.push(this.current);
        this.current = new Uint8Array(8192);
        this.offset = 0;
      }

      this.current[this.offset] = value & 0xff;
      this.offset += 1;
      this.length += 1;
    }

    writeBytes(values) {
      for (let i = 0; i < values.length; i += 1) {
        this.writeByte(values[i]);
      }
    }

    writeAscii(value) {
      for (let i = 0; i < value.length; i += 1) {
        this.writeByte(value.charCodeAt(i));
      }
    }

    writeUint16(value) {
      this.writeByte(value & 0xff);
      this.writeByte((value >> 8) & 0xff);
    }

    toUint8Array() {
      const output = new Uint8Array(this.length);
      let cursor = 0;

      for (const chunk of this.chunks) {
        output.set(chunk, cursor);
        cursor += chunk.length;
      }

      output.set(this.current.subarray(0, this.offset), cursor);
      return output;
    }
  }

  function encodeGif(frames, options = {}) {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('GIF 至少需要一張畫面');
    }

    const firstImageData = getFrameImageData(frames[0]);
    const width = Number(options.width || firstImageData.width);
    const height = Number(options.height || firstImageData.height);

    if (!width || !height) {
      throw new Error('GIF 畫面尺寸無效');
    }

    const writer = new ByteWriter();
    const palette = buildRgb332Palette();

    writer.writeAscii('GIF89a');
    writer.writeUint16(width);
    writer.writeUint16(height);
    writer.writeByte(0xf7);
    writer.writeByte(0);
    writer.writeByte(0);
    writer.writeBytes(palette);
    writeLoopExtension(writer, Number(options.loop ?? 0));

    for (const frame of frames) {
      const imageData = getFrameImageData(frame);
      const delay = clampDelay(frame.delayCentiseconds || options.delayCentiseconds || 50);

      if (imageData.width !== width || imageData.height !== height) {
        throw new Error('GIF 每一張畫面尺寸必須一致');
      }

      writeGraphicsControlExtension(writer, delay);
      writeImageDescriptor(writer, width, height);
      writeImageData(writer, quantizeToRgb332(imageData));
    }

    writer.writeByte(0x3b);
    return writer.toUint8Array();
  }

  function getFrameImageData(frame) {
    return frame.imageData || frame;
  }

  function buildRgb332Palette() {
  const palette = new Uint8Array(COLOR_TABLE_SIZE * 3);

  for (let r = 0; r < 8; r += 1) {
    for (let g = 0; g < 8; g += 1) {
      for (let b = 0; b < 4; b += 1) {
        const index = (r << 5) | (g << 2) | b;
        const offset = index * 3;
        palette[offset] = Math.round((r * 255) / 7);
        palette[offset + 1] = Math.round((g * 255) / 7);
        palette[offset + 2] = Math.round((b * 255) / 3);
      }
    }
  }

  return palette;
}
  function writeLoopExtension(writer, loopCount) {
    writer.writeByte(0x21);
    writer.writeByte(0xff);
    writer.writeByte(11);
    writer.writeAscii('NETSCAPE2.0');
    writer.writeByte(3);
    writer.writeByte(1);
    writer.writeUint16(Math.max(0, Math.min(65535, loopCount)));
    writer.writeByte(0);
  }

  function writeGraphicsControlExtension(writer, delay) {
    writer.writeByte(0x21);
    writer.writeByte(0xf9);
    writer.writeByte(4);
    writer.writeByte(0x04);
    writer.writeUint16(delay);
    writer.writeByte(0);
    writer.writeByte(0);
  }

  function writeImageDescriptor(writer, width, height) {
    writer.writeByte(0x2c);
    writer.writeUint16(0);
    writer.writeUint16(0);
    writer.writeUint16(width);
    writer.writeUint16(height);
    writer.writeByte(0);
  }

  function writeImageData(writer, indices) {
    const compressed = lzwEncode(indices);
    writer.writeByte(LZW_MIN_CODE_SIZE);

    for (let offset = 0; offset < compressed.length; offset += 255) {
      const block = compressed.subarray(offset, offset + 255);
      writer.writeByte(block.length);
      writer.writeBytes(block);
    }

    writer.writeByte(0);
  }
  function quantizeToRgb332(imageData) {
  const { width, height } = imageData;
  const source = imageData.data;
  const indices = new Uint8Array(width * height);
  const buffer = new Float32Array(width * height * 3);
  const DITHER_STRENGTH = 0.1;

  for (
    let pixelIndex = 0, sourceIndex = 0, bufferIndex = 0;
    pixelIndex < width * height;
    pixelIndex += 1, sourceIndex += 4, bufferIndex += 3
  ) {
    buffer[bufferIndex] = source[sourceIndex];
    buffer[bufferIndex + 1] = source[sourceIndex + 1];
    buffer[bufferIndex + 2] = source[sourceIndex + 2];
  }

  for (let y = 0; y < height; y += 1) {
    const leftToRight = y % 2 === 0;
    const startX = leftToRight ? 0 : width - 1;
    const endX = leftToRight ? width : -1;
    const stepX = leftToRight ? 1 : -1;

    for (let x = startX; x !== endX; x += stepX) {
      const pixelIndex = y * width + x;
      const sourceIndex = pixelIndex * 4;
      const bufferIndex = pixelIndex * 3;

      if (source[sourceIndex + 3] < 128) {
        indices[pixelIndex] = 0;
        continue;
      }

      const oldRed = clampColor(buffer[bufferIndex]);
      const oldGreen = clampColor(buffer[bufferIndex + 1]);
      const oldBlue = clampColor(buffer[bufferIndex + 2]);

      const redLevel = oldRed >> 5;
      const greenLevel = oldGreen >> 5;
      const blueLevel = oldBlue >> 6;

      const newRed = Math.round((redLevel * 255) / 7);
      const newGreen = Math.round((greenLevel * 255) / 7);
      const newBlue = Math.round((blueLevel * 255) / 3);

      indices[pixelIndex] = (redLevel << 5) | (greenLevel << 2) | blueLevel;

      const errorRed = oldRed - newRed;
      const errorGreen = oldGreen - newGreen;
      const errorBlue = oldBlue - newBlue;

      if (leftToRight) {
        distributeQuantizeError(buffer, width, height, x + 1, y, errorRed, errorGreen, errorBlue, (7 / 16) * DITHER_STRENGTH);
        distributeQuantizeError(buffer, width, height, x - 1, y + 1, errorRed, errorGreen, errorBlue, (3 / 16) * DITHER_STRENGTH);
        distributeQuantizeError(buffer, width, height, x, y + 1, errorRed, errorGreen, errorBlue, (5 / 16) * DITHER_STRENGTH);
        distributeQuantizeError(buffer, width, height, x + 1, y + 1, errorRed, errorGreen, errorBlue, (1 / 16) * DITHER_STRENGTH);
      } else {
        distributeQuantizeError(buffer, width, height, x - 1, y, errorRed, errorGreen, errorBlue, (7 / 16) * DITHER_STRENGTH);
        distributeQuantizeError(buffer, width, height, x + 1, y + 1, errorRed, errorGreen, errorBlue, (3 / 16) * DITHER_STRENGTH);
        distributeQuantizeError(buffer, width, height, x, y + 1, errorRed, errorGreen, errorBlue, (5 / 16) * DITHER_STRENGTH);
        distributeQuantizeError(buffer, width, height, x - 1, y + 1, errorRed, errorGreen, errorBlue, (1 / 16) * DITHER_STRENGTH);
      }
    }
  }

  return indices;
}

function distributeQuantizeError(buffer, width, height, x, y, errorRed, errorGreen, errorBlue, factor) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }

  const bufferIndex = (y * width + x) * 3;
  buffer[bufferIndex] += errorRed * factor;
  buffer[bufferIndex + 1] += errorGreen * factor;
  buffer[bufferIndex + 2] += errorBlue * factor;
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
  
  /*function quantizeToRgb332(imageData) {
    const source = imageData.data;
    const indices = new Uint8Array(imageData.width * imageData.height);

    for (let sourceIndex = 0, outputIndex = 0; outputIndex < indices.length; sourceIndex += 4, outputIndex += 1) {
      if (source[sourceIndex + 3] < 128) {
        indices[outputIndex] = 0;
        continue;
      }

      const red = source[sourceIndex] >> 5;
      const green = source[sourceIndex + 1] >> 5;
      const blue = source[sourceIndex + 2] >> 6;
      indices[outputIndex] = (red << 5) | (green << 2) | blue;
    }

    return indices;
  }*/

  function lzwEncode(indices) {
    const clearCode = 1 << LZW_MIN_CODE_SIZE;
    const endCode = clearCode + 1;
    const writer = new ByteWriter();
    let codeSize = LZW_MIN_CODE_SIZE + 1;
    let nextCode = endCode + 1;
    let bitBuffer = 0;
    let bitCount = 0;
    let dictionary = new Map();

    function writeCode(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;

      while (bitCount >= 8) {
        writer.writeByte(bitBuffer & 0xff);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    }

    function resetDictionary() {
      dictionary = new Map();
      codeSize = LZW_MIN_CODE_SIZE + 1;
      nextCode = endCode + 1;
    }

    writeCode(clearCode);

    if (indices.length === 0) {
      writeCode(endCode);
      return flushBits(writer, bitBuffer, bitCount);
    }

    let prefix = indices[0];

    for (let i = 1; i < indices.length; i += 1) {
      const index = indices[i];
      const key = (prefix << 8) | index;
      const existingCode = dictionary.get(key);

      if (existingCode !== undefined) {
        prefix = existingCode;
        continue;
      }

      writeCode(prefix);

      if (nextCode < 4096) {
        dictionary.set(key, nextCode);
        nextCode += 1;

        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize += 1;
        }
      } else {
        writeCode(clearCode);
        resetDictionary();
      }

      prefix = index;
    }

    writeCode(prefix);
    writeCode(endCode);
    return flushBits(writer, bitBuffer, bitCount);
  }

  function flushBits(writer, bitBuffer, bitCount) {
    if (bitCount > 0) {
      writer.writeByte(bitBuffer & 0xff);
    }

    return writer.toUint8Array();
  }

  function clampDelay(value) {
    return Math.max(1, Math.min(65535, Math.round(Number(value) || 50)));
  }

  root.encodeGif = encodeGif;
})(typeof self !== 'undefined' ? self : globalThis);
