/* ============================================================
   Insan — Service Worker  v9  (background notifications + sync)
   ============================================================
   Notifications are triggered by the app via postMessage
   (SHOW_NOTIFICATION). No VAPID / Web Push subscription needed.
   ============================================================ */

var CACHE_NAME = 'insan-v11';
var APP_VERSION = '1.1.0';
var ICON  = 'icons/insan.png';
var BADGE = 'icons/insan.png';

var APP_SHELL = [
  './', './index.html', './styles.css', './app.js',
  './supabase-config.js', './languages.js', './manifest.json',
  './icons/insan.png'
];

/* ════════════════════════════════════════════════════════════
   INSTALL
   ════════════════════════════════════════════════════════════ */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(APP_SHELL.map(function(url) {
        return new Request(url, { cache: 'no-cache' });
      })).catch(function(err) { console.warn('[SW] Partial cache fail:', err); });
    }).then(function() { return self.skipWaiting(); })
  );
});

/* ════════════════════════════════════════════════════════════
   ACTIVATE
   ════════════════════════════════════════════════════════════ */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
    .then(function() { return clients.claim(); })
    .then(function() {
      return clients.matchAll({ type: 'window' }).then(function(list) {
        list.forEach(function(c) {
          c.postMessage({ type: 'SW_UPDATED', version: APP_VERSION });
        });
      });
    })
  );
});

/* ════════════════════════════════════════════════════════════
   FETCH  (network-first, cache fallback)
   ════════════════════════════════════════════════════════════ */
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.includes('supabase.co') ||
      url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com') ||
      url.includes('cdn.jsdelivr.net') ||
      url.includes('ui-avatars.com')) return;

  e.respondWith(
    Promise.race([
      fetch(e.request).then(function(res) {
        if (res && res.status === 200) {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      }),
      new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('timeout')); }, 4000);
      })
    ]).catch(function() {
      return caches.match(e.request).then(function(cached) {
        return cached || caches.match('./index.html');
      });
    })
  );
});

/* ════════════════════════════════════════════════════════════
   NOTIFICATION CLICK
   ════════════════════════════════════════════════════════════ */
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var nd  = e.notification.data || {};
  var act = e.action;

  // Decline: just close
  if (act === 'dismiss' || act === 'decline') {
    // Optionally tell open tab to send busy signal
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      list.forEach(function(c) {
        c.postMessage({ type: 'CALL_DECLINED_FROM_NOTIF', chatId: nd.convId });
      });
    });
    return;
  }

  var targetUrl = nd.url || self.location.origin;
  var msgType   = (act === 'answer') ? 'CALL_ANSWER_FROM_NOTIF' : 'NOTIF_CLICK';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      // Try to find an already-open app window
      var appWindow = null;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.startsWith(self.location.origin)) {
          appWindow = c;
          break;
        }
      }

      if (appWindow) {
        // App is open — focus it and send the action
        return appWindow.focus().then(function() {
          appWindow.postMessage({
            type    : msgType,
            convId  : nd.convId,
            convType: nd.convType,
            callData: nd.callData,  // pass full SDP so app can answer immediately
          });
        });
      } else {
        // App is closed — open it, passing call data via URL hash so the
        // page can auto-answer after initialising
        var openUrl = targetUrl;
        if (act === 'answer' && nd.callData) {
          // Encode call data in sessionStorage via SW can't, so use URL param
          openUrl = targetUrl + '?incoming_call=' + encodeURIComponent(JSON.stringify(nd.callData));
        }
        return clients.openWindow(openUrl).then(function(newClient) {
          // newClient may be null in some browsers; page will read URL param itself
        });
      }
    })
  );
});

self.addEventListener('notificationclose', function(e) {
  // User swiped away a call notification — treat as decline
  var nd = e.notification.data || {};
  if (nd.type === 'call') {
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      list.forEach(function(c) {
        c.postMessage({ type: 'CALL_DISMISSED_FROM_NOTIF', chatId: nd.convId });
      });
    });
  }
});

/* ════════════════════════════════════════════════════════════
   BACKGROUND SYNC
   ════════════════════════════════════════════════════════════ */
self.addEventListener('sync', function(e) {
  if (e.tag === 'insan-keepalive' || e.tag === 'insan-bg-sync') {
    e.waitUntil(
      clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function(list) {
        list.forEach(function(c) { c.postMessage({ type: 'SW_RECONNECT' }); });
      })
    );
  }
});

/* ════════════════════════════════════════════════════════════
   PERIODIC BACKGROUND SYNC
   ════════════════════════════════════════════════════════════ */
self.addEventListener('periodicsync', function(e) {
  if (e.tag === 'insan-heartbeat') {
    e.waitUntil(
      clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function(list) {
        list.forEach(function(c) {
          c.postMessage({ type: 'SW_RECONNECT', ts: Date.now() });
        });
      })
    );
  }
});

/* ════════════════════════════════════════════════════════════
   MESSAGES FROM PAGE
   ════════════════════════════════════════════════════════════ */
self.addEventListener('message', function(e) {
  if (!e.data) return;
  var d = e.data;

  if (d.type === 'SHOW_NOTIFICATION') {
    var isCall = d.isCall === true;
    self.registration.showNotification(d.title || 'Insan', {
      body    : d.body || 'New message',
      icon    : ICON,
      badge   : BADGE,
      tag     : d.tag || ('insan-' + Date.now()),
      renotify: true,
      silent  : false,
      vibrate : isCall ? [500, 200, 500, 200, 500] : (d.vibrate ? [200, 100, 200] : []),
      requireInteraction: isCall,
      data: {
        type    : isCall ? 'call' : 'message',
        convId  : d.convId   || null,
        convType: d.convType || 'chat',
        callData: d.callData || null,
        url     : self.location.origin,
      },
      actions: isCall
        ? [{ action: 'answer', title: '✅ Answer' }, { action: 'decline', title: '❌ Decline' }]
        : [{ action: 'open',   title: 'Open'      }, { action: 'dismiss', title: 'Dismiss'   }],
    }).catch(function(){});
  }

  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); }

  if (d.type === 'PING') {
    if (e.source) e.source.postMessage({ type: 'PONG', ts: Date.now() });
    clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function(list) {
      list.forEach(function(c) {
        c.postMessage({ type: 'SW_HEARTBEAT', ts: Date.now() });
      });
    });
  }

  if (d.type === 'SCHEDULE_RECONNECT') {
    var delay = (typeof d.delayMs === 'number' && d.delayMs > 0) ? d.delayMs : 30000;
    setTimeout(function() {
      clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function(list) {
        list.forEach(function(c) {
          c.postMessage({ type: 'SW_RECONNECT', ts: Date.now() });
        });
      });
    }, delay);
  }
});
