// سقّاية — خادم التطبيق
// يخدم صفحة الزبون (/) وصفحة السائق (/driver) ويوصل بيناتهم مباشرة عبر Socket.IO
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
// رمز الدخول لتطبيق السائق — بدّلو في الإنتاج
const DRIVER_CODE = process.env.DRIVER_CODE || '1234';
// سعر 100 لتر بالدينار (0 = ما يبانش السعر)
const PRICE_PER_100L = Number(process.env.PRICE_PER_100L || 0);

const DATA_FILE = path.join(__dirname, 'data', 'orders.json');
const STATUSES = ['pending', 'accepted', 'arrived', 'done', 'cancelled'];

// ---------- التخزين ----------
let orders = {};
try {
  orders = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  orders = {};
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
  }, 200);
}

// السائقين المتصلين: socketId -> { id, name, phone, lat, lng, available }
const drivers = new Map();

// ---------- أدوات ----------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

function publicDriver(d) {
  if (!d) return null;
  return { id: d.id, name: d.name, phone: d.phone, lat: d.lat, lng: d.lng };
}
function driverById(id) {
  for (const d of drivers.values()) if (d.id === id) return d;
  return null;
}
function orderView(o) {
  const { token, driverInfo, ...rest } = o; // الرمز السري ما يخرجش للسائقين
  return { ...rest, driver: o.driverId ? publicDriver(driverById(o.driverId)) || o.driverInfo : null };
}
function activeOrders() {
  return Object.values(orders)
    .filter((o) => o.status === 'pending' || o.status === 'accepted' || o.status === 'arrived')
    .map(orderView);
}

// ---------- الخادم ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.get('/driver', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'driver.html')));
app.get('/api/config', (_req, res) => res.json({ pricePer100L: PRICE_PER_100L }));

const server = http.createServer(app);
const io = new Server(server);

function broadcastToDrivers() {
  io.to('drivers').emit('orders', activeOrders());
}
function notifyOrder(o) {
  io.to('order:' + o.id).emit('order', orderView(o));
  broadcastToDrivers();
}

io.on('connection', (socket) => {
  // ===== الزبون =====
  socket.on('order:create', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const liters = Math.round(Number(data?.liters));
    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    const name = clean(data?.name, 60);
    const phone = clean(data?.phone, 20);
    if (!name || !/^[0-9+\s]{8,20}$/.test(phone)) return reply({ error: 'دخّل الاسم ورقم الهاتف صحاح' });
    if (!(liters >= 20 && liters <= 20000)) return reply({ error: 'الكمية لازم تكون بين 20 و 20000 لتر' });
    if (!isNum(lat) || !isNum(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return reply({ error: 'حدّد موقعك على الخريطة' });

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(16).toString('hex'); // يسمح للزبون وحدو يلغي طلبو
    orders[id] = {
      id,
      name,
      phone,
      liters,
      lat,
      lng,
      note: clean(data?.note, 200),
      price: PRICE_PER_100L ? Math.round((liters / 100) * PRICE_PER_100L) : null,
      status: 'pending',
      driverId: null,
      driverInfo: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      token,
    };
    save();
    socket.join('order:' + id);
    reply({ order: orderView(orders[id]), token });
    io.to('drivers').emit('order:new', orderView(orders[id]));
    broadcastToDrivers();
  });

  socket.on('order:watch', (id, ack) => {
    const o = orders[id];
    if (typeof ack !== 'function') return;
    if (!o) return ack({ error: 'الطلب ما كانش' });
    socket.join('order:' + id);
    ack({ order: orderView(o) });
  });

  socket.on('order:cancel', ({ id, token } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const o = orders[id];
    if (!o || o.token !== token) return reply({ error: 'ما تقدرش تلغي هاد الطلب' });
    if (o.status !== 'pending' && o.status !== 'accepted') return reply({ error: 'الطلب ما يتلغاش دروك' });
    o.status = 'cancelled';
    o.updatedAt = Date.now();
    save();
    notifyOrder(o);
    reply({ ok: true });
  });

  // ===== السائق =====
  socket.on('driver:login', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (clean(data?.code, 50) !== DRIVER_CODE) return reply({ error: 'رمز الدخول غالط' });
    const name = clean(data?.name, 60);
    const phone = clean(data?.phone, 20);
    if (!name || !phone) return reply({ error: 'دخّل الاسم ورقم الهاتف' });
    const id = 'd_' + crypto.createHash('sha1').update(phone).digest('hex').slice(0, 12);
    drivers.set(socket.id, { id, name, phone, lat: null, lng: null });
    socket.join('drivers');
    reply({ driverId: id, orders: activeOrders() });
  });

  socket.on('driver:location', (pos) => {
    const d = drivers.get(socket.id);
    if (!d || !isNum(pos?.lat) || !isNum(pos?.lng)) return;
    d.lat = pos.lat;
    d.lng = pos.lng;
    // نبعثو موقع الشاحنة للزبائن لي قبلهم هاد السائق
    for (const o of Object.values(orders)) {
      if (o.driverId === d.id && (o.status === 'accepted' || o.status === 'arrived')) {
        io.to('order:' + o.id).emit('driver:location', { lat: d.lat, lng: d.lng });
      }
    }
  });

  socket.on('order:status', ({ id, status } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const d = drivers.get(socket.id);
    const o = orders[id];
    if (!d) return reply({ error: 'سجّل الدخول من جديد' });
    if (!o || !STATUSES.includes(status)) return reply({ error: 'طلب غير صالح' });

    const allowed = {
      accepted: o.status === 'pending',
      arrived: o.status === 'accepted' && o.driverId === d.id,
      done: (o.status === 'accepted' || o.status === 'arrived') && o.driverId === d.id,
      pending: (o.status === 'accepted' || o.status === 'arrived') && o.driverId === d.id, // السائق يرجع الطلب
    };
    if (!allowed[status]) return reply({ error: 'ما تقدرش تدير هاد العملية (يمكن سائق آخر قبلو)' });

    if (status === 'accepted') {
      o.driverId = d.id;
      o.driverInfo = publicDriver(d);
    }
    if (status === 'pending') {
      o.driverId = null;
      o.driverInfo = null;
    }
    o.status = status;
    o.updatedAt = Date.now();
    save();
    notifyOrder(o);
    reply({ ok: true });
  });

  socket.on('disconnect', () => drivers.delete(socket.id));
});

// نحيّد الطلبات القدام (أكثر من 24 ساعة) لي ما كملوش
setInterval(() => {
  const limit = Date.now() - 24 * 3600 * 1000;
  let changed = false;
  for (const o of Object.values(orders)) {
    if ((o.status === 'pending' || o.status === 'accepted') && o.createdAt < limit) {
      o.status = 'cancelled';
      changed = true;
    }
  }
  if (changed) {
    save();
    broadcastToDrivers();
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`سقّاية راهي تخدم على http://localhost:${PORT}`);
  console.log(`  تطبيق الزبون:  http://localhost:${PORT}/`);
  console.log(`  تطبيق السائق: http://localhost:${PORT}/driver   (رمز الدخول: ${DRIVER_CODE === '1234' ? '1234 — بدّلو بـ DRIVER_CODE' : 'من DRIVER_CODE'})`);
});
