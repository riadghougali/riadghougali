// أدوات مشتركة بين تطبيق الزبون وتطبيق السائق
const STATUS_LABEL = {
  pending: 'في الانتظار',
  accepted: 'الشاحنة جاية',
  arrived: 'الشاحنة وصلت',
  done: 'تمّ التوصيل',
  cancelled: 'ملغي',
};

// مركز افتراضي للخريطة (الجزائر) إذا ما لقيناش GPS
const DEFAULT_CENTER = [36.75, 3.06];

function makeMap(el, center = DEFAULT_CENTER, zoom = 13) {
  const map = L.map(el, { zoomControl: true }).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  return map;
}

function icon(emoji, size = 34) {
  return L.divIcon({
    html: `<div style="font-size:${size}px;line-height:1;transform:translate(-50%,-90%)">${emoji}</div>`,
    className: '',
    iconSize: [0, 0],
  });
}

// المسافة بالكيلومتر
function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtKm(km) {
  if (km == null) return '';
  return km < 1 ? `${Math.round(km * 1000)} متر` : `${km.toFixed(1)} كم`;
}
function fmtTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'دروك';
  if (m < 60) return `قبل ${m} دقيقة`;
  return `قبل ${Math.round(m / 60)} ساعة`;
}
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}
function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(val));
  } catch {
    return null;
  }
}
