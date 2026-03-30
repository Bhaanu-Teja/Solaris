/* ============================================================
   SOLARIS — Heliometric Intelligence Platform
   3d.js — Three.js Solar Earth Visualization
   ============================================================ */

'use strict';

class SolarEarth {
    constructor() {
        this.scene      = null;
        this.camera     = null;
        this.renderer   = null;
        this.earth      = null;
        this.clouds     = null;
        this.atmosphere = null;
        this.stars      = null;
        this.corona     = null;
        this.solarWind  = null;
        this.hotspots   = [];
        this.mouse      = new THREE.Vector2(-999, -999);
        this.targetRotX = 0;
        this.targetRotY = 0;
        this.clock      = new THREE.Clock();
        this.raycaster  = new THREE.Raycaster();
        this.isDragging = false;
        this.lastMouse  = { x: 0, y: 0 };
        this.autoRotate = true;
        this.autoRotateY = 0;

        this._init();
    }

    _init() {
        const container = document.getElementById('canvas-container');
        if (!container) return;

        /* ── Scene ─────────────────────────────────────────── */
        this.scene = new THREE.Scene();

        /* ── Camera ────────────────────────────────────────── */
        this.camera = new THREE.PerspectiveCamera(
            40,
            container.clientWidth / container.clientHeight,
            0.1, 1000
        );
        this.camera.position.set(0, 0, 16);

        /* ── Renderer ──────────────────────────────────────── */
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        /* ── Build scene ────────────────────────────────────── */
        this._buildLights();
        this._buildStars();
        this._buildEarth();
        this._buildAtmosphere();
        this._buildCorona();
        this._buildSolarWind();
        this._buildOrbitRings();

        /* ── Events ─────────────────────────────────────────── */
        window.addEventListener('resize', () => this._onResize());
        container.addEventListener('mousemove',  e => this._onMouseMove(e));
        container.addEventListener('mousedown',  e => this._onMouseDown(e));
        container.addEventListener('mouseup',    () => this._onMouseUp());
        container.addEventListener('mouseleave', () => this._onMouseUp());
        container.addEventListener('wheel',      e => this._onWheel(e), { passive: true });

        /* ── Animate ─────────────────────────────────────────── */
        this._animate();
    }

    _buildLights() {
        // Deep ambient
        const ambient = new THREE.AmbientLight(0x0A1428, 0.8);
        this.scene.add(ambient);

        // Sun: main directional
        this.sunLight = new THREE.DirectionalLight(0xFFEECC, 2.5);
        this.sunLight.position.set(15, 8, 10);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.set(2048, 2048);
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far  = 500;
        this.scene.add(this.sunLight);

        // Sun glow sprite
        const sunGeo  = new THREE.SphereGeometry(0.4, 16, 16);
        const sunMat  = new THREE.MeshBasicMaterial({ color: 0xFFCC00, transparent: true, opacity: 0.9 });
        this.sunMesh  = new THREE.Mesh(sunGeo, sunMat);
        this.sunMesh.position.copy(this.sunLight.position).multiplyScalar(0.8);
        this.scene.add(this.sunMesh);

        // Halo around sun
        const haloGeo = new THREE.SphereGeometry(0.8, 16, 16);
        const haloMat = new THREE.MeshBasicMaterial({ color: 0xFFAA00, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending });
        const halo    = new THREE.Mesh(haloGeo, haloMat);
        halo.position.copy(this.sunMesh.position);
        this.scene.add(halo);
        this.sunHalo = halo;

        // Rim light (blue, opposite of sun)
        const rim = new THREE.DirectionalLight(0x003366, 0.4);
        rim.position.set(-15, -5, -10);
        this.scene.add(rim);

        // City lights fill (faint warm)
        const cityFill = new THREE.PointLight(0xFFAA44, 0.3, 50);
        cityFill.position.set(-5, 0, 8);
        this.scene.add(cityFill);
    }

    _buildStars() {
        const geo     = new THREE.BufferGeometry();
        const count   = 8000;
        const pos     = new Float32Array(count * 3);
        const sizes   = new Float32Array(count);
        const colors  = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const r     = 80 + Math.random() * 120;
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);

            pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
            pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i*3+2] = r * Math.cos(phi);

            sizes[i] = Math.random() * 1.2 + 0.2;

            // Color variation: white, blue-white, yellow-white
            const hue = Math.random();
            const c   = new THREE.Color().setHSL(hue < 0.5 ? 0.6 : (hue < 0.8 ? 0.15 : 0), 0.6, 0.7 + Math.random() * 0.3);
            colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.15, vertexColors: true,
            transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });

        this.stars = new THREE.Points(geo, mat);
        this.scene.add(this.stars);
    }

    _buildEarth() {
        const loader = new THREE.TextureLoader();
        const geo    = new THREE.SphereGeometry(5, 96, 96);

        // Use procedural fallback (textures may fail cross-origin)
        const material = new THREE.MeshPhongMaterial({
            shininess: 15,
            emissive:  new THREE.Color(0x081830),
            emissiveIntensity: 0.3,
        });

        // Try to load textures
        const tryLoad = (url, onLoad) => {
            loader.load(url, onLoad, undefined, () => {});
        };

        tryLoad('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg', tex => {
            material.map = tex; material.needsUpdate = true;
        });
        tryLoad('https://threejs.org/examples/textures/planets/earth_specular_2048.jpg', tex => {
            material.specularMap = tex; material.needsUpdate = true;
        });
        tryLoad('https://threejs.org/examples/textures/planets/earth_normal_2048.jpg', tex => {
            material.normalMap = tex; material.needsUpdate = true;
        });

        // Fallback procedural color
        material.color = new THREE.Color(0x1A5276);

        this.earth = new THREE.Mesh(geo, material);
        this.earth.rotation.y = -0.3;
        this.earth.castShadow  = true;
        this.earth.receiveShadow = true;
        this.scene.add(this.earth);

        // Cloud layer
        const cloudGeo = new THREE.SphereGeometry(5.08, 96, 96);
        const cloudMat = new THREE.MeshPhongMaterial({
            transparent: true, opacity: 0.35,
            blending: THREE.AdditiveBlending,
            depthWrite: false, side: THREE.DoubleSide,
        });
        tryLoad('https://threejs.org/examples/textures/planets/earth_clouds_1024.png', tex => {
            cloudMat.map = tex; cloudMat.needsUpdate = true;
        });
        this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
        this.earth.add(this.clouds);

        // Night side glow
        const nightGeo = new THREE.SphereGeometry(5.01, 64, 64);
        const nightMat = new THREE.ShaderMaterial({
            uniforms: { sunDirection: { value: this.sunLight.position.clone().normalize() } },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 sunDirection;
                varying vec3 vNormal;
                varying vec3 vPosition;
                void main() {
                    float diffuse = dot(normalize(vNormal), normalize(sunDirection));
                    float nightFactor = smoothstep(0.0, -0.3, diffuse);
                    vec3 cityLight = vec3(0.9, 0.7, 0.3) * nightFactor * 0.3;
                    gl_FragColor = vec4(cityLight, nightFactor * 0.4);
                }
            `,
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const nightMesh = new THREE.Mesh(nightGeo, nightMat);
        this.earth.add(nightMesh);
        this.nightMat = nightMat;
    }

    _buildAtmosphere() {
        const geo = new THREE.SphereGeometry(5.5, 64, 64);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                sunDirection: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
                time:         { value: 0 },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vViewPos;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    vViewPos = -mvPos.xyz;
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform vec3 sunDirection;
                uniform float time;
                varying vec3 vNormal;
                varying vec3 vViewPos;
                void main() {
                    vec3 N = normalize(vNormal);
                    vec3 V = normalize(vViewPos);
                    float fresnel = 1.0 - abs(dot(V, N));
                    fresnel = pow(fresnel, 2.5);
                    
                    // Day side: blue atmosphere
                    float sunDot = max(0.0, dot(N, normalize(sunDirection)));
                    vec3 dayColor   = vec3(0.15, 0.55, 1.0);
                    vec3 horizColor = vec3(0.6, 0.8, 1.0);
                    vec3 atmColor   = mix(dayColor, horizColor, fresnel);
                    
                    float intensity = fresnel * (0.4 + sunDot * 0.4);
                    gl_FragColor = vec4(atmColor * intensity, intensity * 0.6);
                }
            `,
            transparent: true, blending: THREE.AdditiveBlending,
            depthWrite: false, side: THREE.BackSide,
        });

        this.atmosphere = new THREE.Mesh(geo, mat);
        this.earth.add(this.atmosphere);
        this.atmosphereMat = mat;
    }

    _buildCorona() {
        // Outer glow halo around Earth
        const geo = new THREE.SphereGeometry(5.8, 32, 32);
        const mat = new THREE.ShaderMaterial({
            uniforms: { time: { value: 0 } },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vViewDir;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    vViewDir = normalize(-mvPos.xyz);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform float time;
                varying vec3 vNormal;
                varying vec3 vViewDir;
                void main() {
                    float f = 1.0 - abs(dot(vViewDir, vNormal));
                    f = pow(f, 4.0);
                    float pulse = 0.8 + 0.2 * sin(time * 1.5);
                    vec3 col = vec3(0.0, 0.4, 1.0) * f * pulse * 0.5;
                    gl_FragColor = vec4(col, f * 0.3);
                }
            `,
            transparent: true, blending: THREE.AdditiveBlending,
            depthWrite: false, side: THREE.BackSide,
        });
        this.corona = new THREE.Mesh(geo, mat);
        this.earth.add(this.corona);
        this.coronaMat = mat;
    }

    _buildSolarWind() {
        // Particle stream representing solar wind
        const count = 600;
        const geo   = new THREE.BufferGeometry();
        const pos   = new Float32Array(count * 3);
        const vel   = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Start from sun direction, scatter
            const angle = Math.random() * Math.PI * 2;
            const spread = 0.6;
            pos[i*3]   = 12 + (Math.random() - 0.5) * 4;
            pos[i*3+1] = (Math.random() - 0.5) * 8;
            pos[i*3+2] = (Math.random() - 0.5) * 8;
            vel[i*3]   = -(0.02 + Math.random() * 0.04);
            vel[i*3+1] = (Math.random() - 0.5) * 0.005;
            vel[i*3+2] = (Math.random() - 0.5) * 0.005;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this._solarWindPos = pos;
        this._solarWindVel = vel;

        const mat = new THREE.PointsMaterial({
            size: 0.06, color: 0xFFCC44,
            transparent: true, opacity: 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });

        this.solarWind = new THREE.Points(geo, mat);
        this.scene.add(this.solarWind);
    }

    _buildOrbitRings() {
        // Decorative orbit lines
        const makeRing = (radius, opacity, color = 0xFFCC00) => {
            const geo = new THREE.RingGeometry(radius, radius + 0.01, 128);
            const mat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity,
                blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
            });
            const ring = new THREE.Mesh(geo, mat);
            ring.rotation.x = Math.PI / 2;
            return ring;
        };

        const ring1 = makeRing(6.5, 0.12);
        const ring2 = makeRing(7.5, 0.06);
        const ring3 = makeRing(9.0, 0.04, 0x0044FF);
        this.earth.add(ring1);
        ring2.rotation.x = Math.PI / 3;
        ring2.rotation.z = Math.PI / 6;
        this.earth.add(ring2);
        this.scene.add(ring3);
        this.orbitRings = [ring1, ring2, ring3];

        // Satellite dot
        const satGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const satMat = new THREE.MeshBasicMaterial({ color: 0x00FFFF });
        this.satellite = new THREE.Mesh(satGeo, satMat);
        this.scene.add(this.satellite);
    }

    _buildHotspots(nodes) {
        // Remove old hotspots
        this.hotspots.forEach(h => this.earth.remove(h));
        this.hotspots = [];

        if (!nodes || !nodes.length) return;

        nodes.forEach(node => {
            const lat = node.lat * Math.PI / 180;
            const lng = (node.lng + 90) * Math.PI / 180; // offset for Earth texture rotation

            const r = 5.15;
            const x = r * Math.cos(lat) * Math.cos(lng);
            const y = r * Math.sin(lat);
            const z = r * Math.cos(lat) * Math.sin(lng);

            // Power-based color
            const power = node.power || 0;
            const hue   = power > 7 ? 0.15 : power > 4 ? 0.1 : 0.0;
            const color = new THREE.Color().setHSL(hue, 1.0, 0.6);

            // Dot
            const dotGeo = new THREE.SphereGeometry(0.07, 8, 8);
            const dotMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
            const dot    = new THREE.Mesh(dotGeo, dotMat);
            dot.position.set(x, y, z);
            dot.userData = { node };
            this.earth.add(dot);
            this.hotspots.push(dot);

            // Ping ring
            const pingGeo = new THREE.RingGeometry(0.1, 0.13, 16);
            const pingMat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.6,
                blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
            });
            const ping = new THREE.Mesh(pingGeo, pingMat);
            ping.position.set(x, y, z);
            ping.lookAt(new THREE.Vector3(0, 0, 0));
            ping.userData = { isPing: true, birthTime: this.clock.getElapsedTime(), period: 1.5 + Math.random() };
            this.earth.add(ping);
            this.hotspots.push(ping);
        });
    }

    _onMouseMove(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

        if (this.isDragging && this.earth) {
            const dx = e.clientX - this.lastMouse.x;
            const dy = e.clientY - this.lastMouse.y;
            this.targetRotY += dx * 0.005;
            this.targetRotX += dy * 0.005;
            this.targetRotX  = Math.max(-1.2, Math.min(1.2, this.targetRotX));
            this.lastMouse   = { x: e.clientX, y: e.clientY };
            this.autoRotate  = false;
        }
    }

    _onMouseDown(e) {
        this.isDragging = true;
        this.lastMouse  = { x: e.clientX, y: e.clientY };
    }

    _onMouseUp() {
        this.isDragging = false;
        setTimeout(() => { this.autoRotate = true; }, 3000);
    }

    _onWheel(e) {
        this.camera.position.z = Math.max(10, Math.min(25, this.camera.position.z + e.deltaY * 0.01));
    }

    _onResize() {
        const container = document.getElementById('canvas-container');
        if (!container) return;
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }

    _animateSolarWind() {
        const pos = this._solarWindPos;
        const vel = this._solarWindVel;
        for (let i = 0; i < pos.length / 3; i++) {
            pos[i*3]   += vel[i*3];
            pos[i*3+1] += vel[i*3+1];
            pos[i*3+2] += vel[i*3+2];

            // Reset particle when it passes through Earth or goes too far
            const dist = Math.sqrt(pos[i*3]**2 + pos[i*3+1]**2 + pos[i*3+2]**2);
            if (dist < 4 || pos[i*3] < -12) {
                pos[i*3]   = 12 + (Math.random() - 0.5) * 4;
                pos[i*3+1] = (Math.random() - 0.5) * 8;
                pos[i*3+2] = (Math.random() - 0.5) * 8;
            }
        }
        this.solarWind.geometry.attributes.position.needsUpdate = true;
    }

    _checkHotspotHover() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const earthIntersects = this.raycaster.intersectObject(this.earth, false);
        const tooltip = document.getElementById('dataTooltip');

        const dotHotspots = this.hotspots.filter(h => !h.userData.isPing);
        const hits = this.raycaster.intersectObjects(dotHotspots);

        if (hits.length > 0 && tooltip) {
            const node = hits[0].object.userData.node;
            if (node) {
                const x = (this.mouse.x * 0.5 + 0.5) * window.innerWidth;
                const y = (-this.mouse.y * 0.5 + 0.5) * window.innerHeight;
                tooltip.style.left = `${x + 16}px`;
                tooltip.style.top  = `${y - 80}px`;
                tooltip.classList.add('visible');
                tooltip.innerHTML = `
                    <div class="tooltip-title">⊛ ${node.name}</div>
                    <div class="tooltip-row"><span>POWER</span><span class="tooltip-val">${node.power?.toFixed(2)} kW</span></div>
                    <div class="tooltip-row"><span>IRRADIANCE</span><span class="tooltip-val">${node.irradiance} W/m²</span></div>
                    <div class="tooltip-row"><span>TEMP</span><span class="tooltip-val">${node.temperature}°C</span></div>
                    <div class="tooltip-row"><span>STATUS</span><span class="tooltip-val" style="color:#00FF9F">${node.status}</span></div>
                `;
            }
        } else if (tooltip) {
            tooltip.classList.remove('visible');
        }
    }

    _animate() {
        requestAnimationFrame(() => this._animate());

        const elapsed = this.clock.getElapsedTime();
        const delta   = this.clock.getDelta();

        // Earth rotation
        if (this.earth) {
            if (this.autoRotate) {
                this.autoRotateY += 0.0008;
                this.earth.rotation.y = this.autoRotateY;
                this.earth.rotation.x += (0 - this.earth.rotation.x) * 0.05;
            } else {
                this.earth.rotation.y += (this.targetRotY - this.earth.rotation.y) * 0.08;
                this.earth.rotation.x += (this.targetRotX - this.earth.rotation.x) * 0.08;
            }
        }

        // Clouds rotate slightly faster
        if (this.clouds) {
            this.clouds.rotation.y += 0.0003;
        }

        // Update atmosphere + corona time uniforms
        if (this.atmosphereMat) this.atmosphereMat.uniforms.time.value = elapsed;
        if (this.coronaMat)     this.coronaMat.uniforms.time.value     = elapsed;

        // Sun glow pulse
        if (this.sunMesh) {
            const s = 1 + Math.sin(elapsed * 2) * 0.1;
            this.sunMesh.scale.setScalar(s);
            this.sunHalo.scale.setScalar(s * 1.5);
        }

        // Animate solar wind particles
        if (this.solarWind) this._animateSolarWind();

        // Stars slow drift
        if (this.stars) this.stars.rotation.y += 0.00003;

        // Satellite orbit
        if (this.satellite) {
            const angle = elapsed * 0.4;
            const r = 7.2;
            this.satellite.position.set(
                Math.cos(angle) * r,
                Math.sin(angle * 0.3) * 1.5,
                Math.sin(angle) * r
            );
        }

        // Ping rings: scale out and fade
        this.hotspots.forEach(h => {
            if (h.userData.isPing) {
                const age = (elapsed - h.userData.birthTime) % h.userData.period;
                const t   = age / h.userData.period;
                const s   = 1 + t * 3;
                h.scale.setScalar(s);
                h.material.opacity = (1 - t) * 0.5;
            }
        });

        // Update hotspots from AppState
        if (typeof AppState !== 'undefined') {
            const nodes = AppState.nodes.read();
            if (nodes && nodes.length > 0 && this.hotspots.length === 0) {
                this._buildHotspots(nodes);
            }
            // Rebuild periodically
            if (Math.floor(elapsed) % 5 === 0 && nodes && nodes.length > 0) {
                if (!this._lastHotspotBuild || elapsed - this._lastHotspotBuild > 5) {
                    this._buildHotspots(nodes);
                    this._lastHotspotBuild = elapsed;
                }
            }
        }

        // Check hover for tooltip
        this._checkHotspotHover();

        this.renderer.render(this.scene, this.camera);
    }
}

/* ── Init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    window.solarEarth = new SolarEarth();
});
