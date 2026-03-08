/* =========================================================
   3D Chess App – Three.js rendering + chess.js logic + AI
   ========================================================= */
(function () {
  'use strict';

  var THREE = window.THREE;

  // ─── Config ───
  var PIECE_UNICODE = {
    wK: '\u2654', wQ: '\u2655', wR: '\u2656', wB: '\u2657', wN: '\u2658', wP: '\u2659',
    bK: '\u265A', bQ: '\u265B', bR: '\u265C', bB: '\u265D', bN: '\u265E', bP: '\u265F'
  };
  var PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // ─── Game State ───
  var game = new Chess();
  var boardFlipped = false;
  var selectedSquare = null;
  var legalMovesForSelected = [];
  var lastMove = null;
  var aiThinking = false;
  var moveHistory = [];
  var animating = false;
  var pendingPromotion = null;

  // ─── DOM ───
  var canvas = document.getElementById('chess-canvas');
  var wrapper = document.getElementById('board-3d-wrapper');
  var statusEl = document.getElementById('status');
  var moveHistoryEl = document.getElementById('move-history');
  var thinkingEl = document.getElementById('thinking-indicator');
  var promotionModal = document.getElementById('promotion-modal');
  var promotionChoices = document.getElementById('promotion-choices');
  var gameoverModal = document.getElementById('gameover-modal');
  var gameoverTitle = document.getElementById('gameover-title');
  var gameoverMessage = document.getElementById('gameover-message');
  var confirmModal = document.getElementById('confirm-modal');
  var capturedBlackEl = document.getElementById('captured-black');
  var capturedWhiteEl = document.getElementById('captured-white');
  var diffTopEl = document.getElementById('diff-top');
  var diffBottomEl = document.getElementById('diff-bottom');
  var moveHistoryContainer = document.querySelector('.move-history-container');

  // ─── Audio ───
  var audioCtx = null;
  function ensureAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  function playSound(type) {
    try {
      ensureAudio();
      var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      var now = audioCtx.currentTime;
      if (type === 'move') { osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(400, now + 0.08); gain.gain.setValueAtTime(0.15, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1); osc.start(now); osc.stop(now + 0.1); }
      else if (type === 'capture') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(300, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.15); gain.gain.setValueAtTime(0.18, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15); osc.start(now); osc.stop(now + 0.15); }
      else if (type === 'check') { osc.type = 'square'; osc.frequency.setValueAtTime(800, now); osc.frequency.setValueAtTime(600, now + 0.1); gain.gain.setValueAtTime(0.12, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2); osc.start(now); osc.stop(now + 0.2); }
      else if (type === 'gameover') { osc.type = 'sine'; osc.frequency.setValueAtTime(500, now); osc.frequency.setValueAtTime(400, now + 0.15); osc.frequency.setValueAtTime(300, now + 0.3); gain.gain.setValueAtTime(0.15, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5); osc.start(now); osc.stop(now + 0.5); }
    } catch (e) {}
  }

  // ═══════════════════════════════════════════
  //  THREE.JS 3D SCENE
  // ═══════════════════════════════════════════

  var scene, camera, renderer, raycaster, mouse;
  var squareMeshes = {};   // 'a1' -> mesh
  var pieceMeshes = {};    // 'a1' -> group
  var highlightMeshes = []; // dots for legal moves
  var selectedHighlight = null;
  var lastMoveHighlights = [];
  var animations = [];

  function initThree() {
    // Ensure wrapper has dimensions
    var wrapW = wrapper.clientWidth || wrapper.offsetWidth || 360;
    var wrapH = wrapper.clientHeight || Math.round(wrapW * 0.85) || 306;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.035);

    // Camera - looking down at an angle
    camera = new THREE.PerspectiveCamera(45, wrapW / wrapH, 0.1, 100);
    setCameraPosition();

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(wrapW, wrapH);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Lights
    var ambient = new THREE.AmbientLight(0x404060, 0.8);
    scene.add(ambient);

    var dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    dirLight.position.set(5, 12, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.camera.left = -8;
    dirLight.shadow.camera.right = 8;
    dirLight.shadow.camera.top = 8;
    dirLight.shadow.camera.bottom = -8;
    dirLight.shadow.bias = -0.002;
    scene.add(dirLight);

    var rimLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    rimLight.position.set(-6, 8, -6);
    scene.add(rimLight);

    var pointLight = new THREE.PointLight(0x00e5ff, 0.4, 20);
    pointLight.position.set(0, 8, 0);
    scene.add(pointLight);

    // Raycaster
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Build board
    buildBoard();

    // Place pieces
    syncPieces();

    // Events
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('touchend', onCanvasTouchEnd, { passive: false });
    window.addEventListener('resize', onResize);

    // Animate loop
    animate();
  }

  function setCameraPosition() {
    if (boardFlipped) {
      camera.position.set(0, 9.5, -7.5);
    } else {
      camera.position.set(0, 9.5, 7.5);
    }
    camera.lookAt(0, 0, 0);
  }

  function buildBoard() {
    // Board base (dark wood slab)
    var baseGeom = new THREE.BoxGeometry(9.2, 0.4, 9.2);
    var baseMat = new THREE.MeshStandardMaterial({
      color: 0x2a1810, roughness: 0.6, metalness: 0.1
    });
    var base = new THREE.Mesh(baseGeom, baseMat);
    base.position.set(0, -0.3, 0);
    base.receiveShadow = true;
    scene.add(base);

    // Board frame (slightly larger, glossy)
    var frameGeom = new THREE.BoxGeometry(8.8, 0.18, 8.8);
    var frameMat = new THREE.MeshStandardMaterial({
      color: 0x3d2415, roughness: 0.3, metalness: 0.2
    });
    var frame = new THREE.Mesh(frameGeom, frameMat);
    frame.position.set(0, -0.08, 0);
    frame.receiveShadow = true;
    scene.add(frame);

    // Squares
    var squareGeom = new THREE.BoxGeometry(1, 0.12, 1);
    var lightMat = new THREE.MeshStandardMaterial({
      color: 0xf0d9b5, roughness: 0.35, metalness: 0.05,
    });
    var darkMat = new THREE.MeshStandardMaterial({
      color: 0xb58863, roughness: 0.4, metalness: 0.05,
    });

    for (var file = 0; file < 8; file++) {
      for (var rank = 0; rank < 8; rank++) {
        var isLight = (file + rank) % 2 === 0;
        var sq = new THREE.Mesh(squareGeom, isLight ? lightMat.clone() : darkMat.clone());
        var pos = squareToWorld(file, rank);
        sq.position.set(pos.x, 0, pos.z);
        sq.receiveShadow = true;
        var sqName = String.fromCharCode(97 + file) + (rank + 1);
        sq.userData.square = sqName;
        sq.userData.isLight = isLight;
        sq.userData.originalColor = isLight ? 0xf0d9b5 : 0xb58863;
        squareMeshes[sqName] = sq;
        scene.add(sq);
      }
    }

    // Ground plane for shadow
    var groundGeom = new THREE.PlaneGeometry(30, 30);
    var groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    var ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  function squareToWorld(file, rank) {
    return { x: file - 3.5, z: 3.5 - rank };
  }

  function squareNameToFileRank(sq) {
    return { file: sq.charCodeAt(0) - 97, rank: parseInt(sq[1]) - 1 };
  }

  // ─── Piece Creation ───
  // Using LatheGeometry for rotationally symmetric pieces

  function createPieceMesh(type, color) {
    var group = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({
      color: color === 'w' ? 0xf5f0e8 : 0x1a1a1a,
      roughness: color === 'w' ? 0.25 : 0.35,
      metalness: color === 'w' ? 0.08 : 0.15,
    });

    var profile;
    switch (type) {
      case 'p': profile = pawnProfile(); break;
      case 'r': profile = rookProfile(); break;
      case 'n': profile = knightProfile(); break;
      case 'b': profile = bishopProfile(); break;
      case 'q': profile = queenProfile(); break;
      case 'k': profile = kingProfile(); break;
    }

    if (type === 'n') {
      // Knight is special - not rotationally symmetric
      var knightGroup = buildKnight(mat);
      group.add(knightGroup);
    } else {
      var latheGeom = new THREE.LatheGeometry(profile, 24);
      var mesh = new THREE.Mesh(latheGeom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    group.userData.pieceColor = color;
    group.userData.pieceType = type;
    return group;
  }

  function pawnProfile() {
    return [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.32, 0),
      new THREE.Vector2(0.34, 0.04),
      new THREE.Vector2(0.28, 0.08),
      new THREE.Vector2(0.16, 0.20),
      new THREE.Vector2(0.13, 0.35),
      new THREE.Vector2(0.11, 0.42),
      new THREE.Vector2(0.18, 0.48),
      new THREE.Vector2(0.20, 0.55),
      new THREE.Vector2(0.17, 0.64),
      new THREE.Vector2(0.10, 0.70),
      new THREE.Vector2(0, 0.72),
    ];
  }

  function rookProfile() {
    return [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.36, 0),
      new THREE.Vector2(0.38, 0.05),
      new THREE.Vector2(0.30, 0.10),
      new THREE.Vector2(0.22, 0.18),
      new THREE.Vector2(0.20, 0.50),
      new THREE.Vector2(0.18, 0.55),
      new THREE.Vector2(0.28, 0.58),
      new THREE.Vector2(0.30, 0.65),
      new THREE.Vector2(0.30, 0.78),
      new THREE.Vector2(0.24, 0.78),
      new THREE.Vector2(0.24, 0.72),
      new THREE.Vector2(0.16, 0.72),
      new THREE.Vector2(0.16, 0.78),
      new THREE.Vector2(0, 0.78),
    ];
  }

  function bishopProfile() {
    return [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.34, 0),
      new THREE.Vector2(0.36, 0.05),
      new THREE.Vector2(0.28, 0.10),
      new THREE.Vector2(0.18, 0.20),
      new THREE.Vector2(0.15, 0.35),
      new THREE.Vector2(0.13, 0.50),
      new THREE.Vector2(0.18, 0.55),
      new THREE.Vector2(0.20, 0.60),
      new THREE.Vector2(0.16, 0.70),
      new THREE.Vector2(0.10, 0.80),
      new THREE.Vector2(0.04, 0.88),
      new THREE.Vector2(0.06, 0.92),
      new THREE.Vector2(0.03, 0.96),
      new THREE.Vector2(0, 0.98),
    ];
  }

  function queenProfile() {
    return [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.36, 0),
      new THREE.Vector2(0.38, 0.05),
      new THREE.Vector2(0.30, 0.10),
      new THREE.Vector2(0.20, 0.20),
      new THREE.Vector2(0.17, 0.40),
      new THREE.Vector2(0.15, 0.55),
      new THREE.Vector2(0.20, 0.60),
      new THREE.Vector2(0.22, 0.65),
      new THREE.Vector2(0.18, 0.75),
      new THREE.Vector2(0.22, 0.80),
      new THREE.Vector2(0.20, 0.88),
      new THREE.Vector2(0.14, 0.92),
      new THREE.Vector2(0.08, 0.98),
      new THREE.Vector2(0.10, 1.02),
      new THREE.Vector2(0.06, 1.06),
      new THREE.Vector2(0, 1.08),
    ];
  }

  function kingProfile() {
    return [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.38, 0),
      new THREE.Vector2(0.40, 0.05),
      new THREE.Vector2(0.32, 0.10),
      new THREE.Vector2(0.22, 0.20),
      new THREE.Vector2(0.18, 0.40),
      new THREE.Vector2(0.16, 0.55),
      new THREE.Vector2(0.22, 0.60),
      new THREE.Vector2(0.24, 0.68),
      new THREE.Vector2(0.20, 0.78),
      new THREE.Vector2(0.14, 0.88),
      new THREE.Vector2(0.08, 0.95),
      new THREE.Vector2(0.03, 1.00),
      new THREE.Vector2(0, 1.02),
    ];
  }

  function buildKnight(mat) {
    var g = new THREE.Group();
    // Base
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.1, 20), mat);
    base.position.y = 0.05;
    base.castShadow = true;
    g.add(base);
    // Collar
    var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.28, 0.12, 16), mat);
    collar.position.y = 0.16;
    collar.castShadow = true;
    g.add(collar);
    // Neck (angled cylinder)
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.45, 12), mat);
    neck.position.set(0, 0.42, -0.05);
    neck.rotation.x = -0.15;
    neck.castShadow = true;
    g.add(neck);
    // Head
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.38), mat);
    head.position.set(0, 0.65, -0.12);
    head.rotation.x = -0.3;
    head.castShadow = true;
    g.add(head);
    // Snout
    var snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.22), mat);
    snout.position.set(0, 0.58, -0.30);
    snout.rotation.x = -0.1;
    snout.castShadow = true;
    g.add(snout);
    // Ear
    var ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 8), mat);
    ear.position.set(0, 0.82, -0.08);
    ear.castShadow = true;
    g.add(ear);
    return g;
  }

  // King gets a cross on top
  function addKingCross(group, mat) {
    var vBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), mat);
    vBar.position.y = 1.12;
    vBar.castShadow = true;
    group.add(vBar);
    var hBar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.05), mat);
    hBar.position.y = 1.16;
    hBar.castShadow = true;
    group.add(hBar);
  }

  // ─── Piece Sync ───
  function syncPieces() {
    // Remove all existing piece meshes
    Object.keys(pieceMeshes).forEach(function (sq) {
      scene.remove(pieceMeshes[sq]);
    });
    pieceMeshes = {};

    var board = game.board();
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var piece = board[r][c];
        if (piece) {
          var rank = 8 - r; // board[0] = rank 8
          var file = c;
          var sqName = String.fromCharCode(97 + file) + rank;
          var mesh = createPieceMesh(piece.type, piece.color);

          // Add king cross
          if (piece.type === 'k') {
            var kingMat = mesh.children[0].material;
            addKingCross(mesh, kingMat);
          }

          var pos = squareToWorld(file, rank - 1);
          mesh.position.set(pos.x, 0.06, pos.z);
          mesh.userData.square = sqName;
          scene.add(mesh);
          pieceMeshes[sqName] = mesh;
        }
      }
    }
  }

  // ─── Highlights ───
  function clearHighlights() {
    highlightMeshes.forEach(function (m) { scene.remove(m); });
    highlightMeshes = [];
    if (selectedHighlight) { scene.remove(selectedHighlight); selectedHighlight = null; }
    // Restore square colors
    Object.keys(squareMeshes).forEach(function (sq) {
      squareMeshes[sq].material.color.setHex(squareMeshes[sq].userData.originalColor);
      squareMeshes[sq].material.emissive.setHex(0x000000);
    });
  }

  function showLastMoveHighlight() {
    lastMoveHighlights.forEach(function (sq) {
      if (squareMeshes[sq]) {
        squareMeshes[sq].material.emissive.setHex(0x443300);
        squareMeshes[sq].material.emissiveIntensity = 0.5;
      }
    });
  }

  function showSelectedHighlight(sq) {
    if (!squareMeshes[sq]) return;
    // Glow plane on selected square
    var glowGeom = new THREE.PlaneGeometry(0.95, 0.95);
    var glowMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.35,
      side: THREE.DoubleSide
    });
    selectedHighlight = new THREE.Mesh(glowGeom, glowMat);
    var fr = squareNameToFileRank(sq);
    var pos = squareToWorld(fr.file, fr.rank);
    selectedHighlight.position.set(pos.x, 0.08, pos.z);
    selectedHighlight.rotation.x = -Math.PI / 2;
    scene.add(selectedHighlight);

    squareMeshes[sq].material.emissive.setHex(0x006688);
    squareMeshes[sq].material.emissiveIntensity = 0.6;
  }

  function showLegalMoveHighlights(moves) {
    moves.forEach(function (m) {
      var fr = squareNameToFileRank(m.to);
      var pos = squareToWorld(fr.file, fr.rank);
      var isCapture = m.captured || (game.get(m.to) !== null);

      if (isCapture) {
        // Ring for captures
        var ringGeom = new THREE.RingGeometry(0.32, 0.42, 24);
        var ringMat = new THREE.MeshBasicMaterial({
          color: 0xff4444, transparent: true, opacity: 0.6,
          side: THREE.DoubleSide
        });
        var ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.set(pos.x, 0.08, pos.z);
        ring.rotation.x = -Math.PI / 2;
        ring.userData.targetSquare = m.to;
        scene.add(ring);
        highlightMeshes.push(ring);
      } else {
        // Dot for moves
        var dotGeom = new THREE.SphereGeometry(0.12, 12, 12);
        var dotMat = new THREE.MeshBasicMaterial({
          color: 0x00e5ff, transparent: true, opacity: 0.6,
        });
        var dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.set(pos.x, 0.12, pos.z);
        dot.userData.targetSquare = m.to;
        scene.add(dot);
        highlightMeshes.push(dot);
      }
    });
  }

  function showCheckHighlight() {
    if (!game.in_check()) return;
    var turn = game.turn();
    var board = game.board();
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (p && p.type === 'k' && p.color === turn) {
          var sq = String.fromCharCode(97 + c) + (8 - r);
          if (squareMeshes[sq]) {
            squareMeshes[sq].material.emissive.setHex(0x880000);
            squareMeshes[sq].material.emissiveIntensity = 0.8;
          }
        }
      }
    }
  }

  function updateHighlights() {
    clearHighlights();
    // Last move
    if (lastMove) {
      lastMoveHighlights = [lastMove.from, lastMove.to];
      showLastMoveHighlight();
    } else {
      lastMoveHighlights = [];
    }
    // Selected
    if (selectedSquare) {
      showSelectedHighlight(selectedSquare);
      showLegalMoveHighlights(legalMovesForSelected);
    }
    // Check
    showCheckHighlight();
  }

  // ─── Animation System ───
  function animatePieceMove(fromSq, toSq, callback) {
    var mesh = pieceMeshes[fromSq];
    if (!mesh) { callback(); return; }

    var fromFR = squareNameToFileRank(fromSq);
    var toFR = squareNameToFileRank(toSq);
    var fromPos = squareToWorld(fromFR.file, fromFR.rank);
    var toPos = squareToWorld(toFR.file, toFR.rank);

    var startX = fromPos.x, startZ = fromPos.z;
    var endX = toPos.x, endZ = toPos.z;
    var startY = 0.06;
    var liftHeight = 0.6;
    var duration = 450; // ms
    var startTime = null;

    animating = true;

    function step(time) {
      if (!startTime) startTime = time;
      var t = Math.min((time - startTime) / duration, 1);

      // Ease in-out
      var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      // Position
      mesh.position.x = startX + (endX - startX) * ease;
      mesh.position.z = startZ + (endZ - startZ) * ease;

      // Lift arc
      var arc = Math.sin(t * Math.PI);
      mesh.position.y = startY + liftHeight * arc;

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        mesh.position.set(endX, startY, endZ);
        // Update mesh tracking
        delete pieceMeshes[fromSq];
        pieceMeshes[toSq] = mesh;
        mesh.userData.square = toSq;
        animating = false;
        callback();
      }
    }
    requestAnimationFrame(step);
  }

  // ─── Input Handling ───
  function getSquareFromEvent(event) {
    var rect = canvas.getBoundingClientRect();
    var x, y;
    if (event.changedTouches) {
      x = event.changedTouches[0].clientX;
      y = event.changedTouches[0].clientY;
    } else {
      x = event.clientX;
      y = event.clientY;
    }
    mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((y - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check square meshes
    var meshArray = Object.values(squareMeshes);
    var intersects = raycaster.intersectObjects(meshArray);
    if (intersects.length > 0) {
      return intersects[0].object.userData.square;
    }

    // Check highlight dots/rings
    var hlIntersects = raycaster.intersectObjects(highlightMeshes);
    if (hlIntersects.length > 0 && hlIntersects[0].object.userData.targetSquare) {
      return hlIntersects[0].object.userData.targetSquare;
    }

    // Check piece meshes (traverse groups)
    var pieceObjects = [];
    Object.values(pieceMeshes).forEach(function (g) {
      g.traverse(function (child) {
        if (child.isMesh) {
          child.userData._parentSquare = g.userData.square;
          pieceObjects.push(child);
        }
      });
    });
    var pieceIntersects = raycaster.intersectObjects(pieceObjects);
    if (pieceIntersects.length > 0) {
      return pieceIntersects[0].object.userData._parentSquare;
    }

    return null;
  }

  function onCanvasClick(event) {
    handleInput(event);
  }

  var touchHandled = false;
  function onCanvasTouchEnd(event) {
    event.preventDefault();
    touchHandled = true;
    handleInput(event);
    setTimeout(function () { touchHandled = false; }, 300);
  }

  function handleInput(event) {
    if (aiThinking || animating) return;
    if (game.game_over()) return;
    if (game.turn() !== 'w') return;

    var sq = getSquareFromEvent(event);
    if (!sq) return;

    var piece = game.get(sq);

    if (selectedSquare) {
      if (piece && piece.color === 'w') {
        if (sq === selectedSquare) {
          selectedSquare = null;
          legalMovesForSelected = [];
          updateHighlights();
          return;
        }
        selectSquare(sq);
        return;
      }

      var move = legalMovesForSelected.find(function (m) { return m.to === sq; });
      if (move) {
        var promoMoves = legalMovesForSelected.filter(function (m) { return m.to === sq && m.promotion; });
        if (promoMoves.length > 0) {
          pendingPromotion = { from: selectedSquare, to: sq };
          showPromotionDialog();
          return;
        }
        executeHumanMove(selectedSquare, sq);
      } else {
        selectedSquare = null;
        legalMovesForSelected = [];
        updateHighlights();
      }
    } else {
      if (piece && piece.color === 'w') {
        selectSquare(sq);
      }
    }
  }

  function selectSquare(sq) {
    selectedSquare = sq;
    legalMovesForSelected = game.moves({ square: sq, verbose: true });
    updateHighlights();
  }

  function executeHumanMove(from, to, promotion) {
    // Remove captured piece mesh if any
    if (pieceMeshes[to]) {
      scene.remove(pieceMeshes[to]);
      delete pieceMeshes[to];
    }

    clearHighlights();

    animatePieceMove(from, to, function () {
      var moveObj = { from: from, to: to, promotion: promotion || undefined };
      var result = game.move(moveObj);
      if (!result) {
        syncPieces();
        updateHighlights();
        return;
      }

      // Handle castling - move rook too
      if (result.flags.indexOf('k') !== -1) { // kingside
        syncPieces(); // easiest way to handle rook movement
      } else if (result.flags.indexOf('q') !== -1) { // queenside
        syncPieces();
      }

      // Handle en passant
      if (result.flags.indexOf('e') !== -1) {
        syncPieces();
      }

      // Handle promotion - replace piece
      if (result.promotion) {
        syncPieces();
      }

      lastMove = { from: from, to: to };
      moveHistory.push(result.san);
      selectedSquare = null;
      legalMovesForSelected = [];

      if (game.in_check()) playSound('check');
      else if (result.captured) playSound('capture');
      else playSound('move');

      updateHighlights();
      updateStatus();
      updateMoveHistory();
      updateCaptured();

      if (game.game_over()) { showGameOver(); return; }
      scheduleAI();
    });
  }

  // ─── Promotion Dialog ───
  function showPromotionDialog() {
    promotionChoices.innerHTML = '';
    var pieces = ['q', 'r', 'b', 'n'];
    var symbols = { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658' };
    pieces.forEach(function (p) {
      var btn = document.createElement('button');
      btn.textContent = symbols[p];
      btn.addEventListener('click', function () {
        promotionModal.classList.add('hidden');
        var pp = pendingPromotion;
        pendingPromotion = null;
        executeHumanMove(pp.from, pp.to, p);
      });
      promotionChoices.appendChild(btn);
    });
    promotionModal.classList.remove('hidden');
  }

  // ─── Game Over ───
  function showGameOver() {
    playSound('gameover');
    var title = 'Game Over', msg = '';
    if (game.in_checkmate()) {
      title = game.turn() === 'w' ? 'Black Wins!' : 'White Wins!';
      msg = 'Checkmate';
    } else if (game.in_stalemate()) { title = 'Draw'; msg = 'Stalemate'; }
    else if (game.in_threefold_repetition()) { title = 'Draw'; msg = 'Threefold repetition'; }
    else if (game.insufficient_material()) { title = 'Draw'; msg = 'Insufficient material'; }
    else if (game.in_draw()) { title = 'Draw'; msg = '50-move rule'; }
    gameoverTitle.textContent = title;
    gameoverMessage.textContent = msg;
    gameoverModal.classList.remove('hidden');
  }

  document.getElementById('gameover-newgame').addEventListener('click', function () {
    gameoverModal.classList.add('hidden');
    newGame();
  });

  // ─── AI (Backend) ───
  var AI_API_URL = (function () {
    if (window.location.port === '8080' || window.location.hostname === '213.35.120.193') {
      return window.location.origin + window.location.pathname.replace(/\/(?:index\.html)?$/, '') + '/api/ai-move';
    }
    return 'http://213.35.120.193:8080/chess/api/ai-move';
  })();

  function scheduleAI() {
    aiThinking = true;
    thinkingEl.classList.remove('hidden');

    fetch(AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: game.fen(), depth: 3 })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.move) { aiThinking = false; thinkingEl.classList.add('hidden'); return; }
      var bestMove = data.move;

      // Remove captured piece
      if (pieceMeshes[bestMove.to]) {
        scene.remove(pieceMeshes[bestMove.to]);
        delete pieceMeshes[bestMove.to];
      }

      clearHighlights();

      animatePieceMove(bestMove.from, bestMove.to, function () {
        var result = game.move(bestMove);
        if (!result) { syncPieces(); aiThinking = false; thinkingEl.classList.add('hidden'); return; }

        // Handle special moves
        if (result.flags.indexOf('k') !== -1 || result.flags.indexOf('q') !== -1 || result.flags.indexOf('e') !== -1 || result.promotion) {
          syncPieces();
        }

        lastMove = { from: bestMove.from, to: bestMove.to };
        moveHistory.push(result.san);
        aiThinking = false;
        thinkingEl.classList.add('hidden');

        if (game.in_check()) playSound('check');
        else if (result.captured) playSound('capture');
        else playSound('move');

        updateHighlights();
        updateStatus();
        updateMoveHistory();
        updateCaptured();

        if (game.game_over()) showGameOver();
      });
    })
    .catch(function (err) {
      console.error('AI error:', err);
      aiThinking = false;
      thinkingEl.classList.add('hidden');
    });
  }

  // ─── Status ───
  function updateStatus() {
    var text = '';
    if (game.in_checkmate()) {
      text = game.turn() === 'w' ? 'Checkmate \u2013 Black wins' : 'Checkmate \u2013 White wins';
      statusEl.className = 'status-text game-over';
    } else if (game.in_stalemate() || game.in_draw()) {
      text = 'Draw'; statusEl.className = 'status-text game-over';
    } else if (game.in_check()) {
      text = (game.turn() === 'w' ? 'White' : 'Black') + ' is in check';
      statusEl.className = 'status-text in-check';
    } else {
      text = (game.turn() === 'w' ? 'White' : 'Black') + ' to move';
      statusEl.className = 'status-text';
    }
    statusEl.textContent = text;
  }

  // ─── Move History ───
  function updateMoveHistory() {
    moveHistoryEl.innerHTML = '';
    for (var i = 0; i < moveHistory.length; i += 2) {
      var num = document.createElement('span');
      num.className = 'move-number';
      num.textContent = (Math.floor(i / 2) + 1) + '.';
      moveHistoryEl.appendChild(num);
      var w = document.createElement('span');
      w.className = 'move-entry';
      w.textContent = moveHistory[i];
      moveHistoryEl.appendChild(w);
      if (i + 1 < moveHistory.length) {
        var b = document.createElement('span');
        b.className = 'move-entry';
        b.textContent = moveHistory[i + 1];
        moveHistoryEl.appendChild(b);
      }
    }
    moveHistoryContainer.scrollTop = moveHistoryContainer.scrollHeight;
  }

  // ─── Captured ───
  function updateCaptured() {
    var init = { w: { p: 8, n: 2, b: 2, r: 2, q: 1 }, b: { p: 8, n: 2, b: 2, r: 2, q: 1 } };
    var curr = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    var board = game.board();
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = board[r][c];
      if (p && p.type !== 'k') curr[p.color][p.type]++;
    }
    var order = ['q', 'r', 'b', 'n', 'p'];
    var capByW = {}, capByB = {};
    var wMat = 0, bMat = 0;
    order.forEach(function (t) {
      capByW[t] = init.b[t] - curr.b[t];
      capByB[t] = init.w[t] - curr.w[t];
      wMat += curr.w[t] * PIECE_VALUES[t];
      bMat += curr.b[t] * PIECE_VALUES[t];
    });
    var symW = { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' };
    var symB = { q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };
    var topCap = boardFlipped ? capByB : capByW;
    var botCap = boardFlipped ? capByW : capByB;
    var topSym = boardFlipped ? symW : symB;
    var botSym = boardFlipped ? symB : symW;

    function render(el, cap, sym) {
      el.innerHTML = '';
      order.forEach(function (t) {
        for (var i = 0; i < cap[t]; i++) {
          var s = document.createElement('span');
          s.textContent = sym[t]; el.appendChild(s);
        }
      });
    }
    render(boardFlipped ? capturedWhiteEl : capturedBlackEl, topCap, topSym);
    render(boardFlipped ? capturedBlackEl : capturedWhiteEl, botCap, botSym);

    var diff = wMat - bMat;
    diffTopEl.textContent = boardFlipped ? (diff > 0 ? '+' + Math.floor(diff / 100) : '') : (diff < 0 ? '+' + Math.floor(-diff / 100) : '');
    diffBottomEl.textContent = boardFlipped ? (diff < 0 ? '+' + Math.floor(-diff / 100) : '') : (diff > 0 ? '+' + Math.floor(diff / 100) : '');
  }

  // ─── Controls ───
  document.getElementById('btn-new').addEventListener('click', function () {
    if (game.history().length > 0) confirmModal.classList.remove('hidden');
    else newGame();
  });
  document.getElementById('confirm-yes').addEventListener('click', function () {
    confirmModal.classList.add('hidden'); newGame();
  });
  document.getElementById('confirm-no').addEventListener('click', function () {
    confirmModal.classList.add('hidden');
  });
  document.getElementById('btn-undo').addEventListener('click', function () {
    if (aiThinking || animating) return;
    if (game.history().length >= 2 && game.turn() === 'w') {
      game.undo(); game.undo(); moveHistory.pop(); moveHistory.pop();
    } else if (game.history().length >= 1 && game.turn() === 'w') {
      game.undo(); moveHistory.pop();
    } else return;
    selectedSquare = null; legalMovesForSelected = []; lastMove = null;
    var hist = game.history({ verbose: true });
    if (hist.length > 0) { var lm = hist[hist.length - 1]; lastMove = { from: lm.from, to: lm.to }; }
    syncPieces(); updateHighlights(); updateStatus(); updateMoveHistory(); updateCaptured();
  });
  document.getElementById('btn-flip').addEventListener('click', function () {
    boardFlipped = !boardFlipped;
    selectedSquare = null; legalMovesForSelected = [];
    setCameraPosition();
    updateHighlights(); updateCaptured();
  });

  // ─── New Game ───
  function newGame() {
    game = new Chess();
    boardFlipped = false; selectedSquare = null; legalMovesForSelected = [];
    lastMove = null; aiThinking = false; animating = false;
    moveHistory = []; pendingPromotion = null;
    thinkingEl.classList.add('hidden');
    gameoverModal.classList.add('hidden');
    promotionModal.classList.add('hidden');
    setCameraPosition();
    syncPieces(); updateHighlights(); updateStatus(); updateMoveHistory(); updateCaptured();
  }

  // ─── Resize ───
  function onResize() {
    var w = wrapper.clientWidth || wrapper.offsetWidth || 360;
    var h = wrapper.clientHeight || Math.round(w * 0.85) || 306;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // ─── Render Loop ───
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }

  // ─── Init ───
  if (typeof THREE === 'undefined') {
    document.getElementById('board-3d-wrapper').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff5252;font-size:0.9rem;padding:20px;text-align:center">3D engine failed to load. Please refresh.</div>';
  } else {
    initThree();
    updateStatus();
    updateMoveHistory();
    updateCaptured();
    updateHighlights();
  }

  document.addEventListener('touchstart', ensureAudio, { once: true });
  document.addEventListener('click', ensureAudio, { once: true });

})();
