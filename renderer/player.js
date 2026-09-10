/**
 * Wraps hls.js and mpegts.js to play IPTV streams.
 * Auto-detects stream type from URL and content.
 *
 * IPTV streams drop constantly, so every load is watched: library errors and
 * silent stalls both feed the recovery ladder in stream-recovery.js.
 */
import {
  planRecovery,
  stallTimeoutMs,
  STALL_POLL_MS,
  STABLE_PLAYBACK_MS,
  MAX_ATTEMPTS,
} from './stream-recovery.js';
import { redactUrl } from './redact.js';

export class Player {
  constructor(videoEl) {
    this.video = videoEl;
    this._hls = null;
    this._mpegts = null;
    this._url = null;
    this._engine = null;
    this._attempt = 0;
    this._retryTimer = null;
    this._stallTimer = null;
    this._lastTime = 0;
    this._lastProgressAt = 0;
    this._recoveredAt = 0;
    this._lastDropped = 0;
    this._lastBufferedEnd = 0;
    this._hasPlayed = false;
  }

  load(url) {
    this._destroy();
    this._url = url;
    // A new channel starts with a clean budget and its own startup grace;
    // a reconnect inherits both from the channel it is recovering.
    this._attempt = 0;
    this._hasPlayed = false;
    this._start(url);
  }

  _start(url) {
    if (isHLS(url)) {
      this._engine = 'hls';
      this._loadHLS(url);
    } else if (isNativeMedia(url)) {
      // Plain VOD files the browser plays natively (mp4/webm/etc) — don't
      // hand these to mpegts.js, which only demuxes MPEG-TS.
      this._engine = 'native';
      this._loadNative(url);
    } else {
      // IPTV direct streams are almost always MPEG-TS
      this._engine = 'mpegts';
      this._loadMPEGTS(url);
    }
    this._startStallWatch();
  }

  _loadNative(url) {
    this.video.src = url;
    this.video.play().catch((e) => console.error('Native play failed:', e));
  }

  _loadHLS(url) {
    if (window.Hls && window.Hls.isSupported()) {
      this._hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 60,
      });
      this._hls.loadSource(url);
      this._hls.attachMedia(this.video);
      this._hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.video.play().catch(() => {});
      });
      this._hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        console.error('HLS fatal error:', data.type, data.details);
        this._recover(hlsKind(data.type));
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      this.video.src = url;
      this.video.play().catch(() => {});
    }
  }

  _loadMPEGTS(url) {
    if (!window.mpegts || !window.mpegts.isSupported()) {
      console.warn('mpegts.js not supported, falling back to native src');
      this._engine = 'native';
      this.video.src = url;
      this.video.play().catch((e) => console.error('Native play failed:', e));
      return;
    }

    console.log('Loading via mpegts.js:', redactUrl(url));
    this._mpegts = window.mpegts.createPlayer({
      type: 'mpegts',
      url,
      isLive: true,
    }, {
      enableWorker: true,
      workerChunkSize: 8192,
      // Buffer enough to absorb network jitter without chasing latency aggressively
      liveBufferLatencyChasing: false,
      liveBufferLatencyMaxLatency: 10.0,
      liveBufferLatencyMinRemain: 4.0,
      lazyLoadMaxDuration: 3 * 60,
      seekType: 'range',
      // Larger IO buffer reduces stalls on variable-bitrate streams
      stashInitialSize: 1024 * 512,
    });
    this._mpegts.on(window.mpegts.Events.ERROR, (type, details) => {
      console.error('mpegts error:', type, details);
      this._recover(mpegtsKind(type));
    });
    // mpegts.js reconnects early EOFs by itself without raising an error, so
    // this is the only way to see that class of drop from out here.
    this._mpegts.on(window.mpegts.Events.RECOVERED_EARLY_EOF, () => {
      console.warn('[diag] mpegts recovered an early EOF on its own');
    });
    this._mpegts.attachMediaElement(this.video);
    this._mpegts.load();
    this._mpegts.play().catch((e) => console.error('mpegts play failed:', e));
  }

  // --- Recovery ---

  _recover(kind) {
    // Both libraries can fire several errors for one drop, and the watchdog can
    // fire alongside them. Let the scheduled attempt play out first.
    if (this._retryTimer) return;

    this._attempt += 1;
    const plan = planRecovery({ engine: this._engine, kind, attempt: this._attempt });

    if (plan.action === 'give-up') {
      console.error(
        `Stream recovery gave up after ${MAX_ATTEMPTS} attempts:`,
        redactUrl(this._url),
      );
      this._stopStallWatch();
      return;
    }

    console.warn(
      `Stream ${kind} error, recovery attempt ${this._attempt}/${MAX_ATTEMPTS} ` +
      `via ${plan.action} in ${plan.delayMs}ms`,
    );
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._applyRecovery(plan);
    }, plan.delayMs);
  }

  _applyRecovery(plan) {
    if (!this._url) return; // stopped while the retry was pending

    this._recoveredAt = Date.now();
    this._lastProgressAt = this._recoveredAt;

    switch (plan.action) {
      case 'resume-load':
        if (this._hls) this._hls.startLoad();
        break;
      case 'recover-media':
        if (!this._hls) break;
        if (plan.swapAudioCodec) this._hls.swapAudioCodec();
        this._hls.recoverMediaError();
        break;
      case 'reload':
        this._teardownEngines();
        this._start(this._url);
        break;
    }
  }

  // --- Stall watchdog ---
  //
  // A dead IPTV stream often just stops sending bytes: no error reaches either
  // library, the <video> element never fires `error`, and the last frame sits
  // frozen. Watching currentTime is the only reliable signal.

  _startStallWatch() {
    this._stopStallWatch();
    this._lastTime = this.video.currentTime;
    this._lastDropped = 0;
    this._lastBufferedEnd = this._bufferedEnd();
    this._lastProgressAt = Date.now();
    this._stallTimer = setInterval(() => this._checkStall(), STALL_POLL_MS);
  }

  _stopStallWatch() {
    clearInterval(this._stallTimer);
    this._stallTimer = null;
  }

  _checkStall() {
    const now = Date.now();
    this._sampleDroppedFrames();

    // A user-paused, seeking or finished stream is not a stall.
    if (this.video.paused || this.video.seeking || this.video.ended) {
      this._lastProgressAt = now;
      return;
    }

    const bufferedEnd = this._bufferedEnd();
    const bufferGrowing = bufferedEnd > this._lastBufferedEnd;
    this._lastBufferedEnd = bufferedEnd;

    if (this.video.currentTime > this._lastTime) {
      this._lastTime = this.video.currentTime;
      this._lastProgressAt = now;
      this._hasPlayed = true;
      // Sustained playback means the stream is healthy again, so the next drop
      // gets a full budget rather than inheriting the old attempt count.
      if (this._attempt > 0 && now - this._recoveredAt >= STABLE_PLAYBACK_MS) {
        this._attempt = 0;
      }
      return;
    }

    const timeout = stallTimeoutMs({ hasPlayed: this._hasPlayed, bufferGrowing });
    if (now - this._lastProgressAt >= timeout) {
      console.warn(`[diag] stall after ${timeout}ms — ${this._bufferSnapshot()}`);
      this._recover('stall');
    }
  }

  _bufferedEnd() {
    const { buffered } = this.video;
    return buffered.length ? buffered.end(buffered.length - 1) : 0;
  }

  // Distinguishes a starved stream (buffer ends at currentTime) from one wedged
  // against a gap in the buffer (another range starts just ahead of it). The
  // two look identical from currentTime alone but need opposite fixes.
  _bufferSnapshot() {
    const { buffered, currentTime, readyState } = this.video;
    const ranges = [];
    for (let i = 0; i < buffered.length; i += 1) {
      ranges.push(`${buffered.start(i).toFixed(2)}-${buffered.end(i).toFixed(2)}`);
    }
    return `currentTime=${currentTime.toFixed(2)} readyState=${readyState} `
      + `buffered=${ranges.length ? ranges.join(' | ') : '(empty)'}`;
  }

  // Corrupted frames still advance currentTime, so the stall watchdog cannot
  // see them. Dropped frames are the closest available proxy for the packet
  // loss that causes them. Diagnostic only — nothing acts on this yet.
  _sampleDroppedFrames() {
    if (typeof this.video.getVideoPlaybackQuality !== 'function') return;
    const { droppedVideoFrames } = this.video.getVideoPlaybackQuality();
    const dropped = droppedVideoFrames - this._lastDropped;
    this._lastDropped = droppedVideoFrames;
    if (dropped > 0) {
      console.warn(`[diag] ${dropped} video frames dropped in the last ${STALL_POLL_MS}ms`);
    }
  }

  // --- Teardown ---

  /** Drops the player libraries but keeps the URL and attempt count. */
  _teardownEngines() {
    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }
    if (this._mpegts) {
      this._mpegts.destroy();
      this._mpegts = null;
    }
    // removeAttribute rather than src = '', which makes Chromium resolve the
    // empty string against the page URL and fire a spurious media error.
    this.video.removeAttribute('src');
    this.video.load();
  }

  _destroy() {
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._stopStallWatch();
    this._teardownEngines();
    this._url = null;
    this._engine = null;
  }
}

function hlsKind(type) {
  const types = window.Hls.ErrorTypes;
  if (type === types.NETWORK_ERROR) return 'network';
  if (type === types.MEDIA_ERROR) return 'media';
  return 'other';
}

function mpegtsKind(type) {
  const types = window.mpegts.ErrorTypes;
  if (type === types.NETWORK_ERROR) return 'network';
  if (type === types.MEDIA_ERROR) return 'media';
  return 'other';
}

function isHLS(url) {
  return url.includes('.m3u8') || url.includes('type=m3u8');
}

// Containers Chromium plays natively — match on the path, ignoring any query string.
function isNativeMedia(url) {
  const path = url.split('?')[0].toLowerCase();
  return /\.(mp4|m4v|mov|webm|ogv|ogg)$/.test(path);
}
