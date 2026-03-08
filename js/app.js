(function () {
  'use strict';

  var THREE = window.THREE;
  var ChessCtor = window.Chess;

  var PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  var PIECE_UNICODE = {
    wQ: '\u2655',
    wR: '\u2656',
    wB: '\u2657',
    wN: '\u2658',
    bQ: '\u265B',
    bR: '\u265C',
    bB: '\u265D',
    bN: '\u265E',
    bP: '\u265F',
    wP: '\u2659'
  };
  var PROMOTION_LABELS = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

  var dom = {
    canvas: document.getElementById('chess-canvas'),
    wrapper: document.getElementById('board-3d-wrapper'),
    status: document.getElementById('status'),
    turnPill: document.getElementById('turn-pill'),
    boardHint: document.getElementById('board-hint'),
    orientationLabel: document.getElementById('orientation-label'),
    thinking: document.getElementById('thinking-indicator'),
    moveHistory: document.getElementById('move-history'),
    moveHistoryContainer: document.querySelector('.move-history-container'),
    capturedBlack: document.getElementById('captured-black'),
    capturedWhite: document.getElementById('captured-white'),
    diffTop: document.getElementById('diff-top'),
    diffBottom: document.getElementById('diff-bottom'),
    capturedTopLabel: document.getElementById('captured-top-label'),
    capturedBottomLabel: document.getElementById('captured-bottom-label'),
    promotionModal: document.getElementById('promotion-modal'),
    promotionChoices: document.getElementById('promotion-choices'),
    gameoverModal: document.getElementById('gameover-modal'),
    gameoverTitle: document.getElementById('gameover-title'),
    gameoverMessage: document.getElementById('gameover-message'),
    confirmModal: document.getElementById('confirm-modal'),
    gameoverNew: document.getElementById('gameover-newgame'),
    confirmYes: document.getElementById('confirm-yes'),
    confirmNo: document.getElementById('confirm-no'),
    btnNew: document.getElementById('btn-new'),
    btnUndo: document.getElementById('btn-undo'),
    btnFlip: document.getElementById('btn-flip')
  };

  var state = {
    game: null,
    boardFlipped: false,
    selectedSquare: null,
    legalMoves: [],
    lastMove: null,
    aiThinking: false,
    animating: false,
    pendingPromotion: null,
    aiAbortController: null,
    aiRequestToken: 0,
    audioCtx: null,
    pointerDown: null,
    engineMessage: ''
  };

  var scene;
  var camera;
  var renderer;
  var raycaster;
  var mouse;
  var clock;
  var boardGroup;
  var piecesGroup;
  var highlightGroup;
  var atmosphereGroup;
  var accentLight;
  var keyLight;
  var rimLight;
  var cameraTarget;

  var squareMeshes = {};
  var pieceMeshes = {};
  var highlightMeshes = [];
  var selectedHighlight = null;

  var AI_API_URL = resolveApiUrl();

  function resolveApiUrl() {
    var basePath = window.location.pathname.replace(/\/(?:index\.html)?$/, '');
    return window.location.origin + (basePath || '') + '/api/ai-move';
  }

  function createGame() {
    state.game = new ChessCtor();
  }

  function showLoadError(message) {
    if (!dom.wrapper) return;
    dom.wrapper.innerHTML = '<div class="board-error">' + message + '</div>';
  }

  function wireUiActions() {
    dom.btnNew.addEventListener('click', function () {
      if (state.game && state.game.history().length) {
        dom.confirmModal.classList.remove('hidden');
      } else {
        newGame();
      }
    });

    dom.btnUndo.addEventListener('click', function () {
      undoMove();
    });

    dom.btnFlip.addEventListener('click', function () {
      flipBoard();
    });

    dom.gameoverNew.addEventListener('click', function () {
      dom.gameoverModal.classList.add('hidden');
      newGame();
    });

    dom.confirmYes.addEventListener('click', function () {
      dom.confirmModal.classList.add('hidden');
      newGame();
    });

    dom.confirmNo.addEventListener('click', function () {
      dom.confirmModal.classList.add('hidden');
    });

    dom.confirmModal.addEventListener('click', function (event) {
      if (event.target === dom.confirmModal) {
        dom.confirmModal.classList.add('hidden');
      }
    });

    dom.gameoverModal.addEventListener('click', function (event) {
      if (event.target === dom.gameoverModal) {
        dom.gameoverModal.classList.add('hidden');
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      dom.confirmModal.classList.add('hidden');
      dom.gameoverModal.classList.add('hidden');
    });

    document.addEventListener('pointerdown', primeAudio, { once: true });
    document.addEventListener('touchstart', primeAudio, { once: true, passive: true });
  }

  function primeAudio() {
    if (!window.AudioContext && !window.webkitAudioContext) return;
    ensureAudio();
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(function () {});
    }
  }

  function ensureAudio() {
    if (state.audioCtx || (!window.AudioContext && !window.webkitAudioContext)) return;
    try {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {}
  }

  function playSound(type) {
    ensureAudio();
    if (!state.audioCtx) return;

    try {
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume().catch(function () {});
      }

      var osc = state.audioCtx.createOscillator();
      var gain = state.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(state.audioCtx.destination);

      var now = state.audioCtx.currentTime;

      if (type === 'move') {
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.type = 'triangle';
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'capture') {
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.16);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.type = 'sawtooth';
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'check') {
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(640, now + 0.1);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.type = 'square';
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'gameover') {
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.setValueAtTime(430, now + 0.12);
        osc.frequency.setValueAtTime(320, now + 0.26);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.type = 'sine';
        osc.start(now);
        osc.stop(now + 0.45);
      }
    } catch (error) {}
  }

  function initThree() {
    var size = getCanvasSize();

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06111d, 0.024);

    camera = new THREE.PerspectiveCamera(40, size.width / size.height, 0.1, 120);
    cameraTarget = new THREE.Vector3(0, 9.6, 8.2);

    renderer = new THREE.WebGLRenderer({
      canvas: dom.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size.width, size.height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    if ('outputEncoding' in renderer && THREE.sRGBEncoding) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    mouse = new THREE.Vector2();
    raycaster = new THREE.Raycaster();
    clock = new THREE.Clock();

    boardGroup = new THREE.Group();
    piecesGroup = new THREE.Group();
    highlightGroup = new THREE.Group();
    boardGroup.add(piecesGroup);
    boardGroup.add(highlightGroup);
    scene.add(boardGroup);

    atmosphereGroup = buildAtmosphere();
    scene.add(atmosphereGroup);

    buildLights();
    buildBoard();
    setCameraGoal(true);
    syncPieces();

    dom.canvas.addEventListener('pointerdown', onCanvasPointerDown);
    dom.canvas.addEventListener('pointerup', onCanvasPointerUp);
    dom.canvas.addEventListener('pointercancel', clearPointerState);
    dom.canvas.addEventListener('pointerleave', clearPointerState);
    window.addEventListener('resize', onResize);

    animate();
  }

  function getCanvasSize() {
    return {
      width: dom.wrapper.clientWidth || 360,
      height: dom.wrapper.clientHeight || 372
    };
  }

  function buildLights() {
    var hemisphere = new THREE.HemisphereLight(0xcdefff, 0x08111d, 1.35);
    scene.add(hemisphere);

    keyLight = new THREE.DirectionalLight(0xfff3dd, 1.55);
    keyLight.position.set(6, 11, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.bias = -0.0015;
    scene.add(keyLight);

    rimLight = new THREE.DirectionalLight(0x78d8ff, 0.48);
    rimLight.position.set(-7, 6, -6);
    scene.add(rimLight);

    accentLight = new THREE.PointLight(0xffc56f, 0.95, 22);
    accentLight.position.set(0, 6.8, 0);
    scene.add(accentLight);
  }

  function buildAtmosphere() {
    var group = new THREE.Group();

    var halo = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 6.4, 80),
      new THREE.MeshBasicMaterial({
        color: 0x76e7ff,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.42;
    group.add(halo);

    var glow = new THREE.Mesh(
      new THREE.CircleGeometry(7.8, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffc56f,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.48;
    group.add(glow);

    var particleCount = 110;
    var positions = new Float32Array(particleCount * 3);
    for (var index = 0; index < particleCount; index++) {
      var radius = 7 + Math.random() * 7;
      var angle = Math.random() * Math.PI * 2;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = 0.4 + Math.random() * 5.8;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
    }

    var particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    var particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        color: 0x9beeff,
        size: 0.09,
        transparent: true,
        opacity: 0.7
      })
    );

    group.add(particles);
    group.userData.particles = particles;
    return group;
  }

  function buildBoard() {
    var plinth = new THREE.Mesh(
      new THREE.BoxGeometry(10.2, 0.62, 10.2),
      new THREE.MeshStandardMaterial({
        color: 0x1b1310,
        roughness: 0.62,
        metalness: 0.08
      })
    );
    plinth.position.y = -0.42;
    plinth.receiveShadow = true;
    boardGroup.add(plinth);

    var frame = new THREE.Mesh(
      new THREE.BoxGeometry(9.3, 0.24, 9.3),
      new THREE.MeshStandardMaterial({
        color: 0x46311c,
        roughness: 0.32,
        metalness: 0.14
      })
    );
    frame.position.y = -0.11;
    frame.receiveShadow = true;
    boardGroup.add(frame);

    var glassPlate = new THREE.Mesh(
      new THREE.BoxGeometry(8.35, 0.08, 8.35),
      new THREE.MeshPhysicalMaterial({
        color: 0x6ac7db,
        transparent: true,
        opacity: 0.08,
        roughness: 0.08,
        metalness: 0.02,
        clearcoat: 1,
        clearcoatRoughness: 0.08
      })
    );
    glassPlate.position.y = 0.12;
    boardGroup.add(glassPlate);

    var squareGeometry = new THREE.BoxGeometry(1, 0.14, 1);
    for (var file = 0; file < 8; file++) {
      for (var rank = 0; rank < 8; rank++) {
        var isLight = (file + rank) % 2 === 0;
        var material = new THREE.MeshPhysicalMaterial({
          color: isLight ? 0xf4dfbf : 0x7b5434,
          roughness: isLight ? 0.26 : 0.42,
          metalness: 0.03,
          clearcoat: 0.2,
          clearcoatRoughness: 0.35
        });

        var square = new THREE.Mesh(squareGeometry, material);
        var squarePosition = squareToWorld(file, rank);
        square.position.set(squarePosition.x, 0, squarePosition.z);
        square.receiveShadow = true;

        var squareName = String.fromCharCode(97 + file) + (rank + 1);
        square.userData.square = squareName;
        square.userData.isLight = isLight;
        square.userData.originalColor = isLight ? 0xf4dfbf : 0x7b5434;
        squareMeshes[squareName] = square;
        boardGroup.add(square);
      }
    }

    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(18, 80),
      new THREE.ShadowMaterial({ opacity: 0.24 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.56;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  function squareToWorld(file, rank) {
    return { x: file - 3.5, z: 3.5 - rank };
  }

  function squareNameToFileRank(square) {
    return {
      file: square.charCodeAt(0) - 97,
      rank: parseInt(square.slice(1), 10) - 1
    };
  }

  function createPieceMesh(type, color) {
    var group = new THREE.Group();
    var material = new THREE.MeshPhysicalMaterial({
      color: color === 'w' ? 0xf7f1e6 : 0x181a22,
      roughness: color === 'w' ? 0.23 : 0.32,
      metalness: color === 'w' ? 0.06 : 0.2,
      clearcoat: 0.5,
      clearcoatRoughness: 0.18
    });

    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.44, 0.08, 28),
      material
    );
    base.position.y = 0.04;
    group.add(base);

    if (type === 'n') {
      group.add(buildKnight(material));
    } else {
      var profile = getProfileForType(type);
      var pieceBody = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), material);
      group.add(pieceBody);
      if (type === 'q') addQueenCrown(group, material);
      if (type === 'k') addKingCross(group, material);
    }

    applyShadowToGroup(group);
    group.userData.pieceType = type;
    group.userData.pieceColor = color;
    group.userData.baseScale = 1;
    return group;
  }

  function getProfileForType(type) {
    if (type === 'p') {
      return [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.32, 0),
        new THREE.Vector2(0.34, 0.04),
        new THREE.Vector2(0.25, 0.1),
        new THREE.Vector2(0.16, 0.22),
        new THREE.Vector2(0.13, 0.38),
        new THREE.Vector2(0.18, 0.48),
        new THREE.Vector2(0.22, 0.58),
        new THREE.Vector2(0.16, 0.68),
        new THREE.Vector2(0.1, 0.74),
        new THREE.Vector2(0, 0.76)
      ];
    }

    if (type === 'r') {
      return [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.36, 0),
        new THREE.Vector2(0.38, 0.05),
        new THREE.Vector2(0.29, 0.1),
        new THREE.Vector2(0.22, 0.22),
        new THREE.Vector2(0.2, 0.56),
        new THREE.Vector2(0.31, 0.62),
        new THREE.Vector2(0.31, 0.78),
        new THREE.Vector2(0.24, 0.78),
        new THREE.Vector2(0.24, 0.7),
        new THREE.Vector2(0.17, 0.7),
        new THREE.Vector2(0.17, 0.78),
        new THREE.Vector2(0, 0.78)
      ];
    }

    if (type === 'b') {
      return [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.34, 0),
        new THREE.Vector2(0.36, 0.05),
        new THREE.Vector2(0.26, 0.1),
        new THREE.Vector2(0.18, 0.22),
        new THREE.Vector2(0.14, 0.38),
        new THREE.Vector2(0.19, 0.56),
        new THREE.Vector2(0.16, 0.72),
        new THREE.Vector2(0.09, 0.84),
        new THREE.Vector2(0.05, 0.92),
        new THREE.Vector2(0, 0.98)
      ];
    }

    if (type === 'q') {
      return [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.37, 0),
        new THREE.Vector2(0.39, 0.05),
        new THREE.Vector2(0.3, 0.11),
        new THREE.Vector2(0.2, 0.24),
        new THREE.Vector2(0.17, 0.44),
        new THREE.Vector2(0.22, 0.64),
        new THREE.Vector2(0.18, 0.8),
        new THREE.Vector2(0.12, 0.92),
        new THREE.Vector2(0.06, 1.02),
        new THREE.Vector2(0, 1.08)
      ];
    }

    return [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.38, 0),
      new THREE.Vector2(0.4, 0.05),
      new THREE.Vector2(0.31, 0.11),
      new THREE.Vector2(0.22, 0.24),
      new THREE.Vector2(0.18, 0.46),
      new THREE.Vector2(0.24, 0.66),
      new THREE.Vector2(0.18, 0.84),
      new THREE.Vector2(0.1, 0.96),
      new THREE.Vector2(0.03, 1.03),
      new THREE.Vector2(0, 1.06)
    ];
  }

  function buildKnight(material) {
    var knight = new THREE.Group();

    var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.29, 0.14, 20), material);
    collar.position.y = 0.16;
    knight.add(collar);

    var chest = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.34, 18), material);
    chest.position.set(0, 0.35, -0.02);
    chest.rotation.x = -0.18;
    knight.add(chest);

    var neck = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.3), material);
    neck.position.set(0, 0.52, -0.05);
    neck.rotation.x = -0.24;
    knight.add(neck);

    var head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.42), material);
    head.position.set(0, 0.7, -0.13);
    head.rotation.x = -0.28;
    knight.add(head);

    var snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.18), material);
    snout.position.set(0, 0.63, -0.34);
    snout.rotation.x = -0.12;
    knight.add(snout);

    var mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.28), material);
    mane.position.set(0, 0.67, 0.02);
    mane.rotation.x = -0.18;
    knight.add(mane);

    var leftEar = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), material);
    leftEar.position.set(-0.06, 0.85, -0.06);
    knight.add(leftEar);

    var rightEar = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), material);
    rightEar.position.set(0.06, 0.85, -0.06);
    knight.add(rightEar);

    return knight;
  }

  function addQueenCrown(group, material) {
    var crownBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.06, 18), material);
    crownBase.position.y = 1.02;
    group.add(crownBase);

    for (var crownIndex = 0; crownIndex < 5; crownIndex++) {
      var angle = (-Math.PI / 2) + crownIndex * (Math.PI / 4);
      var jewel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), material);
      jewel.position.set(Math.cos(angle) * 0.13, 1.08, Math.sin(angle) * 0.13);
      group.add(jewel);
    }
  }

  function addKingCross(group, material) {
    var crossBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 10), material);
    crossBase.position.y = 1.08;
    group.add(crossBase);

    var crossBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), material);
    crossBar.position.y = 1.14;
    group.add(crossBar);
  }

  function applyShadowToGroup(group) {
    group.traverse(function (child) {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
  }

  function disposeObject(object) {
    object.traverse(function (child) {
      if (child.geometry && child.geometry.dispose) {
        child.geometry.dispose();
      }

      if (!child.material) return;
      if (Array.isArray(child.material)) {
        child.material.forEach(function (material) {
          if (material && material.dispose) material.dispose();
        });
      } else if (child.material.dispose) {
        child.material.dispose();
      }
    });
  }

  function clearGroup(group) {
    while (group.children.length) {
      var child = group.children[0];
      group.remove(child);
      disposeObject(child);
    }
  }

  function syncPieces() {
    clearGroup(piecesGroup);
    pieceMeshes = {};

    var board = state.game.board();
    for (var row = 0; row < 8; row++) {
      for (var column = 0; column < 8; column++) {
        var piece = board[row][column];
        if (!piece) continue;

        var rank = 8 - row;
        var square = String.fromCharCode(97 + column) + rank;
        var mesh = createPieceMesh(piece.type, piece.color);
        var world = squareToWorld(column, rank - 1);

        mesh.position.set(world.x, 0.06, world.z);
        mesh.userData.square = square;
        if (piece.type === 'n') {
          mesh.rotation.y = piece.color === 'w' ? Math.PI : 0;
        }

        piecesGroup.add(mesh);
        pieceMeshes[square] = mesh;
      }
    }
  }

  function clearHighlights() {
    clearGroup(highlightGroup);
    highlightMeshes = [];
    selectedHighlight = null;

    Object.keys(squareMeshes).forEach(function (square) {
      squareMeshes[square].material.color.setHex(squareMeshes[square].userData.originalColor);
      squareMeshes[square].material.emissive.setHex(0x000000);
      squareMeshes[square].material.emissiveIntensity = 0;
    });
  }

  function showLastMoveHighlight() {
    if (!state.lastMove) return;

    [state.lastMove.from, state.lastMove.to].forEach(function (square) {
      if (!squareMeshes[square]) return;
      squareMeshes[square].material.emissive.setHex(0x5d3b11);
      squareMeshes[square].material.emissiveIntensity = 0.55;
    });
  }

  function showSelectedHighlight(square) {
    if (!squareMeshes[square]) return;

    var fileRank = squareNameToFileRank(square);
    var world = squareToWorld(fileRank.file, fileRank.rank);
    var highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.48, 40),
      new THREE.MeshBasicMaterial({
        color: 0x76e7ff,
        transparent: true,
        opacity: 0.46,
        side: THREE.DoubleSide
      })
    );

    highlight.rotation.x = -Math.PI / 2;
    highlight.position.set(world.x, 0.12, world.z);
    highlight.userData.pulseBase = 0.46;
    highlightGroup.add(highlight);
    selectedHighlight = highlight;

    squareMeshes[square].material.emissive.setHex(0x2ca7cc);
    squareMeshes[square].material.emissiveIntensity = 0.72;
  }

  function showLegalMoveHighlights(moves) {
    moves.forEach(function (move) {
      var fileRank = squareNameToFileRank(move.to);
      var world = squareToWorld(fileRank.file, fileRank.rank);
      var targetOccupied = state.game.get(move.to);
      var isCapture = !!move.captured || !!targetOccupied;

      if (isCapture) {
        var ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.35, 0.035, 12, 40),
          new THREE.MeshBasicMaterial({
            color: 0xff7b5d,
            transparent: true,
            opacity: 0.72
          })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(world.x, 0.13, world.z);
        ring.userData.targetSquare = move.to;
        ring.userData.pulseBase = 0.72;
        highlightGroup.add(ring);
        highlightMeshes.push(ring);
      } else {
        var dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 18, 18),
          new THREE.MeshBasicMaterial({
            color: 0x86f5c6,
            transparent: true,
            opacity: 0.72
          })
        );
        dot.position.set(world.x, 0.16, world.z);
        dot.userData.targetSquare = move.to;
        dot.userData.pulseBase = 0.72;
        highlightGroup.add(dot);
        highlightMeshes.push(dot);
      }
    });
  }

  function showCheckHighlight() {
    if (!state.game.in_check()) return;
    var board = state.game.board();

    for (var row = 0; row < 8; row++) {
      for (var column = 0; column < 8; column++) {
        var piece = board[row][column];
        if (!piece || piece.type !== 'k' || piece.color !== state.game.turn()) continue;
        var square = String.fromCharCode(97 + column) + (8 - row);
        if (!squareMeshes[square]) continue;
        squareMeshes[square].material.emissive.setHex(0x8c1515);
        squareMeshes[square].material.emissiveIntensity = 0.86;
      }
    }
  }

  function updateHighlights() {
    if (!highlightGroup) return;
    clearHighlights();
    showLastMoveHighlight();

    if (state.selectedSquare) {
      showSelectedHighlight(state.selectedSquare);
      showLegalMoveHighlights(state.legalMoves);
    }

    showCheckHighlight();
  }

  function onCanvasPointerDown(event) {
    state.pointerDown = {
      x: event.clientX,
      y: event.clientY
    };
  }

  function clearPointerState() {
    state.pointerDown = null;
  }

  function onCanvasPointerUp(event) {
    if (!state.pointerDown) return;
    var dx = event.clientX - state.pointerDown.x;
    var dy = event.clientY - state.pointerDown.y;
    clearPointerState();

    if (Math.abs(dx) > 14 || Math.abs(dy) > 14) return;
    handleBoardInput(event);
  }

  function getSquareFromEvent(event) {
    var rect = dom.canvas.getBoundingClientRect();
    var x = event.clientX;
    var y = event.clientY;

    mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((y - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    var pieceObjects = [];
    Object.keys(pieceMeshes).forEach(function (square) {
      pieceMeshes[square].traverse(function (child) {
        if (!child.isMesh) return;
        child.userData.parentSquare = square;
        pieceObjects.push(child);
      });
    });

    var pieceHits = raycaster.intersectObjects(pieceObjects, false);
    if (pieceHits.length && pieceHits[0].object.userData.parentSquare) {
      return pieceHits[0].object.userData.parentSquare;
    }

    var highlightHits = raycaster.intersectObjects(highlightMeshes, false);
    if (highlightHits.length && highlightHits[0].object.userData.targetSquare) {
      return highlightHits[0].object.userData.targetSquare;
    }

    var squareHits = raycaster.intersectObjects(Object.keys(squareMeshes).map(function (square) {
      return squareMeshes[square];
    }), false);

    if (squareHits.length) {
      return squareHits[0].object.userData.square;
    }

    return null;
  }

  function clearSelection() {
    state.selectedSquare = null;
    state.legalMoves = [];
    updateHighlights();
    updateBoardHint();
  }

  function handleBoardInput(event) {
    if (state.aiThinking || state.animating || state.game.game_over()) return;
    if (state.game.turn() !== 'w') return;

    var square = getSquareFromEvent(event);
    if (!square) return;

    var piece = state.game.get(square);

    if (state.selectedSquare) {
      if (square === state.selectedSquare) {
        clearSelection();
        return;
      }

      if (piece && piece.color === 'w') {
        selectSquare(square);
        return;
      }

      var matchingMove = state.legalMoves.find(function (move) {
        return move.to === square;
      });

      if (matchingMove) {
        var promotionMoves = state.legalMoves.filter(function (move) {
          return move.to === square && move.promotion;
        });

        if (promotionMoves.length) {
          state.pendingPromotion = { from: state.selectedSquare, to: square };
          showPromotionDialog();
          return;
        }

        executeHumanMove(state.selectedSquare, square);
        return;
      }

      clearSelection();
      if (piece && piece.color === 'w') {
        selectSquare(square);
      }
      return;
    }

    if (piece && piece.color === 'w') {
      selectSquare(square);
    }
  }

  function selectSquare(square) {
    state.selectedSquare = square;
    state.legalMoves = state.game.moves({ square: square, verbose: true });
    updateHighlights();
    updateBoardHint();
  }

  function setThinking(active) {
    state.aiThinking = active;
    dom.thinking.classList.toggle('hidden', !active);
  }

  function setGroupOpacity(group, opacity) {
    group.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
      child.material.transparent = opacity < 1;
      child.material.opacity = opacity;
    });
  }

  function animatePieceMove(fromSquare, toSquare, onDone) {
    var mesh = pieceMeshes[fromSquare];
    if (!mesh) {
      onDone();
      return;
    }

    var targetMesh = pieceMeshes[toSquare];
    if (targetMesh && targetMesh !== mesh) {
      setGroupOpacity(targetMesh, 0.28);
    }

    var fromPosition = squareToWorld(squareNameToFileRank(fromSquare).file, squareNameToFileRank(fromSquare).rank);
    var toPosition = squareToWorld(squareNameToFileRank(toSquare).file, squareNameToFileRank(toSquare).rank);
    var startX = fromPosition.x;
    var startZ = fromPosition.z;
    var endX = toPosition.x;
    var endZ = toPosition.z;
    var startY = 0.06;
    var lift = 0.62;
    var duration = 420;
    var startTime = null;

    state.animating = true;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      mesh.position.x = startX + (endX - startX) * eased;
      mesh.position.z = startZ + (endZ - startZ) * eased;
      mesh.position.y = startY + Math.sin(progress * Math.PI) * lift;
      mesh.rotation.z = Math.sin(progress * Math.PI) * 0.07;

      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }

      mesh.rotation.z = 0;
      mesh.position.set(endX, startY, endZ);
      state.animating = false;
      onDone();
    }

    requestAnimationFrame(step);
  }

  function executeHumanMove(fromSquare, toSquare, promotion) {
    state.engineMessage = '';
    setThinking(false);
    clearHighlights();

    animatePieceMove(fromSquare, toSquare, function () {
      var result = state.game.move({
        from: fromSquare,
        to: toSquare,
        promotion: promotion || undefined
      });

      if (!result) {
        syncPieces();
        syncGameUI();
        return;
      }

      completeMove(result, 'human');
    });
  }

  function completeMove(result, source) {
    syncPieces();
    state.selectedSquare = null;
    state.legalMoves = [];
    state.pendingPromotion = null;
    state.lastMove = { from: result.from, to: result.to };

    if (state.game.in_check()) {
      playSound('check');
    } else if (result.captured) {
      playSound('capture');
    } else {
      playSound('move');
    }

    syncGameUI();

    if (state.game.game_over()) {
      showGameOver();
      return;
    }

    if (source === 'human') {
      scheduleAI();
    }
  }

  function showPromotionDialog() {
    dom.promotionChoices.innerHTML = '';

    ['q', 'r', 'b', 'n'].forEach(function (pieceCode) {
      var button = document.createElement('button');
      button.className = 'promotion-choice';
      button.type = 'button';
      button.innerHTML = '<span>' + PIECE_UNICODE['w' + pieceCode.toUpperCase()] + '</span><span>' + PROMOTION_LABELS[pieceCode] + '</span>';
      button.setAttribute('aria-label', 'Promote to ' + PROMOTION_LABELS[pieceCode]);
      button.addEventListener('click', function () {
        dom.promotionModal.classList.add('hidden');
        if (!state.pendingPromotion) return;
        var pending = state.pendingPromotion;
        state.pendingPromotion = null;
        executeHumanMove(pending.from, pending.to, pieceCode);
      });
      dom.promotionChoices.appendChild(button);
    });

    dom.promotionModal.classList.remove('hidden');
  }

  function showGameOver() {
    cancelPendingAI();
    playSound('gameover');

    var title = 'Game Over';
    var message = '';
    var fullMoves = Math.max(1, Math.ceil(state.game.history().length / 2));

    if (state.game.in_checkmate()) {
      title = state.game.turn() === 'w' ? 'Black Wins' : 'White Wins';
      message = 'Checkmate after ' + fullMoves + ' move' + (fullMoves === 1 ? '' : 's') + '.';
    } else if (state.game.in_stalemate()) {
      title = 'Draw';
      message = 'Stalemate after ' + fullMoves + ' move' + (fullMoves === 1 ? '' : 's') + '.';
    } else if (state.game.in_threefold_repetition()) {
      title = 'Draw';
      message = 'Threefold repetition locked the game.';
    } else if (state.game.insufficient_material()) {
      title = 'Draw';
      message = 'Insufficient material remains on the board.';
    } else if (state.game.in_draw()) {
      title = 'Draw';
      message = 'The 50-move rule ended the game.';
    }

    dom.gameoverTitle.textContent = title;
    dom.gameoverMessage.textContent = message;
    dom.gameoverModal.classList.remove('hidden');
  }

  function cancelPendingAI() {
    state.aiRequestToken += 1;
    if (state.aiAbortController) {
      state.aiAbortController.abort();
      state.aiAbortController = null;
    }
    setThinking(false);
  }

  function scheduleAI() {
    if (state.game.game_over() || state.game.turn() !== 'b') return;

    cancelPendingAI();
    state.engineMessage = '';
    setThinking(true);
    syncGameUI();

    var requestToken = state.aiRequestToken;
    var controller = new AbortController();
    state.aiAbortController = controller;

    fetch(AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: state.game.fen(), depth: 3 }),
      signal: controller.signal
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('AI request failed with status ' + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        if (requestToken !== state.aiRequestToken) return;
        state.aiAbortController = null;
        setThinking(false);

        if (!payload || !payload.move) {
          syncGameUI();
          return;
        }

        clearHighlights();
        animatePieceMove(payload.move.from, payload.move.to, function () {
          var result = state.game.move(payload.move);
          if (!result) {
            syncPieces();
            syncGameUI();
            return;
          }
          completeMove(result, 'ai');
        });
      })
      .catch(function (error) {
        if (error.name === 'AbortError') return;
        state.aiAbortController = null;
        state.engineMessage = 'AI connection failed. Use Undo to retry or start a new match.';
        setThinking(false);
        syncGameUI();
      });
  }

  function updateStatus() {
    var pillText = state.boardFlipped ? 'Black side' : 'White side';
    var statusText = '';
    var pillClass = 'turn-pill';
    var statusClass = 'status-text';

    if (state.game.in_checkmate()) {
      pillText = 'Match over';
      statusText = state.game.turn() === 'w' ? 'Checkmate. Black wins the match.' : 'Checkmate. White wins the match.';
      pillClass += ' is-over';
      statusClass += ' is-over';
    } else if (state.game.in_stalemate() || state.game.in_draw()) {
      pillText = 'Match over';
      statusText = 'Drawn position. The board is locked.';
      pillClass += ' is-over';
      statusClass += ' is-over';
    } else if (state.engineMessage) {
      pillText = 'AI unavailable';
      statusText = state.engineMessage;
      pillClass += ' is-alert';
      statusClass += ' is-alert';
    } else if (state.aiThinking) {
      pillText = 'AI thinking';
      statusText = 'Black is calculating a reply.';
      pillClass += ' is-thinking';
    } else if (state.game.in_check()) {
      pillText = state.game.turn() === 'w' ? 'White in check' : 'Black in check';
      statusText = pillText + '. Respond immediately.';
      pillClass += ' is-alert';
      statusClass += ' is-alert';
    } else {
      pillText = state.game.turn() === 'w' ? 'White to move' : 'Black to move';
      statusText = state.game.turn() === 'w'
        ? 'Your turn. Tap a white piece to begin.'
        : 'Waiting for Black to move.';
    }

    dom.turnPill.className = pillClass;
    dom.turnPill.textContent = pillText;
    dom.status.className = statusClass;
    dom.status.textContent = statusText;
  }

  function updateBoardHint() {
    var hint = '';

    if (state.game.game_over()) {
      hint = 'Use New Match to reset the board and play again.';
    } else if (state.engineMessage) {
      hint = state.engineMessage;
    } else if (state.aiThinking) {
      hint = 'Black is thinking. The board will update automatically.';
    } else if (state.selectedSquare) {
      hint = 'Tap a highlighted square to move, or tap the selected piece again to cancel.';
    } else if (state.game.turn() === 'w') {
      hint = 'Tap a white piece to reveal legal moves, then tap a highlighted destination.';
    } else {
      hint = 'Black is up next.';
    }

    dom.boardHint.textContent = hint;
  }

  function updateOrientation() {
    dom.orientationLabel.textContent = state.boardFlipped ? 'Black side' : 'White side';
    dom.capturedTopLabel.textContent = state.boardFlipped ? 'White losses' : 'Black losses';
    dom.capturedBottomLabel.textContent = state.boardFlipped ? 'Black losses' : 'White losses';
  }

  function updateMoveHistory() {
    var history = state.game.history();
    dom.moveHistory.innerHTML = '';

    for (var index = 0; index < history.length; index += 2) {
      var row = document.createElement('div');
      row.className = 'history-row';

      var number = document.createElement('span');
      number.className = 'move-number';
      number.textContent = (Math.floor(index / 2) + 1) + '.';
      row.appendChild(number);

      var whiteMove = document.createElement('span');
      whiteMove.className = 'move-entry';
      whiteMove.textContent = history[index];
      if (index === history.length - 1) {
        whiteMove.classList.add('is-latest');
      }
      row.appendChild(whiteMove);

      var blackMove = document.createElement('span');
      blackMove.className = 'move-entry';
      if (history[index + 1]) {
        blackMove.textContent = history[index + 1];
        if (index + 1 === history.length - 1) {
          blackMove.classList.add('is-latest');
        }
      } else {
        blackMove.textContent = '...';
      }
      row.appendChild(blackMove);
      dom.moveHistory.appendChild(row);
    }

    dom.moveHistoryContainer.scrollTop = dom.moveHistoryContainer.scrollHeight;
  }

  function updateCaptured() {
    var initial = {
      w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
      b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
    };
    var current = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
    };
    var board = state.game.board();
    var order = ['q', 'r', 'b', 'n', 'p'];

    for (var row = 0; row < 8; row++) {
      for (var column = 0; column < 8; column++) {
        var piece = board[row][column];
        if (!piece || piece.type === 'k') continue;
        current[piece.color][piece.type] += 1;
      }
    }

    var capturedByWhite = {};
    var capturedByBlack = {};
    var whiteMaterial = 0;
    var blackMaterial = 0;

    order.forEach(function (pieceType) {
      capturedByWhite[pieceType] = initial.b[pieceType] - current.b[pieceType];
      capturedByBlack[pieceType] = initial.w[pieceType] - current.w[pieceType];
      whiteMaterial += current.w[pieceType] * PIECE_VALUES[pieceType];
      blackMaterial += current.b[pieceType] * PIECE_VALUES[pieceType];
    });

    var topCaptured = state.boardFlipped ? capturedByBlack : capturedByWhite;
    var bottomCaptured = state.boardFlipped ? capturedByWhite : capturedByBlack;
    var topSymbols = state.boardFlipped
      ? { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' }
      : { q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };
    var bottomSymbols = state.boardFlipped
      ? { q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' }
      : { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' };

    renderCaptured(dom.capturedBlack, topCaptured, topSymbols);
    renderCaptured(dom.capturedWhite, bottomCaptured, bottomSymbols);

    var diff = whiteMaterial - blackMaterial;
    dom.diffTop.textContent = state.boardFlipped
      ? diff > 0 ? '+' + Math.floor(diff / 100) : ''
      : diff < 0 ? '+' + Math.floor(-diff / 100) : '';
    dom.diffBottom.textContent = state.boardFlipped
      ? diff < 0 ? '+' + Math.floor(-diff / 100) : ''
      : diff > 0 ? '+' + Math.floor(diff / 100) : '';
  }

  function renderCaptured(container, capturedMap, symbols) {
    container.innerHTML = '';

    ['q', 'r', 'b', 'n', 'p'].forEach(function (pieceType) {
      for (var count = 0; count < capturedMap[pieceType]; count++) {
        var token = document.createElement('span');
        token.className = 'captured-token';
        token.textContent = symbols[pieceType];
        container.appendChild(token);
      }
    });
  }

  function syncGameUI() {
    var history = state.game.history({ verbose: true });
    state.lastMove = history.length
      ? { from: history[history.length - 1].from, to: history[history.length - 1].to }
      : null;

    updateStatus();
    updateBoardHint();
    updateOrientation();
    updateMoveHistory();
    updateCaptured();
    updateHighlights();
  }

  function undoMove() {
    if (state.animating || !state.game.history().length) return;

    cancelPendingAI();
    state.engineMessage = '';
    dom.gameoverModal.classList.add('hidden');
    dom.promotionModal.classList.add('hidden');

    if (state.game.turn() === 'b') {
      state.game.undo();
    } else {
      state.game.undo();
      if (state.game.history().length) {
        state.game.undo();
      }
    }

    state.selectedSquare = null;
    state.legalMoves = [];
    syncPieces();
    syncGameUI();
  }

  function flipBoard() {
    state.boardFlipped = !state.boardFlipped;
    clearSelection();
    setCameraGoal(false);
    updateOrientation();
    updateCaptured();
  }

  function newGame() {
    cancelPendingAI();
    createGame();
    state.boardFlipped = false;
    state.selectedSquare = null;
    state.legalMoves = [];
    state.pendingPromotion = null;
    state.lastMove = null;
    state.engineMessage = '';

    dom.confirmModal.classList.add('hidden');
    dom.gameoverModal.classList.add('hidden');
    dom.promotionModal.classList.add('hidden');

    setCameraGoal(true);
    syncPieces();
    syncGameUI();
  }

  function setCameraGoal(immediate) {
    if (!camera || !cameraTarget) return;
    if (state.boardFlipped) {
      cameraTarget.set(0, 9.6, -8.2);
    } else {
      cameraTarget.set(0, 9.6, 8.2);
    }

    if (immediate) {
      camera.position.copy(cameraTarget);
      camera.lookAt(0, 0.25, 0);
    }
  }

  function onResize() {
    if (!renderer || !camera) return;
    var size = getCanvasSize();
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    renderer.setSize(size.width, size.height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  function animateScene(elapsed) {
    if (!boardGroup) return;

    boardGroup.position.y = Math.sin(elapsed * 0.95) * 0.05;
    boardGroup.rotation.x = Math.cos(elapsed * 0.35) * 0.012;
    boardGroup.rotation.z = Math.sin(elapsed * 0.32) * 0.018;

    if (cameraTarget) {
      camera.position.lerp(cameraTarget, 0.08);
      camera.lookAt(0, 0.24, 0);
    }

    if (accentLight) {
      accentLight.intensity = 0.92 + Math.sin(elapsed * 1.8) * 0.12;
    }

    if (atmosphereGroup) {
      atmosphereGroup.rotation.y = elapsed * 0.03;
      var particles = atmosphereGroup.userData.particles;
      if (particles) {
        particles.rotation.y = elapsed * 0.05;
      }
    }

    if (selectedHighlight && selectedHighlight.material) {
      selectedHighlight.material.opacity = 0.34 + Math.sin(elapsed * 3.2) * 0.1;
      selectedHighlight.rotation.z = elapsed * 0.6;
    }

    highlightMeshes.forEach(function (mesh, index) {
      if (!mesh.material) return;
      mesh.material.opacity = (mesh.userData.pulseBase || 0.7) + Math.sin(elapsed * 3.4 + index * 0.5) * 0.1;
      if (mesh.geometry.type === 'SphereGeometry') {
        mesh.position.y = 0.16 + Math.sin(elapsed * 3.4 + index) * 0.03;
      } else {
        mesh.rotation.z = elapsed * 0.65;
      }
    });

    Object.keys(pieceMeshes).forEach(function (square) {
      var mesh = pieceMeshes[square];
      var targetScale = state.selectedSquare === square ? 1.05 + Math.sin(elapsed * 4.2) * 0.02 : 1;
      var nextScale = mesh.scale.x + (targetScale - mesh.scale.x) * 0.14;
      mesh.scale.setScalar(nextScale);
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;

    var elapsed = clock.getElapsedTime();
    animateScene(elapsed);
    renderer.render(scene, camera);
  }

  wireUiActions();
  createGame();

  if (!THREE || !ChessCtor) {
    showLoadError('3D libraries failed to load. Refresh the page to try again.');
    return;
  }

  try {
    initThree();
    syncGameUI();
  } catch (error) {
    showLoadError('This device could not start the 3D board. Try a modern browser with WebGL enabled.');
  }
})();
