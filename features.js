/* ============================================================
   SOLARIS v2 — weather.js
   Live Weather Integration via Open-Meteo API (no API key)
   Updates cloud cover for all 8 nodes with real data
   ============================================================ */
'use strict';

const WeatherAPI = (() => {
    const LOCATIONS = [
        { name: 'San Francisco', lat: 37.7749,  lon: -122.4194 },
        { name: 'New York',      lat: 40.7128,  lon: -74.0060  },
        { name: 'London',        lat: 51.5074,  lon: -0.1278   },
        { name: 'Tokyo',         lat: 35.6762,  lon: 139.6503  },
        { name: 'Sydney',        lat: -33.8688, lon: 151.2093  },
        { name: 'Mumbai',        lat: 19.0760,  lon: 72.8777   },
        { name: 'Cairo',         lat: 30.0444,  lon: 31.2357   },
        { name: 'Moscow',        lat: 55.7558,  lon: 37.6173   },
    ];

    // Cached weather data per node
    const _cache = new Map();
    let _lastFetch = 0;
    const CACHE_TTL = 600_000; // 10 minutes

    // Fetch weather for one location from Open-Meteo
    const fetchOne = async (loc) => {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=cloudcover,temperature_2m,weathercode,windspeed_10m&hourly=cloudcover,direct_radiation&forecast_days=1&timezone=auto`;
        try {
            const res  = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const curr = data.current;
            // Build 24h irradiance from hourly direct_radiation if available
            const hourlyRad = data.hourly?.direct_radiation || [];
            return {
                name:        loc.name,
                lat:         loc.lat,
                lon:         loc.lon,
                cloudCover:  curr.cloudcover    ?? 30,
                temperature: curr.temperature_2m ?? 25,
                windSpeed:   curr.windspeed_10m  ?? 5,
                weatherCode: curr.weathercode    ?? 0,
                hourlyRad:   hourlyRad.slice(0, 24),
                fetchedAt:   Date.now(),
            };
        } catch {
            // Fallback: return simulated values
            return {
                name:        loc.name,
                lat:         loc.lat,
                lon:         loc.lon,
                cloudCover:  10 + Math.random() * 60,
                temperature: 15 + Math.random() * 25,
                windSpeed:   3  + Math.random() * 15,
                weatherCode: 0,
                hourlyRad:   [],
                fetchedAt:   Date.now(),
                simulated:   true,
            };
        }
    };

    // Fetch all locations (staggered to avoid rate limiting)
    const fetchAll = async () => {
        const now = Date.now();
        if (now - _lastFetch < CACHE_TTL && _cache.size === LOCATIONS.length) {
            return Array.from(_cache.values());
        }
        _lastFetch = now;

        // Update HUD
        const hudApi = document.getElementById('hudApi');
        if (hudApi) hudApi.textContent = 'FETCHING...';

        const results = [];
        for (const loc of LOCATIONS) {
            const data = await fetchOne(loc);
            _cache.set(loc.name, data);
            results.push(data);
            await new Promise(r => setTimeout(r, 120)); // stagger 120ms
        }

        // Update UI badges
        const allSim = results.every(r => r.simulated);
        const wBadge = document.getElementById('weatherBadge');
        const wsHud  = document.getElementById('weatherStatus');
        if (wBadge) {
            wBadge.textContent = allSim ? '⚡ SIMULATED WEATHER' : '☀ LIVE WEATHER';
            wBadge.className = allSim ? 'badge-pill' : 'badge-pill success';
        }
        if (wsHud) wsHud.textContent = allSim ? 'WEATHER: SIMULATED' : 'WEATHER: LIVE';
        if (hudApi) hudApi.textContent = allSim ? 'SIMULATED' : 'OPEN-METEO';

        return results;
    };

    // Get cached data or fallback for a node by name
    const get = (name) => _cache.get(name) || null;

    // Map WMO weather codes to icons and descriptions
    const wmoToIcon = (code) => {
        if (code === 0)              return { icon: '☀', label: 'Clear' };
        if (code <= 3)               return { icon: '⛅', label: 'Partly Cloudy' };
        if (code <= 48)              return { icon: '☁', label: 'Foggy/Overcast' };
        if (code <= 67)              return { icon: '🌧', label: 'Rain' };
        if (code <= 77)              return { icon: '❄', label: 'Snow' };
        if (code <= 82)              return { icon: '🌧', label: 'Showers' };
        return                              { icon: '⛈', label: 'Thunderstorm' };
    };

    // Refresh on a 10-minute interval
    const startAutoRefresh = () => {
        fetchAll();
        setInterval(fetchAll, CACHE_TTL);
    };

    return { fetchAll, fetchOne, get, wmoToIcon, LOCATIONS, startAutoRefresh };
})();
/* ============================================================
   SOLARIS v2 — control.js
   Node Control Panel: toggle, threshold alerts,
   simulation mode sliders, maintenance logging
   STM-pattern state management mirrors Haskell backend
   ============================================================ */
'use strict';

const ControlPanel = (() => {

    // ── TVar-style state (mirrors Haskell STM) ──────────────
    const NodeState = new Map(); // name -> { online, threshold, alertAcked }
    const MaintenanceLog = [];   // { id, node, type, note, ts, effBefore, effAfter }
    const Alerts = [];           // { id, node, message, ts, acked }

    let simMode = false;
    let simParams = { cloud: 30, temp: 25, irrMult: 1.0 };

    const LOCATIONS = ['San Francisco','New York','London','Tokyo','Sydney','Mumbai','Cairo','Moscow'];

    // Initialize state for all nodes
    const init = () => {
        LOCATIONS.forEach(name => {
            NodeState.set(name, { online: true, threshold: 2.0, alertAcked: false });
        });
        populateMaintSelect();
        bindEvents();
        renderControlCards();
    };

    // ── Render control cards ────────────────────────────────
    const renderControlCards = (nodes = []) => {
        const grid = document.getElementById('controlGrid');
        if (!grid) return;

        grid.innerHTML = LOCATIONS.map((name, i) => {
            const st    = NodeState.get(name);
            const node  = nodes[i];
            const pwr   = node ? node.power.toFixed(2) : '--';
            const irr   = node ? node.irradiance : '--';
            const warn  = node && node.power < st.threshold && st.online;
            return `
            <div class="ctrl-card ${!st.online ? 'offline' : ''} ${warn ? 'warn' : ''}" data-node="${name}">
                <div class="ctrl-card-header">
                    <span class="ctrl-name">${name}</span>
                    <label class="toggle-switch">
                        <input type="checkbox" class="node-toggle" data-node="${name}" ${st.online ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                <div class="ctrl-power">${pwr} <span>kW</span></div>
                <div class="ctrl-irr">${irr} W/m²</div>
                <div class="ctrl-threshold">
                    <label>Alert below: <span class="thresh-val" id="thresh-${name.replace(/\s/g,'_')}">${st.threshold.toFixed(1)}</span> kW</label>
                    <input type="range" class="thresh-range" data-node="${name}"
                        min="0" max="10" step="0.1" value="${st.threshold}">
                </div>
                <div class="ctrl-status ${warn ? 'status-warn' : (st.online ? 'status-ok' : 'status-off')}">
                    ${!st.online ? '● OFFLINE' : warn ? '⚠ BELOW THRESHOLD' : '● NOMINAL'}
                </div>
                <button class="ctrl-maint-btn" data-node="${name}">LOG MAINTENANCE</button>
            </div>`;
        }).join('');

        // Bind toggle switches
        grid.querySelectorAll('.node-toggle').forEach(toggle => {
            toggle.addEventListener('change', e => {
                const name = e.target.dataset.node;
                const st   = NodeState.get(name);
                // Atomic write (STM pattern)
                atomicallyWriteNodeState(name, { ...st, online: e.target.checked });
                renderControlCards(nodes);
                if (!e.target.checked) addAlert(name, `${name} taken OFFLINE by operator`);
                else addAlert(name, `${name} brought ONLINE by operator`, 'info');
            });
        });

        // Bind threshold sliders
        grid.querySelectorAll('.thresh-range').forEach(slider => {
            slider.addEventListener('input', e => {
                const name  = e.target.dataset.node;
                const val   = parseFloat(e.target.value);
                const st    = NodeState.get(name);
                atomicallyWriteNodeState(name, { ...st, threshold: val });
                const label = document.getElementById(`thresh-${name.replace(/\s/g,'_')}`);
                if (label) label.textContent = val.toFixed(1);
            });
        });

        // Bind maintenance shortcut buttons
        grid.querySelectorAll('.ctrl-maint-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const name = e.target.dataset.node;
                openMaintFormFor(name);
            });
        });
    };

    // ── STM-style atomic write ──────────────────────────────
    const atomicallyWriteNodeState = (name, newState) => {
        NodeState.set(name, { ...NodeState.get(name), ...newState });
    };

    // ── Alert system ────────────────────────────────────────
    const addAlert = (node, message, type = 'warning') => {
        const alert = {
            id:   Date.now() + Math.random(),
            node, message, type,
            ts:   new Date().toLocaleTimeString(),
            acked: false,
        };
        Alerts.unshift(alert);
        if (Alerts.length > 50) Alerts.pop();
        renderAlertDrawer();
        updateAlertCount();
    };

    const renderAlertDrawer = () => {
        const list = document.getElementById('alertList');
        if (!list) return;
        const active = Alerts.filter(a => !a.acked);
        if (active.length === 0) {
            list.innerHTML = '<div class="alert-empty">No active alerts.</div>';
            return;
        }
        list.innerHTML = active.map(a => `
            <div class="alert-item ${a.type}" data-id="${a.id}">
                <div class="ai-top">
                    <span class="ai-node">${a.node}</span>
                    <span class="ai-time">${a.ts}</span>
                </div>
                <div class="ai-msg">${a.message}</div>
                <button class="ai-ack" data-id="${a.id}">ACK</button>
            </div>`).join('');

        list.querySelectorAll('.ai-ack').forEach(btn => {
            btn.addEventListener('click', e => {
                const id = parseFloat(e.target.dataset.id);
                const a  = Alerts.find(x => x.id === id);
                if (a) a.acked = true;
                renderAlertDrawer();
                updateAlertCount();
            });
        });
    };

    const updateAlertCount = () => {
        const count = Alerts.filter(a => !a.acked).length;
        const el    = document.getElementById('alertCount');
        if (el) {
            el.textContent = count;
            el.style.display = count > 0 ? 'flex' : 'none';
        }
    };

    // ── Maintenance Log ─────────────────────────────────────
    const populateMaintSelect = () => {
        const sel = document.getElementById('maintNode');
        if (!sel) return;
        sel.innerHTML = '<option value="">Select Node...</option>' +
            LOCATIONS.map(n => `<option value="${n}">${n}</option>`).join('');
    };

    const openMaintFormFor = (name) => {
        const form = document.getElementById('maintForm');
        const sel  = document.getElementById('maintNode');
        if (form) form.style.display = 'grid';
        if (sel) sel.value = name;
        form?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const submitMaintenance = () => {
        const node = document.getElementById('maintNode')?.value;
        const type = document.getElementById('maintType')?.value;
        const note = document.getElementById('maintNote')?.value || '';
        if (!node) return;

        const entry = {
            id:   Date.now(),
            node, type, note,
            ts:   new Date().toLocaleString(),
        };
        MaintenanceLog.unshift(entry);
        renderMaintLog();
        addAlert(node, `Maintenance logged: ${type} on ${node}`, 'info');

        // Hide form
        const form = document.getElementById('maintForm');
        if (form) form.style.display = 'none';
        if (document.getElementById('maintNote')) document.getElementById('maintNote').value = '';
    };

    const renderMaintLog = () => {
        const log = document.getElementById('maintLog');
        if (!log) return;
        if (MaintenanceLog.length === 0) {
            log.innerHTML = '<div class="maint-empty">No maintenance events logged yet.</div>';
            return;
        }
        log.innerHTML = MaintenanceLog.map(e => `
            <div class="maint-entry">
                <div class="me-header">
                    <span class="me-node">${e.node}</span>
                    <span class="me-type ${e.type}">${e.type.toUpperCase()}</span>
                    <span class="me-time">${e.ts}</span>
                </div>
                ${e.note ? `<div class="me-note">${e.note}</div>` : ''}
            </div>`).join('');
    };

    // ── Simulation mode ─────────────────────────────────────
    const toggleSimMode = () => {
        simMode = !simMode;
        const panel = document.getElementById('simPanel');
        const btn   = document.getElementById('simModeBtn');
        if (panel) panel.classList.toggle('active', simMode);
        if (btn) {
            btn.textContent = simMode ? '⚗ EXIT SIMULATION' : '⚗ SIMULATION MODE';
            btn.classList.toggle('accent', !simMode);
            btn.classList.toggle('danger', simMode);
        }
    };

    const getSimParams = () => simMode ? simParams : null;
    const isNodeOnline = (name) => NodeState.get(name)?.online ?? true;
    const getThreshold = (name) => NodeState.get(name)?.threshold ?? 2.0;

    // ── Bind all events ─────────────────────────────────────
    const bindEvents = () => {
        // Alert drawer toggle
        document.getElementById('alertBtn')?.addEventListener('click', () => {
            document.getElementById('alertDrawer')?.classList.toggle('open');
        });
        document.getElementById('alertClose')?.addEventListener('click', () => {
            document.getElementById('alertDrawer')?.classList.remove('open');
        });
        document.getElementById('acknowledgeAll')?.addEventListener('click', () => {
            Alerts.forEach(a => a.acked = true);
            renderAlertDrawer();
            updateAlertCount();
        });

        // Simulation mode
        document.getElementById('simModeBtn')?.addEventListener('click', toggleSimMode);

        ['simCloud','simTemp','simIrr'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                if (id === 'simCloud') { simParams.cloud = v; document.getElementById('simCloudVal').textContent = v; }
                if (id === 'simTemp')  { simParams.temp  = v; document.getElementById('simTempVal').textContent  = v; }
                if (id === 'simIrr')   { simParams.irrMult = v/100; document.getElementById('simIrrVal').textContent = (v/100).toFixed(2); }
            });
        });

        // All on / all off
        document.getElementById('allOnBtn')?.addEventListener('click', () => {
            LOCATIONS.forEach(n => atomicallyWriteNodeState(n, { ...NodeState.get(n), online: true }));
            renderControlCards();
        });
        document.getElementById('allOffBtn')?.addEventListener('click', () => {
            LOCATIONS.forEach(n => atomicallyWriteNodeState(n, { ...NodeState.get(n), online: false }));
            renderControlCards();
            addAlert('FLEET', 'All nodes taken offline by operator');
        });

        // Maintenance form
        document.getElementById('addMaintBtn')?.addEventListener('click', () => {
            const f = document.getElementById('maintForm');
            if (f) f.style.display = f.style.display === 'none' ? 'grid' : 'none';
        });
        document.getElementById('submitMaint')?.addEventListener('click', submitMaintenance);
        document.getElementById('cancelMaint')?.addEventListener('click', () => {
            const f = document.getElementById('maintForm');
            if (f) f.style.display = 'none';
        });
    };

    // ── Anomaly detection (pure function) ───────────────────
    const detectAnomalies = (nodes) => {
        const anomalies = [];
        nodes.forEach(node => {
            const expected = node._expectedPower ?? node.power;
            const actual   = node.power;
            const drop     = expected > 0 ? (expected - actual) / expected : 0;
            if (drop > 0.3 && node.irradiance > 100) {
                anomalies.push({ node: node.name, expected, actual, drop });
                addAlert(node.name,
                    `Anomaly: ${node.name} output ${(drop*100).toFixed(0)}% below expected (${actual.toFixed(1)} vs ${expected.toFixed(1)} kW)`
                );
            }
        });
        return anomalies;
    };

    // ── Check threshold alerts ───────────────────────────────
    const checkThresholds = (nodes) => {
        nodes.forEach(node => {
            const st = NodeState.get(node.name);
            if (!st || !st.online) return;
            if (node.power < st.threshold && node.irradiance > 50) {
                if (!st._thresholdAlerted) {
                    addAlert(node.name, `${node.name} power (${node.power.toFixed(2)} kW) below threshold (${st.threshold.toFixed(1)} kW)`);
                    atomicallyWriteNodeState(node.name, { ...st, _thresholdAlerted: true });
                }
            } else {
                atomicallyWriteNodeState(node.name, { ...NodeState.get(node.name), _thresholdAlerted: false });
            }
        });
    };

    // Export CSV of current readings
    const exportCSV = (nodes) => {
        const header = 'Node,Power(kW),Irradiance(W/m2),Temperature(C),CloudCover(%),Efficiency(%),Status,Timestamp\n';
        const rows   = nodes.map(n =>
            `${n.name},${n.power.toFixed(3)},${n.irradiance},${n.temperature},${n.cloudCover},${n.efficiency.toFixed(2)},${n.status},${new Date().toISOString()}`
        ).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `solaris_export_${Date.now()}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    return {
        init, renderControlCards, addAlert,
        detectAnomalies, checkThresholds, exportCSV,
        getSimParams, isNodeOnline, getThreshold,
        getAlerts: () => Alerts,
        getMaintLog: () => MaintenanceLog,
    };
})();
/* ============================================================
   SOLARIS v2 — calculator.js
   Energy Yield Calculator
   Pure solar physics functions → deterministic output
   Mirrors Haskell pure function design
   ============================================================ */
'use strict';

const EnergyCalculator = (() => {

    // ── Location database ───────────────────────────────────
    const LOC_DB = {
        sanfrancisco: { lat: 37.77,  lon: -122.42, name: 'San Francisco', avgSunHours: 5.4 },
        newyork:      { lat: 40.71,  lon: -74.01,  name: 'New York',      avgSunHours: 4.7 },
        london:       { lat: 51.51,  lon: -0.13,   name: 'London',        avgSunHours: 3.5 },
        tokyo:        { lat: 35.68,  lon: 139.65,  name: 'Tokyo',         avgSunHours: 4.3 },
        sydney:       { lat: -33.87, lon: 151.21,  name: 'Sydney',        avgSunHours: 6.0 },
        mumbai:       { lat: 19.08,  lon: 72.88,   name: 'Mumbai',        avgSunHours: 6.5 },
        cairo:        { lat: 30.04,  lon: 31.24,   name: 'Cairo',         avgSunHours: 7.2 },
        moscow:       { lat: 55.76,  lon: 37.62,   name: 'Moscow',        avgSunHours: 2.9 },
        custom:       { lat: 0,      lon: 0,        name: 'Custom',        avgSunHours: 5.0 },
    };

    const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
    const CO2_PER_KWH = 0.475; // kg CO2 per kWh (India grid average)
    const TREES_PER_KG_CO2 = 0.0417; // 1 tree absorbs ~24 kg CO2/yr

    let calcChart = null;

    // ── Pure function: optimal tilt angle ───────────────────
    // Rule: tilt ≈ latitude × 0.87 for annual optimum
    const optimalTilt = (lat) => Math.abs(lat) * 0.87;

    // ── Pure function: tilt factor correction ───────────────
    const tiltFactor = (tiltDeg, lat) => {
        const opt = optimalTilt(lat);
        const dev = Math.abs(tiltDeg - opt);
        return Math.max(0.5, 1 - dev * 0.005);
    };

    // ── Pure function: calculate peak sun hours for location ──
    // Uses latitude-based model with seasonal weighting
    const peakSunHours = (lat, lon, doy = 180) => {
        const decl   = 23.45 * Math.sin((2 * Math.PI / 365) * (doy - 81)) * Math.PI / 180;
        const latR   = lat * Math.PI / 180;
        const sunrise = Math.acos(-Math.tan(latR) * Math.tan(decl)) * 180 / Math.PI / 15;
        const daylength = sunrise * 2;
        // Average irradiance during daylight ~ 0.6 × 1000 W/m2
        return daylength * 0.6;
    };

    // ── Pure function: annual energy estimate ───────────────
    const calculateAnnualEnergy = (params) => {
        const { areaM2, effPct, lossPct, lat, lon, tiltDeg } = params;
        const eff       = effPct / 100;
        const lossMult  = 1 - lossPct / 100;
        const tf        = tiltFactor(tiltDeg, lat);

        // Compute monthly yield using 12-month solar declination
        const monthlyKwh = Array.from({ length: 12 }, (_, m) => {
            const doy   = Math.round(30.4 * (m + 0.5));
            const psh   = peakSunHours(lat, lon, doy);
            const days  = [31,28,31,30,31,30,31,31,30,31,30,31][m];
            const daily = areaM2 * eff * lossMult * tf * psh;
            return daily * days;
        });

        const annualKwh  = monthlyKwh.reduce((s, x) => s + x, 0);
        const dailyKwh   = annualKwh / 365;
        const monthlyAvg = annualKwh / 12;

        return { annualKwh, dailyKwh, monthlyAvg, monthlyKwh };
    };

    // ── Format currency ─────────────────────────────────────
    const fmtCurrency = (val, currency) => {
        const sym = CURRENCY_SYMBOLS[currency] || '';
        if (val >= 1_000_000) return `${sym}${(val/1_000_000).toFixed(2)}M`;
        if (val >= 1_000)     return `${sym}${(val/1_000).toFixed(1)}K`;
        return `${sym}${val.toFixed(0)}`;
    };

    // ── Render results ───────────────────────────────────────
    const renderResults = (energy, rate, currency, lat) => {
        const { annualKwh, dailyKwh, monthlyAvg, monthlyKwh } = energy;

        // Energy
        document.getElementById('rsDailyKwh').textContent   = dailyKwh.toFixed(1);
        document.getElementById('rsMonthlyKwh').textContent  = monthlyAvg.toFixed(0);
        document.getElementById('rsAnnualKwh').textContent   = annualKwh.toFixed(0);

        // Savings
        const dailySave   = dailyKwh   * rate;
        const monthlySave = monthlyAvg * rate;
        const annualSave  = annualKwh  * rate;
        document.getElementById('rsDailySave').textContent   = fmtCurrency(dailySave, currency);
        document.getElementById('rsMonthlySave').textContent  = fmtCurrency(monthlySave, currency);
        document.getElementById('rsAnnualSave').textContent   = fmtCurrency(annualSave, currency);
        document.getElementById('rs25yr').textContent         = fmtCurrency(annualSave * 25 * 0.85, currency); // 15% degradation

        // CO2
        const annualCo2   = annualKwh * CO2_PER_KWH;
        const trees        = annualCo2 * TREES_PER_KG_CO2;
        document.getElementById('rsCo2').textContent   = `${annualCo2.toFixed(0)} kg`;
        document.getElementById('rsTrees').textContent = `${trees.toFixed(0)} 🌳`;

        // Optimal tilt
        document.getElementById('optimalAngle').textContent = `${optimalTilt(lat).toFixed(1)}°`;

        // Monthly bar chart
        renderCalcChart(monthlyKwh);

        // Show results
        document.getElementById('calcPlaceholder').style.display = 'none';
        document.getElementById('calcOutput').style.display       = 'block';
    };

    // ── Monthly chart ────────────────────────────────────────
    const renderCalcChart = (monthlyKwh) => {
        const ctx = document.getElementById('calcChart');
        if (!ctx) return;
        if (calcChart) { calcChart.destroy(); calcChart = null; }

        calcChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
                datasets: [{
                    label: 'Monthly Generation (kWh)',
                    data: monthlyKwh.map(v => Math.round(v)),
                    backgroundColor: monthlyKwh.map((v, i) => {
                        const max = Math.max(...monthlyKwh);
                        const t   = v / max;
                        return `rgba(255, ${Math.round(180 * t + 50), 0}, 0, 0.8)`;
                    }),
                    backgroundColor: monthlyKwh.map((v, i) => {
                        const peak = i >= 3 && i <= 8; // Apr-Sep
                        return peak ? 'rgba(255,204,0,0.85)' : 'rgba(255,153,0,0.6)';
                    }),
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#7A8BA8', font: { family: "'JetBrains Mono'" , size: 9 } } },
                    tooltip: {
                        backgroundColor: 'rgba(6,11,20,0.96)',
                        borderColor: 'rgba(255,204,0,0.3)', borderWidth: 1,
                        titleColor: '#FFCC00', bodyColor: '#B0C4DE',
                        callbacks: { label: ctx => ` ${ctx.raw} kWh` }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,204,0,0.05)' }, ticks: { color: '#3D4F66', font: { size: 9 } }, border: { color: 'rgba(255,204,0,0.08)' } },
                    y: { grid: { color: 'rgba(255,204,0,0.05)' }, ticks: { color: '#3D4F66', font: { size: 9 } }, border: { color: 'rgba(255,204,0,0.08)' } },
                }
            }
        });
    };

    // ── Main calculate function ──────────────────────────────
    const calculate = () => {
        const locKey   = document.getElementById('calcLocation')?.value || 'mumbai';
        let   loc      = LOC_DB[locKey] || LOC_DB.mumbai;

        if (locKey === 'custom') {
            const lat = parseFloat(document.getElementById('customLat')?.value || '0');
            const lon = parseFloat(document.getElementById('customLon')?.value || '0');
            loc = { lat, lon, name: 'Custom', avgSunHours: peakSunHours(lat, lon) };
        }

        const areaM2   = parseFloat(document.getElementById('calcArea')?.value  || '50');
        const effPct   = parseFloat(document.getElementById('calcEff')?.value   || '22.5');
        const lossPct  = parseFloat(document.getElementById('calcLoss')?.value  || '14');
        const rate     = parseFloat(document.getElementById('calcRate')?.value  || '8');
        const currency = document.getElementById('calcCurrency')?.value || 'INR';
        const tiltDeg  = parseFloat(document.getElementById('calcTilt')?.value  || '25');

        const energy = calculateAnnualEnergy({ areaM2, effPct, lossPct, lat: loc.lat, lon: loc.lon, tiltDeg });
        renderResults(energy, rate, currency, loc.lat);
    };

    // ── Init ─────────────────────────────────────────────────
    const init = () => {
        document.getElementById('calcBtn')?.addEventListener('click', calculate);

        // Show/hide custom coords
        document.getElementById('calcLocation')?.addEventListener('change', e => {
            const cf = document.getElementById('customCoordsField');
            if (cf) cf.style.display = e.target.value === 'custom' ? 'block' : 'none';
        });

        // Tilt label
        document.getElementById('calcTilt')?.addEventListener('input', e => {
            const el = document.getElementById('calcTiltVal');
            if (el) el.textContent = `${e.target.value}°`;
        });

        // Hide custom coords initially
        const cf = document.getElementById('customCoordsField');
        if (cf) cf.style.display = 'none';

        // Hide output initially
        const out = document.getElementById('calcOutput');
        if (out) out.style.display = 'none';
    };

    return { init, calculate };
})();
/* ============================================================
   SOLARIS v2 — compare.js
   Node Comparison Tool
   Side-by-side analysis of any two nodes
   ============================================================ */
'use strict';

const NodeComparison = (() => {
    let compareChart = null;

    // Render comparison cards for two nodes
    const render = (nodeA, nodeB) => {
        if (!nodeA || !nodeB) return;

        const cards = document.getElementById('compareCards');
        if (!cards) return;

        const mkCard = (node, side) => {
            const isWinner = (valA, valB) => side === 'A' ? valA > valB : valB > valA;
            const w = (a, b) => isWinner(a, b) ? 'compare-winner' : '';

            return `
            <div class="compare-node-card side-${side}">
                <div class="cnc-header side-${side}">
                    <div class="cnc-name">${node.name}</div>
                    <div class="cnc-status">${node.status}</div>
                </div>
                <div class="cnc-power">${node.power.toFixed(2)}<span> kW</span></div>
                <div class="cnc-metrics">
                    <div class="cnc-row ${w(nodeA.irradiance, nodeB.irradiance)}">
                        <span class="cnc-label">Irradiance</span>
                        <span class="cnc-val">${node.irradiance} W/m²</span>
                    </div>
                    <div class="cnc-row ${w(nodeA.efficiency, nodeB.efficiency)}">
                        <span class="cnc-label">Efficiency</span>
                        <span class="cnc-val">${node.efficiency.toFixed(1)}%</span>
                    </div>
                    <div class="cnc-row ${w(nodeB.temperature, nodeA.temperature)}">
                        <span class="cnc-label">Temperature</span>
                        <span class="cnc-val">${node.temperature}°C</span>
                    </div>
                    <div class="cnc-row ${w(nodeB.cloudCover, nodeA.cloudCover)}">
                        <span class="cnc-label">Cloud Cover</span>
                        <span class="cnc-val">${node.cloudCover}%</span>
                    </div>
                    <div class="cnc-row">
                        <span class="cnc-label">Voltage</span>
                        <span class="cnc-val">${node.voltage?.toFixed(0) || '--'} V</span>
                    </div>
                    <div class="cnc-row">
                        <span class="cnc-label">Status</span>
                        <span class="cnc-val">${node.status}</span>
                    </div>
                </div>
            </div>`;
        };

        const divider = `
            <div class="compare-divider">
                <div class="compare-divider-line"></div>
                <div class="compare-divider-label">VS</div>
                <div class="compare-divider-line"></div>
            </div>`;

        cards.innerHTML = mkCard(nodeA, 'A') + divider + mkCard(nodeB, 'B');

        // Render overlay chart
        renderOverlay(nodeA, nodeB);
    };

    const renderOverlay = (nodeA, nodeB) => {
        const ctx = document.getElementById('compareCanvas');
        if (!ctx) return;
        if (compareChart) { compareChart.destroy(); compareChart = null; }

        // Build 24h irradiance profiles for both nodes
        const profileA = buildDailyProfile(nodeA.lat ?? 0, nodeA.lon ?? 0, nodeA.cloudCover);
        const profileB = buildDailyProfile(nodeB.lat ?? 0, nodeB.lon ?? 0, nodeB.cloudCover);
        const labels   = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`);

        compareChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: nodeA.name,
                        data: profileA,
                        borderColor: '#FFCC00',
                        backgroundColor: 'rgba(255,204,0,0.08)',
                        borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0,
                    },
                    {
                        label: nodeB.name,
                        data: profileB,
                        borderColor: '#00C8FF',
                        backgroundColor: 'rgba(0,200,255,0.06)',
                        borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0,
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 600 },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { labels: { color: '#7A8BA8', font: { family: "'JetBrains Mono'", size: 10 }, boxWidth: 10 } },
                    tooltip: {
                        backgroundColor: 'rgba(6,11,20,0.96)',
                        borderColor: 'rgba(255,204,0,0.3)', borderWidth: 1,
                        titleColor: '#FFCC00', bodyColor: '#B0C4DE',
                        titleFont: { family: "'Orbitron'", size: 10 },
                        bodyFont: { family: "'JetBrains Mono'", size: 9 },
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,204,0,0.05)' }, ticks: { color: '#3D4F66', font: { size: 9 } }, border: { color: 'rgba(255,204,0,0.08)' } },
                    y: {
                        grid: { color: 'rgba(255,204,0,0.05)' }, ticks: { color: '#3D4F66', font: { size: 9 } }, border: { color: 'rgba(255,204,0,0.08)' },
                        title: { display: true, text: 'W/m²', color: '#3D4F66', font: { size: 9 } }
                    }
                }
            }
        });
    };

    // Pure function: build 24h irradiance profile
    const buildDailyProfile = (lat, lon, cloudCover) => {
        return Array.from({ length: 24 }, (_, h) => {
            const doy  = 180;
            const decl = 23.45 * Math.sin((2 * Math.PI / 365) * (doy - 81)) * Math.PI / 180;
            const ha   = ((h + lon / 15) - 12) * 15 * Math.PI / 180;
            const latR = lat * Math.PI / 180;
            const sinAlt = Math.sin(latR)*Math.sin(decl) + Math.cos(latR)*Math.cos(decl)*Math.cos(ha);
            const elev = Math.max(0, Math.asin(sinAlt) * 180 / Math.PI);
            if (elev <= 0) return 0;
            const am  = 1 / (Math.sin(elev * Math.PI / 180) + 0.50572 * Math.pow(elev + 6.07995, -1.6364));
            const dni = 1353 * Math.pow(0.7, Math.pow(am, 0.678));
            const ghi = dni * Math.sin(elev * Math.PI / 180);
            return Math.max(0, Math.round(ghi * (1 - (cloudCover / 100) * 0.75)));
        });
    };

    const init = () => {
        const update = () => {
            const iA = parseInt(document.getElementById('compareA')?.value || '5');
            const iB = parseInt(document.getElementById('compareB')?.value || '3');
            // Will be called with real node data from script.js
            if (window._lastNodes && window._lastNodes.length > 0) {
                render(window._lastNodes[iA], window._lastNodes[iB]);
            }
        };
        document.getElementById('compareA')?.addEventListener('change', update);
        document.getElementById('compareB')?.addEventListener('change', update);
    };

    return { init, render, buildDailyProfile };
})();
