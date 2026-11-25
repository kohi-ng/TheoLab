export function connectMcpEvents(serverUrl, onEvent) {
  const url = new URL(serverUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('MCP URL must use HTTP or HTTPS.');
  }
  const source = new EventSource(url);
  source.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      onEvent({ type: 'text', data: event.data });
    }
  };
  source.onerror = () => onEvent({ type: 'error', message: 'MCP connection interrupted.' });
  return () => source.close();
}

export async function postMcpMessage(serverUrl, message) {
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`MCP server returned HTTP ${response.status}.`);
  return response.json();
}
