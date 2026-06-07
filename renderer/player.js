/**
 * Wraps hls.js and mpegts.js to play IPTV streams.
 * Auto-detects stream type from URL and content.
 */
export class Player {
  constructor(videoEl) {
    this.video = videoEl;
    this._hls = null;
    this._mpegts = null;
  }

  load(url) {
    this._destroy();

    if (isHLS(url)) {
      this._loadHLS(url);
    } else {
      // IPTV direct streams are almost always MPEG-TS
      this._loadMPEGTS(url);
    }
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
        if (data.fatal) {
          console.error('HLS fatal error:', data.type, data.details);
        }
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
      this.video.src = url;
      this.video.play().catch((e) => console.error('Native play failed:', e));
      return;
    }

    console.log('Loading via mpegts.js:', url);
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
    this._mpegts.on(window.mpegts.Events.ERROR, (type, info) => {
      console.error('mpegts error:', type, info);
    });
    this._mpegts.attachMediaElement(this.video);
    this._mpegts.load();
    this._mpegts.play().catch((e) => console.error('mpegts play failed:', e));
  }

  _destroy() {
    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }
    if (this._mpegts) {
      this._mpegts.destroy();
      this._mpegts = null;
    }
    this.video.src = '';
  }
}

function isHLS(url) {
  return url.includes('.m3u8') || url.includes('type=m3u8');
}

function isMPEGTS(url) {
  return (
    url.includes('.ts') ||
    url.includes('output=ts') ||
    url.includes('type=ts')
  );
}
