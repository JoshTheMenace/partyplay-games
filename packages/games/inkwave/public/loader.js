const query = new URLSearchParams(location.search), roundId = query.get('round'), screen = query.get('screen');
import(`./engine/built/${screen === 'sound' ? 'sound' : screen ? 'menus' : 'platform'}.js`).catch(error => {
  const message = `Unable to load Inkwave: ${error.message}. Check the connection and retry.`;
  document.getElementById('loading').textContent = message;
  parent.postMessage({ channel: 'partyplay-inkwave', roundId, type: 'error', message }, location.origin);
});
