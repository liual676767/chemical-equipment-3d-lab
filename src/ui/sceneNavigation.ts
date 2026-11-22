function state(): Record<string, unknown> {
  return history.state && typeof history.state === 'object' ? history.state : {};
}

export function openSceneDevice(event: MouseEvent, deviceId: string, snapshot: unknown) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const origin = location.hash || '#/';
  history.replaceState({ ...state(), sceneSnapshot: snapshot }, '', location.href);
  history.pushState({ origin }, '', '#/device/' + deviceId);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function workbenchOrigin(): string | null {
  const origin = state().origin;
  return typeof origin === 'string' && /^#\/(?:$|(?:node|pipe|zone|detail|practice|task|plant|boil)(?:\/|$))/.test(origin)
    ? origin : null;
}

export function sceneSnapshot(): unknown {
  return state().sceneSnapshot;
}
