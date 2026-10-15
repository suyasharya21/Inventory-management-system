import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

type SpeechPhase = 'checking' | 'idle' | 'requesting' | 'recording' | 'transcribing';
type SpeechStatus = { supported: boolean; engine: string; permission: string; private: boolean };

export function useSpeechInput(onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<SpeechPhase>('checking');
  const [status, setStatus] = useState<SpeechStatus>({ supported: false, engine: '', permission: 'unknown', private: true });
  const [error, setError] = useState('');
  const prefixRef = useRef('');
  const phaseRef = useRef<SpeechPhase>('checking');
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const contextRef = useRef<AudioContext | undefined>(undefined);
  const sourceRef = useRef<MediaStreamAudioSourceNode | undefined>(undefined);
  const processorRef = useRef<ScriptProcessorNode | undefined>(undefined);
  const muteRef = useRef<GainNode | undefined>(undefined);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(48000);
  const timerRef = useRef<number | undefined>(undefined);
  const changePhase = (next: SpeechPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    let active = true;
    void api.speech.status()
      .then((result) => {
        if (!active) return;
        setStatus(result);
        changePhase('idle');
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Voice typing could not be prepared.');
        changePhase('idle');
      });
    return () => {
      active = false;
      stopCapture();
    };
  }, []);

  const stopCapture = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    muteRef.current?.disconnect();
    processorRef.current = undefined;
    sourceRef.current = undefined;
    muteRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    if (contextRef.current && contextRef.current.state !== 'closed') void contextRef.current.close();
    contextRef.current = undefined;
  };

  const stop = async () => {
    if (phaseRef.current !== 'recording') return;
    const chunks = chunksRef.current;
    const sampleRate = sampleRateRef.current;
    stopCapture();
    changePhase('transcribing');
    setError('');
    try {
      const samples = flatten(chunks);
      if (samples.length < sampleRate * 0.3) throw new Error('The recording was too short. Speak for a moment, then press stop.');
      const wav = encodeWav(resample(samples, sampleRate, 16000), 16000);
      const result = await api.speech.transcribe({
        audio: wav.buffer,
        language: navigator.language || 'en',
        prompt: prefixRef.current,
      });
      onTranscript([prefixRef.current, result.transcript.trim()].filter(Boolean).join(' '));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Voice typing could not transcribe this recording.');
    } finally {
      chunksRef.current = [];
      changePhase('idle');
    }
  };

  const start = async (existingText = '') => {
    if (!status.supported || !navigator.mediaDevices?.getUserMedia) {
      setError('On-device voice typing is not available in this build.');
      return;
    }
    prefixRef.current = existingText.trim();
    chunksRef.current = [];
    setError('');
    changePhase('requesting');
    try {
      const permission = await api.speech.requestPermission();
      if (!permission.granted) throw new Error('Microphone access is off. Enable StockSense in System Settings > Privacy & Security > Microphone, then restart the app.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (event) => chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      streamRef.current = stream;
      contextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;
      muteRef.current = mute;
      sampleRateRef.current = context.sampleRate;
      changePhase('recording');
      timerRef.current = window.setTimeout(() => void stop(), 15000);
    } catch (reason) {
      stopCapture();
      setError(formatCaptureError(reason));
      changePhase('idle');
    }
  };

  const supported = status.supported && Boolean(navigator.mediaDevices?.getUserMedia);
  return {
    supported,
    listening: phase === 'recording',
    transcribing: phase === 'requesting' || phase === 'transcribing',
    checking: phase === 'checking',
    engine: status.engine,
    error,
    start,
    stop,
  };
}

function flatten(chunks: Float32Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function resample(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return input;
  const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeText(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(view, 8, 'WAVE');
  writeText(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Uint8Array(buffer);
}

function writeText(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function formatCaptureError(reason: unknown) {
  if (reason instanceof DOMException && (reason.name === 'NotAllowedError' || reason.name === 'SecurityError')) {
    return 'Microphone access is off. Enable StockSense in System Settings > Privacy & Security > Microphone, then restart the app.';
  }
  if (reason instanceof DOMException && reason.name === 'NotFoundError') return 'No microphone was found. Connect a microphone and try again.';
  return reason instanceof Error ? reason.message : 'The microphone could not be started.';
}
