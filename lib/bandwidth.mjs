import WebSocket, { WebSocketServer } from 'ws';

export function attachBandwidth(server, { allowed, authenticate, settings, endpoint, maxStreams = 2, perUser = false }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32_000, perMessageDeflate: false,
    handleProtocols: () => 'call-coach' });
  server.on('upgrade', (req, socket, head) => {
    const protocols = (req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
    if (req.url !== '/api/stt' || !allowed(req) || !req.headers.origin || !protocols.includes('call-coach')) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    authenticate(req).then(session => {
      if (socket.destroyed) return;
      if (!session || !protocols.includes(`csrf.${session.csrfToken}`)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      if (!settings.key('bandwidth') || wss.clients.size >= maxStreams ||
          (perUser && [...wss.clients].some(client => client.ospreyUserId === session.user.id))) {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return;
      }
      wss.handleUpgrade(req, socket, head, client => {
        client.ospreyUserId = session.user.id; client.ospreySessionHash = session.hash;
        wss.emit('connection', client, req, session);
      });
    }).catch(() => { if (!socket.destroyed) socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); });
  });
  wss.revokeSession = hash => { if (hash) for (const client of wss.clients) if (client.ospreySessionHash === hash) client.close(1008, 'Signed out'); };
  wss.on('connection', (client, req, session) => {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries({ encoding: 'linear16', sample_rate: '16000', channels: '1', mode: 'instant' })) url.searchParams.set(key, value);
    const upstream = new WebSocket(url, { headers: { 'X-BW-LABS-API-KEY': settings.key('bandwidth') },
      handshakeTimeout: 10_000, maxPayload: 512_000, followRedirects: false });
    let ready = false, closing = false, ended = false;
    let closeTimer;
    const expiryTimer = session.expiresAt ? setTimeout(() => client.close(1008, 'Session expired'), Math.max(1, session.expiresAt - Date.now())) : null;
    const authTimer = perUser ? setInterval(async () => {
      try { if (!await authenticate(req)) client.close(1008, 'Session expired'); }
      catch { client.close(1011, 'Session unavailable'); }
    }, 60_000) : null;
    const send = data => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
    };
    const fail = message => {
      if (ended) return;
      ended = true;
      send({ type: 'Error', message });
      client.close(1011, 'Speech connection ended');
      upstream.terminate();
    };
    const openingTimer = setTimeout(() => fail('Bandwidth did not become ready. Try again.'), 15_000);
    const keepAlive = setInterval(() => {
      if (ready && !closing && upstream.readyState === WebSocket.OPEN) upstream.send('{"type":"KeepAlive"}');
    }, 25_000);
    upstream.on('message', (raw, binary) => {
      if (binary) return;
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return fail('Bandwidth returned an invalid response.'); }
      if (event.type === 'SessionOpened') { ready = true; clearTimeout(openingTimer); send({ type: 'SessionOpened' }); }
      if (event.type === 'Segment' && typeof event.text === 'string') {
        if (client.bufferedAmount > 256_000) return fail('Transcript delivery is too slow. Restart listening.');
        send({ type: 'Segment', text: event.text, start: event.start, end: event.end });
      }
      if (event.type === 'SessionClosed') {
        ended = true; send({ type: 'SessionClosed' }); client.close(1000); upstream.close(1000);
      }
      if (event.type === 'Error') fail('Bandwidth could not transcribe this stream. Check the key and try again.');
    });
    upstream.on('unexpected-response', (_req, res) => {
      res.resume();
      fail(res.statusCode === 401 || res.statusCode === 403 ? 'Bandwidth rejected the API key. Update it in Settings.' : 'Bandwidth is unavailable. Try again later.');
    });
    upstream.on('error', () => fail('Could not connect to Bandwidth. Check the key and your connection.'));
    upstream.on('close', () => { if (!ended) fail('Bandwidth disconnected before transcription finished. Restart listening.'); });
    client.on('message', (raw, binary) => {
      if (closing || ended) return;
      if (!ready) return fail('Audio arrived before Bandwidth was ready.');
      if (binary) {
        if (raw.length < 640 || raw.length > 32_000 || raw.length % 2) return fail('Invalid audio frame. Restart listening.');
        if (upstream.bufferedAmount > 256_000) return fail('The speech connection is too slow. Restart listening.');
        upstream.send(raw, { binary: true });
      } else {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return fail('Invalid speech control message.'); }
        if (message.type !== 'CloseStream') return fail('Unknown speech control message.');
        closing = true;
        upstream.send('{"type":"CloseStream"}');
        closeTimer = setTimeout(() => fail('Bandwidth did not finish the transcript in time.'), 10_000);
      }
    });
    const cleanup = () => {
      ended = true;
      clearTimeout(openingTimer); clearTimeout(closeTimer); clearInterval(keepAlive); clearTimeout(expiryTimer); clearInterval(authTimer);
      if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
    };
    client.on('close', cleanup);
    client.on('error', cleanup);
  });
  return wss;
}
