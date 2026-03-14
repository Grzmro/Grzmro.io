/**
 * 3D Interactive Skills Graph — v2
 * Clean, compact Three.js graph with readable labels
 */

(function () {
    function waitForThree(cb) {
        if (typeof THREE !== 'undefined' && typeof THREE.OrbitControls !== 'undefined') cb();
        else setTimeout(() => waitForThree(cb), 50);
    }

    waitForThree(init3DGraph);

    function init3DGraph() {
        const container = document.getElementById('skills-graph-container');
        if (!container) return;

        // ============ SETUP ============
        const scene = new THREE.Scene();
        const width = container.clientWidth;
        const height = container.clientHeight;

        const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
        camera.position.set(0, 0, 26);

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
        controls.minDistance = 14;
        controls.maxDistance = 35;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;

        // ============ DATA ============
        const categories = [
            { name: 'ML & AI', color: '#3b82f6', hex: 0x3b82f6, skills: ['Keras', 'scikit-learn', 'TensorFlow', 'Prompt Eng.'] },
            { name: 'Data Science', color: '#06b6d4', hex: 0x06b6d4, skills: ['Python', 'pandas', 'NumPy', 'SQL', 'R'] },
            { name: 'Projects', color: '#f59e0b', hex: 0xf59e0b, skills: ['Football Predictor', 'Darwin World'] },
            { name: 'Mathematics', color: '#a855f7', hex: 0xa855f7, skills: ['Linear Algebra', 'Probability', 'Statistics', 'ODEs/PDEs'] },
            { name: 'Tools', color: '#22c55e', hex: 0x22c55e, skills: ['Git', 'Jupyter', 'Airflow', 'Jira', 'Linux'] },
        ];

        // ============ LAYOUT ============
        const nodes = [];
        const edges = [];

        // Central node
        const center = { name: 'GM', x: 0, y: 0, z: 0, type: 'center', color: 0x60a5fa, colorStr: '#60a5fa' };
        nodes.push(center);

        const catRadius = 6.5;

        categories.forEach((cat, i) => {
            const angle = (i / categories.length) * Math.PI * 2 - Math.PI / 2;
            const zOff = (i % 2 === 0 ? 1.5 : -1.5);

            const catNode = {
                name: cat.name,
                x: Math.cos(angle) * catRadius,
                y: Math.sin(angle) * catRadius,
                z: zOff,
                type: 'category',
                color: cat.hex,
                colorStr: cat.color
            };
            nodes.push(catNode);
            edges.push({ from: center, to: catNode, color: cat.hex, opacity: 0.35 });

            const skillR = 3.8;
            const spread = 0.55;
            cat.skills.forEach((skill, j) => {
                const sAngle = angle + (j - (cat.skills.length - 1) / 2) * spread;
                const jitterZ = (Math.random() - 0.5) * 3.0; // More depth variation

                const sNode = {
                    name: skill,
                    x: catNode.x + Math.cos(sAngle) * skillR,
                    y: catNode.y + Math.sin(sAngle) * skillR,
                    z: catNode.z + jitterZ,
                    type: 'skill',
                    color: cat.hex,
                    colorStr: cat.color
                };
                nodes.push(sNode);
                edges.push({ from: catNode, to: sNode, color: cat.hex, opacity: 0.2 });
            });
        });

        // Cross-connections (subtle)
        const crossPairs = [
            ['Python', 'scikit-learn'], ['Python', 'pandas'], ['Linear Algebra', 'TensorFlow'],
            ['Probability', 'Statistics'], ['SQL', 'pandas']
        ];
        crossPairs.forEach(([a, b]) => {
            const nA = nodes.find(n => n.name === a);
            const nB = nodes.find(n => n.name === b);
            if (nA && nB) edges.push({ from: nA, to: nB, color: 0x1e293b, opacity: 0.08, cross: true });
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

            el.style.cssText = `
                position:absolute;
                font-family:'Inter',sans-serif;
                font-weight:${isCenter ? '800' : isCat ? '700' : '600'};
                font-size:${isCenter ? '18px' : isCat ? '14px' : '11px'};
                color:${isCenter ? '#ffffff' : isCat ? node.colorStr : '#cbd5e1'};
                background:${isCenter ? 'rgba(59,130,246,0.25)' : isCat ? 'rgba(0,0,0,0.7)' : 'rgba(15,23,42,0.8)'};
                border:1.5px solid ${isCenter ? 'rgba(96,165,250,0.6)' : isCat ? node.colorStr : 'rgba(255,255,255,0.1)'};
                padding:${isCenter ? '6px 16px' : isCat ? '4px 12px' : '3px 10px'};
                border-radius:${isCenter ? '10px' : '8px'};
                white-space:nowrap;
                transform:translate(-50%,-50%);
                pointer-events:none;
                backdrop-filter:blur(6px);
                letter-spacing:${isCenter ? '1.5px' : '0.5px'};
                text-shadow:0 1px 4px rgba(0,0,0,0.8);
                transition:opacity 0.3s ease;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
        const pMat = new THREE.PointsMaterial({ color: 0x3b82f6, size: 0.05, transparent: true, opacity: 0.3 });
        const ambient = new THREE.Points(pGeo, pMat);
        scene.add(ambient);

        // ============ ANIMATION ============
        const clock = new THREE.Clock();

        function animate() {
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

            controls.update();
            updateLabels();
            renderer.render(scene, camera);
        }

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
