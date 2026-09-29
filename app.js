const $ = x => document.getElementById(x),
  S = { ws: null, a: [], run: false, start: 0, offset: 0, sel: null };

// Variables para el arrastre del mouse en el canvas
let isSelecting = false, selStart = null, selCurrent = null;

function badge(v) {
  $("badge").textContent = v ? "Conectado" : "Desconectado";
  $("badge").className = v ? "on" : "off";
  $("connect").disabled = v;
  $("disconnect").disabled = !v;
  $("start").disabled = !v || S.run;
  $("pause").disabled = !S.run;
}

function connect() {
  let ip = $("ip").value.trim(), port = $("port").value || 81;
  if (!ip) { $("status").textContent = "Escribe la IP del ESP32."; return; }
  S.ws = new WebSocket(`ws://${ip}:${port}`);
  S.ws.onopen = () => {
    badge(1);
    $("status").textContent = "Conectado por Wi-Fi/WebSocket.";
    S.ws.send("INTERVAL:" + $("interval").value);
  };
  S.ws.onclose = () => { badge(0); S.run = false; };
  S.ws.onerror = () => $("status").textContent = "Error de conexión.";
  S.ws.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "measurement") {
      $("distance").textContent = Number(m.distance_cm).toFixed(2);
      if (S.run) {
        let t = (performance.now() - S.start) / 1000;
        S.a.push({ t, d: +m.distance_cm });
        update();
        draw();
        fit();
      }
    }
  };
}

function start() { if (!S.ws) return; S.start = performance.now() - (S.offset || 0) * 1000; S.run = true; badge(1); }
function pause() { S.offset = (performance.now() - S.start) / 1000; S.run = false; badge(1); }
function clear() { S.a = []; S.offset = 0; S.sel = null; update(); draw(); fit(); }

// Retorna los datos activos (todos o el tramo seleccionado)
function getActiveData() {
  if (!S.sel) return S.a;
  return S.a.filter(p => p.t >= S.sel.tMin && p.t <= S.sel.tMax);
}

function update() {
  let data = getActiveData();
  let n = data.length;
  $("count").textContent = n;
  if (n) {
    $("time").textContent = data[n - 1].t.toFixed(2);
    $("avg").textContent = (data.reduce((s, p) => s + p.d, 0) / n).toFixed(2);
  } else {
    $("time").textContent = "0.00";
    $("avg").textContent = "—";
  }
  $("tbody").innerHTML = data.slice(-500).reverse().map((p, i) => `<tr><td>${n - i}</td><td>${p.t.toFixed(3)}</td><td>${p.d.toFixed(2)}</td></tr>`).join("");
  $("csv").disabled = !n;
}

function solve(A, b) {
  let n = b.length;
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k;
    [A[i], A[m]] = [A[m], A[i]];
    [b[i], b[m]] = [b[m], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) {
      let f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  let x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

function getFit() {
  let mode = $("degree").value;
  if (mode === "stats") return null; // No realiza ajuste polinómico si es opción "Estadística"
  
  let data = getActiveData();
  let d = +mode;
  if (data.length < d + 1) return null;
  let A = Array.from({ length: d + 1 }, () => Array(d + 1).fill(0)), b = Array(d + 1).fill(0);
  for (let p of data) {
    let q = Array(2 * d + 1).fill(0);
    q[0] = 1;
    for (let k = 1; k < q.length; k++) q[k] = q[k - 1] * p.t;
    for (let r = 0; r <= d; r++) {
      for (let c = 0; c <= d; c++) A[r][c] += q[r + c];
      b[r] += q[r] * p.d;
    }
  }
  return solve(A, b);
}

function poly(c, x) {
  let y = 0;
  for (let i = c.length - 1; i >= 0; i--) y = y * x + c[i];
  return y;
}

function fit() {
  let mode = $("degree").value;
  let data = getActiveData();

  if (mode === "stats") {
    // Mostrar vista de Estadística
    $("fit-panel").style.display = "none";
    $("stats-panel").style.display = "grid";
    $("analysis-title").textContent = "Estadística";

    if (data.length) {
      let sum = 0, max = -Infinity, min = Infinity;
      for (let p of data) {
        sum += p.d;
        if (p.d > max) max = p.d;
        if (p.d < min) min = p.d;
      }
      $("stat-avg").textContent = (sum / data.length).toFixed(2);
      $("stat-max").textContent = max.toFixed(2);
      $("stat-min").textContent = min.toFixed(2);
    } else {
      $("stat-avg").textContent = "—";
      $("stat-max").textContent = "—";
      $("stat-min").textContent = "—";
    }
    return;
  }

  // Mostrar vista de Ajuste de Curva
  $("fit-panel").style.display = "block";
  $("stats-panel").style.display = "none";
  $("analysis-title").textContent = "Ajuste de curva";

  let c = getFit();
  if (!c || !data.length) {
    $("equation").textContent = "Datos insuficientes.";
    $("r2").textContent = "—";
    $("rmse").textContent = "—";
    $("coeff").innerHTML = "";
    return;
  }
  let mean = data.reduce((s, p) => s + p.d, 0) / data.length, res = 0, tot = 0;
  for (let p of data) {
    res += (p.d - poly(c, p.t)) ** 2;
    tot += (p.d - mean) ** 2;
  }
  $("r2").textContent = (tot ? 1 - res / tot : 1).toFixed(6);
  $("rmse").textContent = Math.sqrt(res / data.length).toFixed(4);
  $("equation").textContent = c.map((v, i) => `${v.toExponential(6)}·t^${i}`).reverse().join(" + ");
  $("coeff").innerHTML = c.map((v, i) => `<div>a${i}: ${v.toExponential(8)}</div>`).reverse().join("");
}

function draw() {
  let c = $("chart"), r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
  c.width = r.width * d;
  c.height = r.height * d;
  let x = c.getContext("2d");
  x.scale(d, d);
  let W = r.width, H = r.height;
  x.fillStyle = "#0b1220";
  x.fillRect(0, 0, W, H);

  if (!S.a.length) {
    x.fillStyle = "#64748b";
    x.textAlign = "center";
    x.fillText("Esperando mediciones…", W / 2, H / 2);
    return;
  }

  let max = S.a.at(-1).t, min = Math.max(0, max - (+$("window").value || 120));
  let v = S.a.filter(p => p.t >= min);
  if (!v.length) v = S.a;
  
  let ys = v.map(p => p.d), lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo--; hi++; }
  let pad = (hi - lo) * .1;
  lo -= pad; hi += pad;

  let L = 55, R = 20, T = 15, B = 35;
  let px = t => L + (t - min) / Math.max(.001, max - min) * (W - L - R);
  let py = y => H - B - (y - lo) / (hi - lo) * (H - T - B);
  let invPx = xPos => min + ((xPos - L) / (W - L - R)) * (max - min);

  // Cuadrícula y Valores en el Eje Y
  x.strokeStyle = "#263244";
  x.fillStyle = "#94a3b8";
  x.font = "11px system-ui, sans-serif";
  x.textAlign = "right";
  x.textBaseline = "middle";

  for (let i = 0; i <= 5; i++) {
    let yy = T + (H - T - B) * i / 5;
    let yVal = hi - (hi - lo) * i / 5;
    x.beginPath();
    x.moveTo(L, yy);
    x.lineTo(W - R, yy);
    x.stroke();
    x.fillText(yVal.toFixed(1), L - 6, yy);
  }

  // Valores en el Eje X (Tiempo)
  x.textAlign = "center";
  x.textBaseline = "top";
  for (let i = 0; i <= 5; i++) {
    let xx = L + (W - L - R) * i / 5;
    let xVal = min + (max - min) * i / 5;
    x.beginPath();
    x.moveTo(xx, H - B);
    x.lineTo(xx, H - B + 4);
    x.stroke();
    x.fillText(xVal.toFixed(1) + "s", xx, H - B + 6);
  }

  // Trazar línea de datos completa
  x.strokeStyle = "#60a5fa";
  x.lineWidth = 2;
  x.beginPath();
  v.forEach((p, i) => i ? x.lineTo(px(p.t), py(p.d)) : x.moveTo(px(p.t), py(p.d)));
  x.stroke();

  // Sombreado del tramo fijado/seleccionado
  if (S.sel) {
    let x1 = px(S.sel.tMin), x2 = px(S.sel.tMax);
    x.fillStyle = "rgba(59, 130, 246, 0.15)";
    x.fillRect(Math.max(L, x1), T, Math.min(W - R, x2) - Math.max(L, x1), H - T - B);
  }

  // Ajuste de curva del tramo activo (si aplica)
  let co = getFit();
  if (co) {
    let activeData = getActiveData();
    if (activeData.length) {
      let tStart = S.sel ? S.sel.tMin : min;
      let tEnd = S.sel ? S.sel.tMax : max;
      x.strokeStyle = "#f59e0b";
      x.lineWidth = 2;
      x.setLineDash([7, 5]);
      x.beginPath();
      for (let i = 0; i <= 150; i++) {
        let t = tStart + (tEnd - tStart) * i / 150, y = poly(co, t);
        i ? x.lineTo(px(t), py(y)) : x.moveTo(px(t), py(y));
      }
      x.stroke();
      x.setLineDash([]);
    }
  }

  // Cuadro de selección en tiempo real con el mouse
  if (isSelecting && selStart && selCurrent) {
    let x1 = Math.min(selStart.x, selCurrent.x);
    let x2 = Math.max(selStart.x, selCurrent.x);
    x.fillStyle = "rgba(245, 158, 11, 0.25)";
    x.strokeStyle = "#f59e0b";
    x.lineWidth = 1;
    x.fillRect(x1, T, x2 - x1, H - T - B);
    x.strokeRect(x1, T, x2 - x1, H - T - B);
  }

  // Guardar función invPx para usar en eventos de mouse
  c._invPx = invPx;
  c._bounds = { L, R, W };
}

// Interacción con Mouse para Selección
let chartCanvas = $("chart");

chartCanvas.addEventListener("mousedown", e => {
  if (!S.a.length) return;
  let rect = chartCanvas.getBoundingClientRect();
  isSelecting = true;
  selStart = { x: e.clientX - rect.left };
  selCurrent = { x: e.clientX - rect.left };
});

chartCanvas.addEventListener("mousemove", e => {
  if (!isSelecting) return;
  let rect = chartCanvas.getBoundingClientRect();
  selCurrent = { x: e.clientX - rect.left };
  draw();
});

window.addEventListener("mouseup", e => {
  if (!isSelecting) return;
  isSelecting = false;
  if (selStart && selCurrent && chartCanvas._invPx) {
    let x1 = Math.min(selStart.x, selCurrent.x);
    let x2 = Math.max(selStart.x, selCurrent.x);
    if (Math.abs(x2 - x1) > 5) {
      let t1 = chartCanvas._invPx(x1);
      let t2 = chartCanvas._invPx(x2);
      S.sel = { tMin: Math.min(t1, t2), tMax: Math.max(t1, t2) };
      update();
      fit();
    }
  }
  selStart = null;
  selCurrent = null;
  draw();
});

$("connect").onclick = connect;
$("disconnect").onclick = () => S.ws?.close();
$("start").onclick = start;
$("pause").onclick = pause;
$("clear").onclick = clear;
$("interval").onchange = () => S.ws?.send("INTERVAL:" + $("interval").value);
$("degree").onchange = () => { fit(); draw(); };
$("window").oninput = draw;

$("csv").onclick = () => {
  let data = getActiveData();
  let s = [["tiempo_s", "distancia_cm"], ...data.map(p => [p.t.toFixed(6), p.d.toFixed(4)])].map(r => r.join(",")).join("\n"),
    a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([s], { type: "type/csv" }));
  a.download = "sr04t_wifi.csv";
  a.click();
};

onresize = draw;
badge(0);
draw();