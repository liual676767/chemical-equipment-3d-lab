/** 目录导航临时状态：只用于浏览器前进/后退与站内返回，不写入长期学习记录。 */

export interface CatalogNavState {
  q: string;
  cat: string;
  fav: boolean;
  scrollY: number;
  triggerDeviceId: string | null;
}

const SESSION_KEY = 'chem3d-catalog-nav:v1';
const PENDING_DEVICE_KEY = 'chem3d-catalog-pending-device:v1';
const RETURN_FLAG = 'chem3d-catalog-return:v1';

function sanitize(value: unknown): CatalogNavState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.q !== 'string' || typeof raw.cat !== 'string') return null;
  return {
    q: raw.q,
    cat: raw.cat,
    fav: !!raw.fav,
    scrollY: Math.max(0, Number(raw.scrollY) || 0),
    triggerDeviceId: typeof raw.triggerDeviceId === 'string' ? raw.triggerDeviceId : null
  };
}

export function readCatalogState(): CatalogNavState | null {
  const fromHistory = sanitize((history.state as Record<string, unknown> | null)?.catalog);
  if (fromHistory) return fromHistory;
  try {
    if (sessionStorage.getItem(RETURN_FLAG) === '1') {
      sessionStorage.removeItem(RETURN_FLAG);
      return sanitize(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null'));
    }
  } catch { /* 会话存储不可用时按无状态处理 */ }
  return null;
}

export function writeCatalogState(state: CatalogNavState) {
  const next = { ...(history.state && typeof history.state === 'object' ? history.state : {}), catalog: state };
  history.replaceState(next, '', location.href);
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch { /* 忽略 */ }
}

/** 从目录进入设备前记录：状态写入当前历史条目，并留下待确认的设备 ID。 */
export function rememberCatalogDeparture(state: CatalogNavState, deviceId: string) {
  writeCatalogState({ ...state, triggerDeviceId: deviceId });
  try { sessionStorage.setItem(PENDING_DEVICE_KEY, deviceId); } catch { /* 忽略 */ }
}

/** 设备页挂载时确认这次进入确实来自目录，供站内「设备库」返回判断。 */
export function markDeviceEntry(deviceId: string) {
  let pending: string | null = null;
  try {
    pending = sessionStorage.getItem(PENDING_DEVICE_KEY);
    sessionStorage.removeItem(PENDING_DEVICE_KEY);
  } catch { /* 忽略 */ }
  if (pending !== deviceId) return;
  const next = { ...(history.state && typeof history.state === 'object' ? history.state : {}), fromCatalog: true };
  history.replaceState(next, '', location.href);
}

/** 站内返回：来自目录时优先使用浏览器后退，保留该目录条目的状态。 */
export function returnToCatalog() {
  const fromCatalog = !!(history.state as Record<string, unknown> | null)?.fromCatalog;
  if (fromCatalog && history.length > 1) {
    history.back();
    return;
  }
  if (fromCatalog) {
    try { sessionStorage.setItem(RETURN_FLAG, '1'); } catch { /* 忽略 */ }
  }
  location.hash = '#/library';
}

export function clearCatalogSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(PENDING_DEVICE_KEY);
    sessionStorage.removeItem(RETURN_FLAG);
  } catch { /* 忽略 */ }
}
