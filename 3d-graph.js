/**
 * 3D Interactive Skills Graph — v3
 * Clean, compact Three.js graph with readable labels.
 *
 * Rendered as Figure 3 of the page, so it is drawn as ink on paper. The plate
 * is picked from the luminance of the --paper token actually in effect, and
 * every category colour clears 5.5:1 against its background on either plate.
 */

(function () {
    // Reads a design token from the stylesheet so the graph stays in step with
    // the page instead of carrying a second, drifting copy of the palette.
    function token(name, fallback) {
        const v = getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim();
        return v || fallback;
    }

    // Which plate to ink depends on the paper actually under the figure, not
    // on the reader's OS setting: the page commits to light regardless of it,
    // and asking the OS put a light-on-light palette on the canvas.
    function paperIsDark() {
        const hex = token('--paper', '#f4f5f3').replace('#', '');
        if (hex.length < 6) return false;
        const ch = [0, 2, 4]
            .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] < 0.4;
    }

    function waitForThree(cb) {
        if (typeof THREE !== 'undefined' && typeof THREE.OrbitControls !== 'undefined') cb();
        else setTimeout(() => waitForThree(cb), 50);
    }

    waitForThree(init3DGraph);

    function init3DGraph() {
        const container = document.getElementById('skills-graph-container');
        if (!container) return;

        const darkMode = paperIsDark();

        // ============ SETUP ============
        const scene = new THREE.Scene();
        const width = container.clientWidth;
        const height = container.clientHeight;

        const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
        camera.position.set(0, 0, 30);

        const renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('skills-graph'),
            antialias: true,
            alpha: true
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.enableZoom = true;
        controls.enablePan = false;
        controls.minDistance = 8;
        controls.maxDistance = 40;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;

        // ============ DATA ============
        // Two plates of the same figure: ink on paper, or chalk on slate.
        const plate = darkMode
            ? ['#8fa8ff', '#e58ac4', '#5fc4a8', '#d6a75a', '#a4a9b0']
            : ['#1b44c8', '#8a2f6b', '#1f6f5c', '#7a4a12', '#4a4f57'];

        const categories = [
            { name: 'GenAI & LLMs', skills: ['Anthropic API', 'LangChain', 'RAG', 'Embeddings', 'Vector DBs', 'Prompt Eng.'] },
            { name: 'ML & AI', skills: ['PyTorch', 'scikit-learn', 'RL', 'World Models'] },
            { name: 'Programming', skills: ['Python', 'pandas', 'NumPy', 'SQL', 'Java'] },
            { name: 'Mathematics', skills: ['Linear Algebra', 'Probability', 'Statistics'] },
            { name: 'Cloud & Tools', skills: ['AWS', 'Docker', 'FastAPI', 'Git', 'Jupyter'] },
        ].map((cat, i) => Object.assign(cat, {
            color: plate[i],
            hex: parseInt(plate[i].slice(1), 16),
        }));

        // ============ LAYOUT ============
        // Categories are separated into distinct clusters (small sub-graphs)
        const nodes = [];
        const edges = [];

        // Central node
        const inkStr = darkMode ? '#e8e9e4' : '#14161a';
        const center = {
            name: 'GM', x: 0, y: 0, z: 0, type: 'center', cat: null,
            color: parseInt(inkStr.slice(1), 16), colorStr: inkStr,
        };
        nodes.push(center);

        const catRadius = 8.5;

        categories.forEach((cat, i) => {
            const angle = (i / categories.length) * Math.PI * 2 - Math.PI / 2;
            const zOff = (i % 2 === 0 ? 1.8 : -1.8);

            const catNode = {
                name: cat.name,
                x: Math.cos(angle) * catRadius,
                y: Math.sin(angle) * catRadius,
                z: zOff,
                type: 'category',
                cat: cat.name,
                color: cat.hex,
                colorStr: cat.color
            };
            nodes.push(catNode);
            // Faint tie back to the center — clusters stay visually separate
            edges.push({ from: center, to: catNode, cat: cat.name, color: cat.hex, opacity: 0.12 });

            const skillR = 2.9;
            const spread = 0.85;
            cat.skills.forEach((skill, j) => {
                const sAngle = angle + (j - (cat.skills.length - 1) / 2) * spread;
                const jitterZ = (Math.random() - 0.5) * 2.0;

                const sNode = {
                    name: skill,
                    x: catNode.x + Math.cos(sAngle) * skillR,
                    y: catNode.y + Math.sin(sAngle) * skillR,
                    z: catNode.z + jitterZ,
                    type: 'skill',
                    cat: cat.name,
                    color: cat.hex,
                    colorStr: cat.color
                };
                nodes.push(sNode);
                edges.push({ from: catNode, to: sNode, cat: cat.name, color: cat.hex, opacity: 0.25 });
            });

            // Cluster centroid (used for camera focus)
            cat.centroid = new THREE.Vector3(catNode.x, catNode.y, catNode.z);
        });

        // ============ CREATE 3D OBJECTS ============
        const graphGroup = new THREE.Group();
        scene.add(graphGroup);

        // --- Edges ---
        edges.forEach(e => {
            const geom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(e.from.x, e.from.y, e.from.z),
                new THREE.Vector3(e.to.x, e.to.y, e.to.z)
            ]);
            const mat = new THREE.LineBasicMaterial({
                color: e.color,
                transparent: true,
                opacity: e.opacity
            });
            const line = new THREE.Line(geom, mat);
            graphGroup.add(line);
            e.mesh = line;
        });

        // --- Nodes (spheres + rings for categories) ---
        nodes.forEach(node => {
            const isCenter = node.type === 'center';
            const isCat = node.type === 'category';
            const size = isCenter ? 0.55 : isCat ? 0.3 : 0.15;

            // Core sphere
            const geo = new THREE.SphereGeometry(size, 24, 24);
            const mat = new THREE.MeshBasicMaterial({ color: node.color });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(node.x, node.y, node.z);
            graphGroup.add(mesh);
            node.mesh = mesh;

            // Outer ring for center + categories
            if (isCenter || isCat) {
                const ringGeo = new THREE.RingGeometry(size + 0.15, size + 0.22, 32);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: node.color,
                    transparent: true,
                    opacity: isCenter ? 0.3 : 0.2,
                    side: THREE.DoubleSide
                });
                const ring = new THREE.Mesh(ringGeo, ringMat);
                ring.position.copy(mesh.position);
                graphGroup.add(ring);
                node.ring = ring;
            }

            // Glow (soft, large)
            if (isCenter) {
                const glowGeo = new THREE.SphereGeometry(1.8, 16, 16);
                const glowMat = new THREE.MeshBasicMaterial({
                    color: node.color,
                    transparent: true,
                    opacity: 0.04
                });
                const glow = new THREE.Mesh(glowGeo, glowMat);
                glow.position.copy(mesh.position);
                graphGroup.add(glow);
                node.glow = glow;
            }
        });

        // --- Labels (HTML overlay for crispness) ---
        const labelsOverlay = document.createElement('div');
        labelsOverlay.id = 'graph-labels-overlay';
        labelsOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;';
        container.appendChild(labelsOverlay);

        nodes.forEach(node => {
            const el = document.createElement('div');
            el.className = 'graph-label';
            el.textContent = node.name;

            const isCenter = node.type === 'center';
            const isCat = node.type === 'category';

            // Labels are set in the page's mono face and sit on paper-coloured
            // chips, so they read as printed annotations rather than HUD chrome.
            const paper = token('--paper', darkMode ? '#16171b' : '#f4f5f3');
            const rule = token('--rule', darkMode ? '#2c2e34' : '#dcded8');
            const inkMid = token('--ink-mid', darkMode ? '#a4a9b0' : '#4a4f57');

            el.style.cssText = `
                position:absolute;
                font-family:'IBM Plex Mono',ui-monospace,monospace;
                font-weight:${isCenter ? '600' : '500'};
                font-size:${isCenter ? '13px' : isCat ? '11.5px' : '10px'};
                color:${isCenter ? paper : isCat ? node.colorStr : inkMid};
                background:${isCenter ? node.colorStr : paper};
                border:1px solid ${isCenter ? node.colorStr : isCat ? node.colorStr : rule};
                padding:${isCenter ? '4px 12px' : isCat ? '3px 9px' : '2px 7px'};
                border-radius:3px;
                white-space:nowrap;
                transform:translate(-50%,-50%);
                pointer-events:none;
                letter-spacing:${isCenter ? '0.12em' : '0.03em'};
                transition:opacity 0.3s ease;
            `;

            labelsOverlay.appendChild(el);
            node.labelEl = el;

            // Cache dimensions for collision detection
            setTimeout(() => {
                node.w = el.offsetWidth || 60;
                node.h = el.offsetHeight || 25;
            }, 100);
        });

        // ============ UPDATE LABELS POSITION ============
        const tempVec = new THREE.Vector3();

        function updateLabels() {
            const w = container.clientWidth;
            const h = container.clientHeight;
            
            const activeNodes = [];

            nodes.forEach(node => {
                if (!node.mesh || !node.labelEl) return;

                if (node.hidden) {
                    node.labelEl.style.opacity = '0';
                    return;
                }

                tempVec.copy(node.mesh.position);
                // Offset label above node
                const offsetY = node.type === 'center' ? 1.0 : node.type === 'category' ? 0.65 : 0.4;
                tempVec.y += offsetY;

                tempVec.project(camera);

                // Hide if behind camera
                if (tempVec.z > 1) {
                    node.labelEl.style.opacity = '0';
                    node.labelEl.style.pointerEvents = 'none';
                } else {
                    node.labelEl.style.opacity = '1';
                    node.labelEl.style.pointerEvents = 'auto'; // allow interaction if needed
                    node.screenX = (tempVec.x * 0.5 + 0.5) * w;
                    node.screenY = (-tempVec.y * 0.5 + 0.5) * h;
                    activeNodes.push(node);
                }
            });

            // 2D Collision Avoidance (Repulsion)
            const iterations = 6;
            const padding = 4; // pixels between labels
            
            for (let iter = 0; iter < iterations; iter++) {
                for (let i = 0; i < activeNodes.length; i++) {
                    for (let j = i + 1; j < activeNodes.length; j++) {
                        const a = activeNodes[i];
                        const b = activeNodes[j];
                        
                        // Default sizes fallback if not cached yet
                        const wA = a.w || 60; const hA = a.h || 25;
                        const wB = b.w || 60; const hB = b.h || 25;

                        const dx = a.screenX - b.screenX;
                        const dy = a.screenY - b.screenY;

                        const minDistX = (wA + wB) / 2 + padding;
                        const minDistY = (hA + hB) / 2 + padding;

                        if (Math.abs(dx) < minDistX && Math.abs(dy) < minDistY) {
                            // Find amount of overlap
                            const ox = minDistX - Math.abs(dx);
                            const oy = minDistY - Math.abs(dy);
                            
                            // Push along the axis of least penetration
                            let pushX = 0;
                            let pushY = 0;
                            
                            if (ox < oy) {
                                pushX = (dx > 0 ? 1 : -1) * ox * 0.6;
                            } else {
                                pushY = (dy > 0 ? 1 : -1) * oy * 0.6;
                            }
                            
                            // Center node should move less
                            const weightA = a.type === 'center' ? 0.05 : 1;
                            const weightB = b.type === 'center' ? 0.05 : 1;
                            const totalWeight = weightA + weightB;
                            
                            a.screenX += pushX * (weightB / totalWeight);
                            a.screenY += pushY * (weightB / totalWeight);
                            b.screenX -= pushX * (weightA / totalWeight);
                            b.screenY -= pushY * (weightA / totalWeight);
                        }
                    }
                }
            }

            // Apply final positions
            activeNodes.forEach(node => {
                // Ensure labels stay within container bounds
                const wHalf = (node.w || 60) / 2;
                const hHalf = (node.h || 25) / 2;
                node.screenX = Math.max(wHalf, Math.min(w - wHalf, node.screenX));
                node.screenY = Math.max(hHalf, Math.min(h - hHalf, node.screenY));

                node.labelEl.style.left = node.screenX + 'px';
                node.labelEl.style.top = node.screenY + 'px';
            });
        }

        // ============ CATEGORY FILTER CHIPS ============
        const desiredTarget = new THREE.Vector3(0, 0, 0);
        let desiredDist = 30;

        function setFilter(catName) {
            nodes.forEach(node => {
                const show = node.type === 'center' || catName === 'All' || node.cat === catName;
                node.hidden = !show;
                if (node.mesh) node.mesh.visible = show;
                if (node.ring) node.ring.visible = show;
                if (node.glow) node.glow.visible = show;
            });

            edges.forEach(e => {
                const show = catName === 'All' || e.cat === catName;
                if (e.mesh) e.mesh.visible = show;
            });

            if (catName === 'All') {
                desiredTarget.set(0, 0, 0);
                desiredDist = 30;
            } else {
                const cat = categories.find(c => c.name === catName);
                if (cat) {
                    desiredTarget.copy(cat.centroid);
                    desiredDist = 12;
                }
            }
        }

        const filtersDiv = document.createElement('div');
        filtersDiv.className = 'graph-filters';
        ['All'].concat(categories.map(c => c.name)).forEach((name, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = name;
            if (i === 0) btn.classList.add('active');
            btn.addEventListener('click', () => {
                filtersDiv.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setFilter(name);
            });
            filtersDiv.appendChild(btn);
        });
        container.appendChild(filtersDiv);

        // ============ AMBIENT PARTICLES ============
        const pCount = 40;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(pCount * 3);
        for (let i = 0; i < pCount; i++) {
            pPos[i * 3] = (Math.random() - 0.5) * 35;
            pPos[i * 3 + 1] = (Math.random() - 0.5) * 35;
            pPos[i * 3 + 2] = (Math.random() - 0.5) * 35;
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = new THREE.PointsMaterial({
            color: darkMode ? 0x7f858d : 0x9aa0a8,
            size: 0.05,
            transparent: true,
            opacity: darkMode ? 0.3 : 0.22,
        });
        const ambient = new THREE.Points(pGeo, pMat);
        scene.add(ambient);

        // ============ ANIMATION ============
        const clock = new THREE.Clock();

        // The loop below writes to 29 label elements every frame. Left running
        // while the figure is scrolled away, that competes with the browser's
        // own scrolling work for no visible benefit, so the loop is gated on
        // the figure actually being on screen and the tab being visible.
        let onScreen = true;
        let pageVisible = !document.hidden;
        let running = false;

        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                onScreen = entries[0].isIntersecting;
                start();
            }, { rootMargin: '150px 0px' }).observe(container);
        }

        document.addEventListener('visibilitychange', function () {
            pageVisible = !document.hidden;
            start();
        });

        function start() {
            if (running || !onScreen || !pageVisible) return;
            running = true;
            clock.getDelta();
            animate();
        }

        function animate() {
            if (!onScreen || !pageVisible) {
                running = false;
                return;
            }
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            // Subtle floating
            nodes.forEach((node, i) => {
                if (!node.mesh) return;
                const oy = Math.sin(t * 0.6 + i * 0.9) * 0.06;
                node.mesh.position.y = node.y + oy;
                if (node.ring) {
                    node.ring.position.y = node.y + oy;
                    node.ring.lookAt(camera.position);
                }
                if (node.glow) {
                    node.glow.position.y = node.y + oy;
                    node.glow.material.opacity = 0.03 + Math.sin(t * 1.5) * 0.02;
                }
            });

            // Update edges to follow floating
            edges.forEach(e => {
                if (!e.mesh) return;
                const pos = e.mesh.geometry.attributes.position.array;
                pos[0] = e.from.mesh.position.x; pos[1] = e.from.mesh.position.y; pos[2] = e.from.mesh.position.z;
                pos[3] = e.to.mesh.position.x; pos[4] = e.to.mesh.position.y; pos[5] = e.to.mesh.position.z;
                e.mesh.geometry.attributes.position.needsUpdate = true;
            });

            ambient.rotation.y += 0.0002;

            // Smoothly steer the camera toward the selected cluster
            controls.target.lerp(desiredTarget, 0.06);
            const camDir = camera.position.clone().sub(controls.target);
            const camDist = camDir.length();
            if (Math.abs(camDist - desiredDist) > 0.05) {
                camDir.normalize().multiplyScalar(camDist + (desiredDist - camDist) * 0.06);
                camera.position.copy(controls.target).add(camDir);
            }

            controls.update();
            updateLabels();
            renderer.render(scene, camera);
        }

        running = true;
        animate();

        // ============ RESIZE ============
        function onResize() {
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        }
        window.addEventListener('resize', onResize);

        // ============ AUTO-ROTATE CONTROL ============
        let autoTimer;
        renderer.domElement.addEventListener('pointerdown', () => {
            controls.autoRotate = false;
            clearTimeout(autoTimer);
        });
        renderer.domElement.addEventListener('pointerup', () => {
            autoTimer = setTimeout(() => { controls.autoRotate = true; }, 5000);
        });
    }
})();
