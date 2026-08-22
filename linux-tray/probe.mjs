import { pathToFileURL } from 'node:url';


export function pickMainTarget(targets) {
  return targets.find((target) => target?.type === 'page' && target?.title === 'Steam');
}


export function normalizeProbe({ steam, main, button }) {
  return {
    steam_available: Boolean(steam),
    main_available: Boolean(main),
    button_present: Boolean(button),
  };
}


async function evaluateButton(webSocketUrl, timeoutMs = 2500) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('CDP evaluation timed out'));
    }, timeoutMs);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: '!!document.getElementById("booster-checkout__booster-topup")',
          returnByValue: true,
        },
      }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(Boolean(message.result?.result?.value));
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP websocket failed'));
    });
  });
}


export async function probe(port = 8080) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`CDP returned ${response.status}`);
    const targets = await response.json();
    const mainTarget = pickMainTarget(targets);
    if (!mainTarget?.webSocketDebuggerUrl) {
      return normalizeProbe({ steam: true, main: false, button: false });
    }
    const button = await evaluateButton(mainTarget.webSocketDebuggerUrl);
    return normalizeProbe({ steam: true, main: true, button });
  } catch {
    return normalizeProbe({ steam: false, main: false, button: false });
  }
}


async function main() {
  const port = Number.parseInt(process.env.SB_CDP_PORT || '8080', 10);
  process.stdout.write(`${JSON.stringify(await probe(port))}\n`);
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
