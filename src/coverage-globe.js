const stations = window.CoverageStations;

const viewport = document.getElementById('coverage-globe');
const status = document.getElementById('coverage-globe-status');
const caption = document.getElementById('coverage-stations');
const selector = document.getElementById('protocol-selector');
const numberFormat = new Intl.NumberFormat('en');

let activeProtocol;
let focusGlobe;

function updateCoverage(protocol) {
    const transmitters = stations[protocol];
    if (!transmitters) return;
    if (protocol === activeProtocol) {
        focusGlobe?.(protocol);
        return;
    }
    activeProtocol = protocol;

    const details = transmitters.map(station => {
        const row = document.createElement('span');
        const name = document.createElement('strong');
        name.textContent = station.name;
        const reception = document.createElement('span');
        reception.textContent = `${station.frequency} kHz · ≈ ${numberFormat.format(station.range)} km radius`;
        row.append(name, reception);
        return row;
    });
    caption.replaceChildren(...details);
    focusGlobe?.(protocol);
}

selector.addEventListener('protocolchange', event => updateCoverage(event.detail));
updateCoverage(selector.querySelector('.protocol-pill.active')?.dataset.protocol || 'wwvb');

Promise.all([
    import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js'),
    fetch(new URL('../assets/earth-land.json', import.meta.url)).then(response => {
        if (!response.ok) throw new Error('Unable to load the coastline data.');
        return response.json();
    }),
]).then(([THREE, land]) => {
    focusGlobe = createGlobe(THREE, land.coordinates);
    focusGlobe(activeProtocol, false);
    status.hidden = true;
}).catch(() => {
    viewport.dataset.unavailable = '';
    status.textContent = 'The 3D globe could not load.';
});

function createGlobe(THREE, land) {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 4;
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-3, 4, 5);
    scene.add(sun);

    const world = new THREE.Group();
    scene.add(world);
    const map = document.createElement('canvas');
    map.width = 2048;
    map.height = 1024;
    const texture = new THREE.CanvasTexture(map);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    world.add(new THREE.Mesh(
        new THREE.SphereGeometry(1, 96, 64),
        new THREE.MeshLambertMaterial({ map: texture })
    ));

    const fill = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.24, depthWrite: false });
    const outline = new THREE.LineBasicMaterial();
    const pin = new THREE.SpriteMaterial({ map: pinTexture(THREE), depthTest: false, depthWrite: false });
    const regions = new Map();

    for (const [protocol, transmitters] of Object.entries(stations)) {
        const overlay = new THREE.Group();
        const markers = [];
        const center = new THREE.Vector3();
        for (const station of transmitters) {
            const lat = THREE.MathUtils.degToRad(station.lat);
            const lon = THREE.MathUtils.degToRad(station.lon);
            // Match the longitude and latitude mapping of Three.js sphere UVs.
            const position = new THREE.Vector3(
                Math.cos(lat) * Math.cos(lon),
                Math.sin(lat),
                -Math.cos(lat) * Math.sin(lon)
            );
            center.add(position);
            overlay.add(coverageCap(THREE, station.range, position, fill, outline));

            const marker = new THREE.Sprite(pin);
            marker.position.copy(position).multiplyScalar(1.007);
            marker.center.set(0.5, 0.08);
            marker.scale.set(0.105, 0.131, 1);
            marker.renderOrder = 1;
            overlay.add(marker);
            markers.push(marker);
        }
        const target = new THREE.Spherical().setFromVector3(center);
        overlay.visible = false;
        world.add(overlay);
        regions.set(protocol, { overlay, target, markers });
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation;
    let activeRegion;
    const markerPosition = new THREE.Vector3();

    function render() {
        // Keep pins legible on the near hemisphere and hide stations behind the globe.
        activeRegion?.markers.forEach(marker => {
            marker.visible = markerPosition.copy(marker.position).applyQuaternion(world.quaternion).z > 0;
        });
        renderer.render(scene, camera);
    }

    function resize() {
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;
        if (!width || !height) return;
        const aspect = width / height;
        const halfWidth = 1.12 * Math.max(1, aspect);
        const halfHeight = 1.12 * Math.max(1, 1 / aspect);
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        render();
    }

    function setPalette() {
        const palette = getComputedStyle(viewport);
        drawLand(map, land, palette);
        texture.needsUpdate = true;
        const accent = palette.getPropertyValue('--globe-coverage').trim();
        fill.color.set(accent);
        outline.color.set(accent);
        render();
    }

    const view = new THREE.Spherical(1, Math.PI / 2, 0);
    let drag;

    function setView(phi, theta) {
        view.set(1, phi, theta).makeSafe();
        // Apply longitude before latitude and keep roll at zero, even near the poles.
        world.rotation.set(Math.PI / 2 - view.phi, -view.theta, 0, 'XYZ');
        render();
    }

    function endDrag() {
        if (!drag) return;
        const { id } = drag;
        drag = null;
        canvas.classList.remove('dragging');
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }

    canvas.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        cancelAnimationFrame(animation);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', event => {
        if (event.pointerId !== drag?.id) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (!dx && !dy) return;

        const radiansPerPixel = (camera.top - camera.bottom) / canvas.clientHeight;
        setView(view.phi - dy * radiansPerPixel, view.theta - dx * radiansPerPixel);
    });

    canvas.addEventListener('lostpointercapture', event => {
        if (event.pointerId === drag?.id) endDrag();
    });

    viewport.append(canvas);
    setPalette();
    resize();
    new ResizeObserver(resize).observe(viewport);
    new MutationObserver(setPalette).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
    });

    return (protocol, animate = true) => {
        const region = regions.get(protocol);
        endDrag();
        cancelAnimationFrame(animation);
        if (activeRegion) activeRegion.overlay.visible = false;
        region.overlay.visible = true;
        activeRegion = region;

        const { phi, theta } = region.target;
        if (!animate || reducedMotion.matches) {
            setView(phi, theta);
            return;
        }

        const startPhi = view.phi;
        const startTheta = view.theta;
        const deltaTheta = THREE.MathUtils.euclideanModulo(theta - startTheta + Math.PI, 2 * Math.PI) - Math.PI;
        const startedAt = performance.now();
        function step(now) {
            const progress = Math.min((now - startedAt) / 720, 1);
            const eased = progress * progress * (3 - 2 * progress);
            setView(THREE.MathUtils.lerp(startPhi, phi, eased), startTheta + deltaTheta * eased);
            if (progress < 1) animation = requestAnimationFrame(step);
        }
        animation = requestAnimationFrame(step);
    };
}

function coverageCap(THREE, range, position, fill, outline) {
    const angle = range / 6371; // Convert kilometers to an angle on a spherical Earth.
    const radius = 1.004;
    const segments = 96;
    const cap = new THREE.Group();
    const surface = new THREE.SphereGeometry(radius, segments, 16, 0, Math.PI * 2, 0, angle);
    cap.add(new THREE.Mesh(surface, fill));

    const rim = [];
    for (let i = 0; i < segments; i++) {
        const bearing = 2 * Math.PI * i / segments;
        rim.push(new THREE.Vector3(
            radius * Math.sin(angle) * Math.cos(bearing),
            radius * Math.cos(angle),
            radius * Math.sin(angle) * Math.sin(bearing)
        ));
    }
    cap.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rim), outline));
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), position);
    return cap;
}

function drawLand(canvas, land, palette) {
    const context = canvas.getContext('2d');
    const { width, height } = canvas;
    context.fillStyle = palette.getPropertyValue('--globe-ocean').trim();
    context.fillRect(0, 0, width, height);
    context.fillStyle = palette.getPropertyValue('--globe-land').trim();
    for (const polygon of land) {
        context.beginPath();
        for (const ring of polygon) {
            ring.forEach(([lon, lat], index) => {
                const x = (lon + 180) * width / 360;
                const y = (90 - lat) * height / 180;
                if (index === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            });
            context.closePath();
        }
        context.fill('evenodd');
    }

    context.strokeStyle = palette.getPropertyValue('--globe-grid').trim();
    context.lineWidth = 1;
    context.beginPath();
    for (let x = width / 12; x < width; x += width / 12) {
        context.moveTo(x, 0);
        context.lineTo(x, height);
    }
    for (let y = height / 6; y < height; y += height / 6) {
        context.moveTo(0, y);
        context.lineTo(width, y);
    }
    context.stroke();
}

function pinTexture(THREE) {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    context.beginPath();
    context.moveTo(24, 55);
    context.bezierCurveTo(19, 46, 6, 32, 6, 21);
    context.arc(24, 21, 18, Math.PI, 0);
    context.bezierCurveTo(42, 32, 29, 46, 24, 55);
    context.closePath();
    context.fillStyle = '#2458c4';
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = '#fff';
    context.stroke();
    context.beginPath();
    context.arc(24, 21, 6, 0, Math.PI * 2);
    context.fillStyle = '#fff';
    context.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
