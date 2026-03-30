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
