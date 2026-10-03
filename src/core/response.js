'use strict';

// Handlers return one of these shapes; the transport layer turns them into HTTP.
const send = (status, body) => ({ status, body });
const ok = (body) => send(200, body);
const created = (body) => send(201, body);
const noContent = () => ({ status: 204 });
/** Stream a file from disk: { path, filename, contentType } */
const sendFile = (file) => ({ status: 200, file });

module.exports = { send, ok, created, noContent, sendFile };
