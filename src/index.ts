// Loose implementation of https://github.com/acoustid/chromaprint/blob/56002095f2c4d7557b63f37c551f0dc445cf3202/src/cmd/fpcalc.cpp
import createChromaprintModule from "./chromaprint.js";

const Module = await createChromaprintModule();

export enum ChromaprintAlgorithm {
  Test1 = 0,
  Test2,
  Test3,
  Test4,
  Test5,
  Default = ChromaprintAlgorithm.Test2,
}

interface Config {
  /**
   * @default 120
   */
  maxDuration: number;
  /**
   * @default: 0
   */
  chunkDuration: number;
  /**
   * @default {ChromaprintAlgorithm.Default}
   */
  algorithm: ChromaprintAlgorithm;
  /**
   * @default false
   */
  rawOutput: boolean;
  /**
   * @default false
   */
  overlap: boolean;
}

const defaultConfig: Config = {
  maxDuration: 120,
  chunkDuration: 0,
  algorithm: ChromaprintAlgorithm.Default,
  rawOutput: false,
  overlap: false,
};

function getFingerprint(config: Config, ctx: number) {
  if (config.rawOutput) {
    // Get raw fingerprint
    const sizePtr = Module._malloc(4);
    if (!Module._chromaprint_get_raw_fingerprint_size(ctx, sizePtr)) {
      throw new Error("Could not get fingerprinting size");
    }
    const size = Module.HEAP32[sizePtr / 4];
    Module._free(sizePtr);

    if (size <= 0) {
      throw new Error("Empty fingerprint");
    }

    const dataPtr = Module._malloc(4);
    if (!Module._chromaprint_get_raw_fingerprint(ctx, dataPtr, sizePtr)) {
      throw new Error("Could not get the fingerprint");
    }
    const rawDataPtr = Module.HEAP32[dataPtr / 4];

    const rawData = [];
    for (let i = 0; i < size; i++) {
      rawData.push(Module.HEAP32[(rawDataPtr + i * 4) / 4]);
    }

    Module._free(dataPtr);
    return rawData.join(",");
  } else {
    // Get compressed fingerprint
    const fpPtr = Module._malloc(4);
    if (!Module._chromaprint_get_fingerprint(ctx, fpPtr)) {
      throw new Error("Failed to get fingerprint");
    }

    const fp = Module.UTF8ToString(Module.HEAP32[fpPtr / 4]);
    Module._free(fpPtr);
    return fp;
  }
}

/**
 * Generates fingerprint(s) from given file.\
 * With default configuration it will yield at most one fingerprint.
 */
export async function* processAudioFile(
  file: ArrayBuffer,
  config: Config = defaultConfig
): AsyncGenerator<string> {
  try {
    // Decode audio using Web Audio API
    const audioBuffer = await decodeAudioFile(file);

    console.log(audioBuffer.duration);

    // Convert to the format expected by Chromaprint (16-bit PCM)
    const pcmData = convertPcmF32ToI16(audioBuffer);

    // Create Chromaprint context
    const ctx = Module._chromaprint_new(1);
    if (!ctx) {
      throw new Error("Failed to create Chromaprint context");
    }

    try {
      // Start fingerprinting
      const sampleRate = audioBuffer.sampleRate;
      const channels = audioBuffer.numberOfChannels;

      if (!Module._chromaprint_start(ctx, sampleRate, channels)) {
        throw new Error("Failed to start fingerprinting");
      }

      // Process audio data
      yield* processAudioData(config, ctx, pcmData, sampleRate, channels);
    } finally {
      // Clean up
      Module._chromaprint_free(ctx);
    }
  } catch (error) {
    throw new Error(
      `Failed processing file: ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

declare global {
  var webkitAudioContext: AudioContext | undefined;
}

async function decodeAudioFile(buffer: ArrayBuffer) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return await audioContext.decodeAudioData(buffer);
}

function convertPcmF32ToI16(
  config: Config,
  audioBuffer: AudioBuffer
): Int16Array {
  const numberOfChannels = audioBuffer.numberOfChannels;

  const length = Math.min(
    audioBuffer.length,
    config.maxDuration * audioBuffer.sampleRate * audioBuffer.numberOfChannels
  );
  const pcmData = new Int16Array(length * numberOfChannels);

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      // Convert float32 [-1, 1] to int16 [-32768, 32767]
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      pcmData[i * numberOfChannels + channel] = sample * 32767;
    }
  }

  return pcmData;
}

async function* processAudioData(
  config: Config,
  ctx: number,
  pcmData: Int16Array,
  sampleRate: number,
  channels: number
): AsyncGenerator<string> {
  const maxSamples = config.maxDuration * sampleRate * channels;
  const chunkSamples =
    config.chunkDuration > 0 ? config.chunkDuration * sampleRate * channels : 0;

  let processedSamples = 0;
  let chunkCount = 0;

  // Allocate memory for audio data
  const dataPtr = Module._malloc(pcmData.length * 2); // 2 bytes per int16

  try {
    // Copy data to WASM memory
    Module.HEAP16.set(pcmData, dataPtr / 2);

    if (chunkSamples > 0) {
      // Process in chunks
      while (processedSamples < Math.min(pcmData.length, maxSamples)) {
        const remainingSamples = Math.min(
          pcmData.length - processedSamples,
          maxSamples - processedSamples
        );
        const currentChunkSamples = Math.min(chunkSamples, remainingSamples);

        // Feed audio data
        if (
          !Module._chromaprint_feed(
            ctx,
            dataPtr + processedSamples * 2,
            currentChunkSamples
          )
        ) {
          throw new Error("Failed to feed audio data");
        }

        processedSamples += currentChunkSamples;

        // Finish chunk
        if (!Module._chromaprint_finish(ctx)) {
          throw new Error("Failed to finish fingerprinting");
        }

        // Get and display result
        const fingerprint = getFingerprint(config, ctx);
        yield fingerprint;

        chunkCount++;

        // Prepare for next chunk
        if (processedSamples < Math.min(pcmData.length, maxSamples)) {
          if (config.overlap) {
            Module._chromaprint_clear_fingerprint(ctx);
          } else {
            Module._chromaprint_start(ctx, sampleRate, channels);
          }
        }
      }
    } else {
      // Process entire file
      const samplesToProcess = Math.min(pcmData.length, maxSamples);

      if (!Module._chromaprint_feed(ctx, dataPtr, samplesToProcess)) {
        throw new Error("Failed to feed audio data");
      }

      if (!Module._chromaprint_finish(ctx)) {
        throw new Error("Failed to finish fingerprinting");
      }

      const fingerprint = getFingerprint(config, ctx);
      yield fingerprint;
    }
  } finally {
    Module._free(dataPtr);
  }
}
