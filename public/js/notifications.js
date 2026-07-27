// ============================================================
// 🔔 Notification Sounds System
// Uses Web Audio API - no external files needed
// ============================================================

const NotificationSounds = {
  audioCtx: null,

  _getCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioCtx;
  },

  // 🔔 New consultation arrived - for consultants
  newConsultation() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;

    // Chime sound - ascending tone
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.4);
    });

    // Vibrato effect
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.value = 880;
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now + 0.8);

    console.log('🔔 [Sound] استشارة جديدة');
  },

  // 💬 New reply in consultation
  newReply() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;

    // Short double beep
    [800, 1000].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.2);
      gain.gain.linearRampToValueAtTime(0.25, now + i * 0.2 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.2 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.2);
      osc.stop(now + i * 0.2 + 0.25);
    });

    console.log('💬 [Sound] رد جديد');
  },

  // 🔒 Consultation closed by client - special notification for consultant
  consultationClosed() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;

    // Descending tone - "whoosh" close effect
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.6);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.8);

    // Low thud
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 80;
    gain2.gain.setValueAtTime(0.3, now + 0.6);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.6);
    osc2.stop(now + 1.0);

    console.log('🔒 [Sound] استشارة مغلقة');
  },

  // ⚠️ Warning sound - for phone number detection
  warning() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;

    // Harsh buzz
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.2, now + i * 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.2 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.2);
      osc.stop(now + i * 0.2 + 0.12);
    }

    console.log('⚠️ [Sound] تحذير');
  },

  // ✅ Sound test
  test() {
    this.newConsultation();
    setTimeout(() => this.newReply(), 1000);
    setTimeout(() => this.consultationClosed(), 2200);
    console.log('🔊 اختبار الأصوات...');
  }
};

// ============================================================
// 📱 Phone Number Filter
// ============================================================
const PhoneFilter = {
  // Saudi + international phone patterns
  patterns: [
    /05\d{8}/g,                    // 0500000000
    /9665\d{8}/g,                  // 966500000000
    /\+9665\d{8}/g,                // +966500000000
    /05[\s\-]?\d{3}[\s\-]?\d{4}/g, // 05 123 4567 or 05-123-4567
    /9665[\s\-]?\d{3}[\s\-]?\d{4}/g,
    /\+\d{10,15}/g,                // Any international: +1234567890123
    /\b\d{9,10}\b/g,               // 9-10 digit plain numbers
  ],

  // Check text for phone numbers
  check(text) {
    if (!text) return { found: false, matches: [] };
    
    const matches = [];
    this.patterns.forEach(re => {
      const found = text.match(re);
      if (found) {
        found.forEach(m => {
          // Only count it as a phone number if it looks like a real phone
          // (skip short numbers that might be part of regular text)
          const digitsOnly = m.replace(/[\s\-\+]/g, '');
          if (digitsOnly.length >= 9) {
            matches.push(m.trim());
          }
        });
      }
    });

    return {
      found: matches.length > 0,
      matches: [...new Set(matches)] // deduplicate
    };
  },

  // Highlight phone numbers in text
  highlight(text) {
    let result = text;
    this.patterns.forEach(re => {
      result = result.replace(re, match => {
        const digits = match.replace(/[\s\-\+]/g, '');
        if (digits.length >= 9) {
          return `<span class="bg-danger text-white px-1 rounded">${match}</span>`;
        }
        return match;
      });
    });
    return result;
  }
};

// ============================================================
// 🔄 Real-time notification checker
// ============================================================
const NotificationChecker = {
  interval: null,
  isRunning: false,
  lastCheck: Date.now(),
  checkUrl: '/messages/notifications',

  start(intervalMs = 15000) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🔔 بدء مراقبة الإشعارات (كل ' + (intervalMs / 1000) + ' ثانية)');
    
    this.check();
    this.interval = setInterval(() => this.check(), intervalMs);
  },

  stop() {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('🔔 إيقاف مراقبة الإشعارات');
  },

  async check() {
    try {
      const response = await fetch(this.checkUrl + '?since=' + this.lastCheck);
      const data = await response.json();
      
      if (data.notifications && data.notifications.length > 0) {
        data.notifications.forEach(n => {
          if (n.type === 'new_consultation' || n.title?.includes('استشارة جديدة')) {
            NotificationSounds.newConsultation();
          } else if (n.type === 'new_reply' || n.title?.includes('رد')) {
            NotificationSounds.newReply();
          } else if (n.type === 'closed' || n.title?.includes('إغلاق') || n.title?.includes('مغلقة')) {
            NotificationSounds.consultationClosed();
          } else if (n.type === 'warning' || n.title?.includes('رقم جوال') || n.title?.includes('تحذير')) {
            NotificationSounds.warning();
          }
        });
      }

      this.lastCheck = data.now || Date.now();
    } catch (err) {
      // Silently fail - don't spam console
    }
  }
};

// Auto-start if role is consultant and on dashboard
document.addEventListener('DOMContentLoaded', function() {
  const userRole = document.body.dataset.role;
  const isConsultant = userRole === 'consultant';
  const isOnDashboard = window.location.pathname.includes('/consultant') || 
                        window.location.pathname.includes('/client/consultation-detail');

  if (isConsultant && isOnDashboard) {
    NotificationChecker.start(10000); // Check every 10 seconds
  }

  // Sound test button handler
  const testBtn = document.getElementById('soundTestBtn');
  if (testBtn) {
    testBtn.addEventListener('click', () => NotificationSounds.test());
  }
});
