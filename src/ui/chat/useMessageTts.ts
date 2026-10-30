/**
 * Per-message voice playback: the device cache scan, the download-and-cache
 * click law, and the transport. The voice comes from the sidebar.
 */
import { useState, useEffect, useCallback } from 'react';
import type { ChapterTurns, Turn } from '../../types';
import { logger } from '../../utils/logger';
import { ttsTransport } from '../context/ttsTransport';
import { tts } from '../../gateway/api';
import { getModelForSlot } from '../../data/modelConfig';
import { ttsDeviceKey, getCachedTtsBlob, storeTtsAudio, hasCachedTts } from '../../data/ttsDeviceCache';

export function useMessageTts(chapters: ChapterTurns[], chosenVoice: string, online: boolean) {
  // ChatView only plays back with the voice chosen in the sidebar.
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  // Which messages have their audio ON THIS DEVICE (the offline playback set)?
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  // Download failures must be VISIBLE — a silent no-op click is the bug David
  // hit ("I had to click like 4 times to get the download to start").
  const [ttsFailedIds, setTtsFailedIds] = useState<Set<string>>(new Set());
  const ttsModelId = getModelForSlot('tts');
  // Rescan when the thread, the voice, or the tts model changes. The signature
  // (ids + voice + model) keeps the IDB scan from rerunning on every render.
  const cachedScanSig = `${chapters.map((c) => c.turns.map((t) => t.id).join(',')).join('|')}|${chosenVoice}|${ttsModelId}`;
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = new Set<string>();
      for (const grp of chapters) {
        for (const t of grp.turns) {
          if (!t.content) continue;
          if (await hasCachedTts(await ttsDeviceKey(ttsModelId, chosenVoice, t.content))) next.add(t.id);
        }
      }
      if (alive) setCachedIds(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedScanSig]);

  const stopPlayback = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    ttsTransport.end();
    setPlayingMessageId(null);
  }, []);

  // A thread/view switch unmounts the feed while audio may still be playing:
  // idle the transport, or the sidebar card shows a track that no longer
  // exists.
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      ttsTransport.end();
    };
  }, []);

  const handlePlayTTS = async (message: Turn) => {
    if (playingMessageId === message.id) {
      stopPlayback();
      return;
    }
    const model = getModelForSlot('tts');
    const key = await ttsDeviceKey(model, chosenVoice, message.content);

    // David's law (2026-10-29): the device copy is the ONLY playback source.
    // First click downloads and caches; the second plays with zero network.
    const cached = await getCachedTtsBlob(key);
    if (cached) {
      const playFromCache = async () => {
        try {
          await ttsTransport.playDeviceBlob(cached, message.id, () => {
            setPlayingMessageId(null);
            ttsTransport.end();
          });
          setPlayingMessageId(message.id);
          logger.action('ChatView', 'TTS playback started from device cache', {
            messageId: message.id,
            blobSize: cached.size,
            blobType: cached.type,
            duration: null,
          });
        } catch (err) {
          logger.warn('ChatView', 'Cached audio playback failed', err);
          ttsTransport.end();
        }
      };
      void playFromCache();
      return;
    }

    // Not on the device yet: this click DOWNLOADS AND CACHES (server
    // generates on MISS, serves its disk cache on HIT). It does not play —
    // the second click plays from the device.
    if (!online) {
      logger.warn('ChatView', 'Audio not cached on this device and offline — downloading needs a connection');
      return;
    }
    setTtsLoadingId(message.id);
    ttsTransport.begin(message.id);
    setTtsFailedIds((prev) => {
      const n = new Set(prev);
      n.delete(message.id);
      return n;
    });
    try {
      const res = await tts({
        text: message.content,
        voice: chosenVoice,
        model,
      });
      if (!res.ok) {
        let serverError = `HTTP ${res.status}`;
        try {
          const errBody = await res.json();
          if (typeof errBody?.error === 'string' && errBody.error) {
            serverError = errBody.error;
          }
        } catch {
          /* non-JSON error body */
        }
        throw new Error(serverError);
      }
      const contentType = res.headers.get('content-type') || '';
      if (contentType.startsWith('audio/ogg')) {
        // 21F: the server did the encode — take the bytes, store them here.
        const blob = await res.blob();
        await storeTtsAudio(key, blob);
        setCachedIds((prev) => new Set(prev).add(message.id));
        ttsTransport.end();
        logger.action('ChatView', 'TTS audio downloaded and cached on device', { messageId: message.id });
        return;
      }

      // Local/direct backend answers JSON PCM (base64 in JSON). The law is
      // absolute — must be cached to play — so this click DOWNLOADS AND
      // CACHES the PCM as a blob too. The second click plays it.
      const data = await res.json();
      if (!data.audioData) {
        throw new Error(typeof data.error === 'string' ? data.error : 'no audio in TTS response');
      }
      const bytes = Uint8Array.from(atob(data.audioData), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: data.mimeType || 'audio/wav' });
      await storeTtsAudio(key, blob);
      setCachedIds((prev) => new Set(prev).add(message.id));
      ttsTransport.end();
      logger.action('ChatView', 'TTS audio downloaded and cached on device', { messageId: message.id });
    } catch (err) {
      // Download failed: SAY SO. Nothing plays un-cached — no speech
      // fallback here, because playing would break the two-click law.
      logger.warn('ChatView', 'TTS download failed — audio is not on this device', err);
      ttsTransport.end();
      setTtsFailedIds((prev) => new Set(prev).add(message.id));
    } finally {
      setTtsLoadingId(null);
    }
  };

  return { playingMessageId, ttsLoadingId, cachedIds, ttsFailedIds, handlePlayTTS };
}
