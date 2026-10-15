import { app, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function runtimeRoot() {
  return app.isPackaged ? join(process.resourcesPath, 'speech') : join(app.getAppPath(), 'speech', 'runtime');
}

function enginePaths() {
  const root = runtimeRoot();
  if (process.platform === 'darwin') {
    return { binary: join(root, 'bin', 'stocksense-stt'), model: join(root, 'models', 'ggml-base.bin'), engine: 'stocksense-helper' };
  }
  if (process.platform === 'win32') {
    return { binary: join(root, 'win32', 'bin', 'whisper-cli.exe'), model: join(root, 'models', 'ggml-base.bin'), engine: 'whisper-cli' };
  }
  return { binary: '', model: '', engine: '' };
}

function microphoneStatus() {
  if (process.platform === 'darwin' || process.platform === 'win32') return systemPreferences.getMediaAccessStatus('microphone');
  return 'unknown';
}

export const speechService = {
  status() {
    const paths = enginePaths();
    const engineAvailable = Boolean(paths.binary && paths.model && existsSync(paths.binary) && existsSync(paths.model));
    return {
      supported: engineAvailable,
      engine: engineAvailable ? 'On-device Whisper' : 'Unavailable',
      permission: microphoneStatus(),
      private: true,
    };
  },

  async requestPermission() {
    if (process.platform === 'darwin') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return { granted, permission: microphoneStatus() };
    }
    return { granted: microphoneStatus() !== 'denied', permission: microphoneStatus() };
  },

  async transcribe({ audio, language = 'en', prompt = '' }) {
    const status = speechService.status();
    if (!status.supported) throw new Error('The on-device speech engine is not installed for this platform.');
    const payload = Buffer.from(audio);
    if (payload.length < 44) throw new Error('No microphone audio was recorded.');
    if (payload.length > 12 * 1024 * 1024) throw new Error('The recording is too long. Keep voice entries under 15 seconds.');
    const paths = enginePaths();
    const fileName = 'stocksense-speech-' + process.pid + '-' + Date.now() + '.wav';
    const filePath = join(app.getPath('temp'), fileName);
    const outputBasePath = filePath.slice(0, -4);
    const transcriptPath = `${outputBasePath}.txt`;
    writeFileSync(filePath, payload, { mode: 0o600 });
    try {
      const inventoryPrompt = [
        'Inventory entry. Examples: sold five Coca-Cola bottles; damaged two Surf Excel packs; restock twenty Tata Salt packs.',
        String(prompt || '').trim(),
      ].filter(Boolean).join(' ');
      let transcript = '';
      if (paths.engine === 'whisper-cli') {
        const { stdout } = await execFileAsync(paths.binary, [
          '--model', paths.model,
          '--file', filePath,
          '--language', String(language || 'en').split('-')[0],
          '--prompt', inventoryPrompt,
          '--output-txt',
          '--output-file', outputBasePath,
          '--no-timestamps',
          '--no-prints',
          '--no-gpu',
        ], {
          cwd: dirname(paths.binary),
          timeout: 90000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });
        transcript = existsSync(transcriptPath) ? readFileSync(transcriptPath, 'utf8').trim() : String(stdout || '').trim();
      } else {
        const { stdout } = await execFileAsync(paths.binary, [paths.model, filePath, String(language || 'en').split('-')[0], inventoryPrompt], {
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        });
        transcript = String(stdout || '').trim();
      }
      if (!transcript) throw new Error('No speech was detected. Move closer to the microphone and try again.');
      return { transcript, engine: status.engine, private: true };
    } catch (error) {
      if (error?.killed || error?.signal) throw new Error('Speech transcription took too long. Try a shorter command.');
      throw new Error(error instanceof Error ? error.message : 'Speech transcription failed.');
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
      if (existsSync(transcriptPath)) unlinkSync(transcriptPath);
    }
  },
};
