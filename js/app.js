/* =========================================================
   Chess App – Full client-side chess with AI opponent
   ========================================================= */

(function () {
  'use strict';

  // ───── Constants / Config ─────
  const PIECE_UNICODE = {
    wK: '\u2654', wQ: '\u2655', wR: '\u2656', wB: '\u2657', wN: '\u2658', wP: '\u2659',
    bK: '\u265A', bQ: '\u265B', bR: '\u265C', bB: '\u265D', bN: '\u265E', bP: '\u265F'
  };

  const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // ───── Game State ─────
  let game = new Chess();
  let boardFlipped = false;
  let selectedSquare = null;
  let legalMovesForSelected = [];
  let lastMove = null;        // { from, to }
  let aiThinking = false;
  let moveHistory = [];       // array of SAN strings
  let animating = false;
  let pendingPromotion = null; // { from, to }

  // ───── DOM refs ─────
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const moveHistoryEl = document.getElementById('move-history');
  const moveHistoryContainer = document.getElementById('move-history-container');
  const thinkingEl = document.getElementById('thinking-indicator');
  const promotionModal = document.getElementById('promotion-modal');
  const promotionChoices = document.getElementById('promotion-choices');
  const gameoverModal = document.getElementById('gameover-modal');
  const gameoverTitle = document.getElementById('gameover-title');
  const gameoverMessage = document.getElementById('gameover-message');
  const confirmModal = document.getElementById('confirm-modal');
  const capturedBlackEl = document.getElementById('captured-black');
  const capturedWhiteEl = document.getElementById('captured-white');
  const diffTopEl = document.getElementById('diff-top');
  const diffBottomEl = document.getElementById('diff-bottom');
  const rankLabelsLeft = document.getElementById('rank-labels-left');
  const fileLabelsEl = document.getElementById('file-labels');

  // ───── Audio (Web Audio API) ─────
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  function playSound(type) {
    try {
      ensureAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (type === 'move') {
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'capture') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'check') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.setValueAtTime(600, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'gameover') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, now);
        osc.frequency.setValueAtTime(400, now + 0.15);
        osc.frequency.setValueAtTime(300, now + 0.3);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      }
    } catch (e) {
      // audio not available, silently fail
    }
  }

  // ───── Coordinate Helpers ─────
  function squareToCoords(sq) {
    // sq = 'a1' .. 'h8'  -> {col: 0-7, row: 0-7} where row 0 = rank 8
    const col = sq.charCodeAt(0) - 97; // a=0
    const row = 8 - parseInt(sq[1], 10); // rank 8 => row 0
    return { col, row };
  }

  function coordsToSquare(col, row) {
    return String.fromCharCode(97 + col) + (8 - row);
  }

  function displayRow(row) {
    return boardFlipped ? 7 - row : row;
  }

  function displayCol(col) {
    return boardFlipped ? 7 - col : col;
  }

  // ───── Board Labels ─────
  function renderLabels() {
    rankLabelsLeft.innerHTML = '';
    fileLabelsEl.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      const rank = boardFlipped ? r + 1 : 8 - r;
      const span = document.createElement('span');
      span.textContent = rank;
      rankLabelsLeft.appendChild(span);
    }
    for (let c = 0; c < 8; c++) {
      const file = boardFlipped ? String.fromCharCode(104 - c) : String.fromCharCode(97 + c);
      const span = document.createElement('span');
      span.textContent = file;
      fileLabelsEl.appendChild(span);
    }
  }

  // ───── Render Board ─────
  function renderBoard(skipAnimation) {
    boardEl.innerHTML = '';
    const board = game.board(); // 8x8 array, board[0] = rank 8

    for (let displayR = 0; displayR < 8; displayR++) {
      for (let displayC = 0; displayC < 8; displayC++) {
        const r = boardFlipped ? 7 - displayR : displayR;
        const c = boardFlipped ? 7 - displayC : displayC;
        const sq = coordsToSquare(c, r);
        const isLight = (r + c) % 2 === 0;

        const div = document.createElement('div');
        div.className = 'square ' + (isLight ? 'light' : 'dark');
        div.dataset.square = sq;

        // Last move highlight
        if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
          div.classList.add('last-move');
        }

        // Check highlight
        if (game.in_check()) {
          const turn = game.turn();
          const piece = board[r][c];
          if (piece && piece.type === 'k' && piece.color === turn) {
            div.classList.add('in-check');
          }
        }

        // Selected highlight
        if (selectedSquare === sq) {
          div.classList.add('selected');
        }

        // Legal move indicators
        if (legalMovesForSelected.length > 0) {
          const isLegal = legalMovesForSelected.some(m => m.to === sq);
          if (isLegal) {
            const targetPiece = board[r][c];
            if (targetPiece) {
              div.classList.add('legal-capture');
            } else {
              div.classList.add('legal-move');
            }
          }
        }

        // Piece
        const piece = board[r][c];
        if (piece) {
          const key = (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase();
          const pieceSpan = document.createElement('span');
          pieceSpan.className = 'piece ' + (piece.color === 'w' ? 'white-piece' : 'black-piece');
          pieceSpan.textContent = PIECE_UNICODE[key];
          div.appendChild(pieceSpan);
        }

        div.addEventListener('click', () => onSquareClick(sq));
        boardEl.appendChild(div);
      }
    }
  }

  // ───── Animate a move (sliding piece) ─────
  function animateMove(from, to, callback) {
    const fromCoords = squareToCoords(from);
    const toCoords = squareToCoords(to);

    const fromDispR = displayRow(fromCoords.row);
    const fromDispC = displayCol(fromCoords.col);
    const toDispR = displayRow(toCoords.row);
    const toDispC = displayCol(toCoords.col);

    // Get piece at 'from' before the move is made on the logical board
    const boardState = game.board();
    const piece = boardState[fromCoords.row][fromCoords.col];
    if (!piece) { callback(); return; }

    const key = (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase();

    // Get square size
    const boardRect = boardEl.getBoundingClientRect();
    const sqW = boardRect.width / 8;
    const sqH = boardRect.height / 8;

    // Create floating piece
    const floater = document.createElement('span');
    floater.className = 'piece-animate ' + (piece.color === 'w' ? 'white-piece' : 'black-piece');
    floater.textContent = PIECE_UNICODE[key];
    floater.style.left = (boardRect.left + fromDispC * sqW + sqW / 2) + 'px';
    floater.style.top = (boardRect.top + fromDispR * sqH + sqH / 2) + 'px';
    floater.style.transform = 'translate(-50%, -50%)';
    floater.style.position = 'fixed';
    document.body.appendChild(floater);

    // Hide piece on source square
    const srcSquareEl = boardEl.querySelector(`[data-square="${from}"] .piece`);
    if (srcSquareEl) srcSquareEl.style.visibility = 'hidden';

    // Hide piece on target (for captures, the piece might already be there after game.move())
    const dstSquareEl = boardEl.querySelector(`[data-square="${to}"] .piece`);
    if (dstSquareEl) dstSquareEl.style.visibility = 'hidden';

    // Trigger reflow
    floater.offsetHeight; // eslint-disable-line

    // Animate to destination
    requestAnimationFrame(() => {
      floater.style.left = (boardRect.left + toDispC * sqW + sqW / 2) + 'px';
      floater.style.top = (boardRect.top + toDispR * sqH + sqH / 2) + 'px';
    });

    floater.addEventListener('transitionend', function handler() {
      floater.removeEventListener('transitionend', handler);
      floater.remove();
      callback();
    });

    // Fallback timeout
    setTimeout(() => {
      if (floater.parentNode) {
        floater.remove();
        callback();
      }
    }, 350);
  }

  // ───── Square Click Handler ─────
  function onSquareClick(sq) {
    if (aiThinking || animating) return;
    if (game.game_over()) return;

    // Only allow human to move white pieces
    if (game.turn() !== 'w') return;

    const piece = game.get(sq);

    if (selectedSquare) {
      // Check if clicking on own piece -> re-select
      if (piece && piece.color === 'w') {
        if (sq === selectedSquare) {
          // Deselect
          selectedSquare = null;
          legalMovesForSelected = [];
          renderBoard();
          return;
        }
        // Select different piece
        selectSquare(sq);
        return;
      }

      // Try to move
      const move = legalMovesForSelected.find(m => m.to === sq);
      if (move) {
        // Check promotion
        if (move.flags.includes('p') || (piece === null && game.get(selectedSquare).type === 'p' && (sq[1] === '8' || sq[1] === '1'))) {
          // Need to check if any legal move from selected to sq is a promotion
          const promoMoves = legalMovesForSelected.filter(m => m.to === sq && m.promotion);
          if (promoMoves.length > 0) {
            pendingPromotion = { from: selectedSquare, to: sq };
            showPromotionDialog();
            return;
          }
        }
        executeHumanMove(selectedSquare, sq);
      } else {
        // Invalid target – deselect
        selectedSquare = null;
        legalMovesForSelected = [];
        renderBoard();
      }
    } else {
      // No selection yet
      if (piece && piece.color === 'w') {
        selectSquare(sq);
      }
    }
  }

  function selectSquare(sq) {
    selectedSquare = sq;
    legalMovesForSelected = game.moves({ square: sq, verbose: true });
    renderBoard();
  }

  function executeHumanMove(from, to, promotion) {
    const moveObj = { from, to, promotion: promotion || undefined };

    // Animate first, then apply
    animating = true;

    // First animate
    animateMove(from, to, () => {
      const result = game.move(moveObj);
      if (!result) {
        animating = false;
        renderBoard();
        return;
      }

      lastMove = { from, to };
      moveHistory.push(result.san);
      selectedSquare = null;
      legalMovesForSelected = [];
      animating = false;

      // Sound
      if (game.in_check()) {
        playSound('check');
      } else if (result.captured) {
        playSound('capture');
      } else {
        playSound('move');
      }

      renderBoard();
      updateStatus();
      updateMoveHistory();
      updateCaptured();

      if (game.game_over()) {
        showGameOver();
        return;
      }

      // AI turn
      scheduleAI();
    });
  }

  // ───── Promotion Dialog ─────
  function showPromotionDialog() {
    promotionChoices.innerHTML = '';
    const pieces = ['q', 'r', 'b', 'n'];
    const names = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
    const symbols = { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658' };

    pieces.forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = symbols[p];
      btn.title = names[p];
      btn.addEventListener('click', () => {
        promotionModal.classList.add('hidden');
        const { from, to } = pendingPromotion;
        pendingPromotion = null;
        executeHumanMove(from, to, p);
      });
      promotionChoices.appendChild(btn);
    });

    promotionModal.classList.remove('hidden');
  }

  // ───── Game Over ─────
  function showGameOver() {
    playSound('gameover');
    let title = 'Game Over';
    let msg = '';
    if (game.in_checkmate()) {
      title = game.turn() === 'w' ? 'Black Wins!' : 'White Wins!';
      msg = 'Checkmate';
    } else if (game.in_stalemate()) {
      title = 'Draw';
      msg = 'Stalemate';
    } else if (game.in_threefold_repetition()) {
      title = 'Draw';
      msg = 'Threefold repetition';
    } else if (game.insufficient_material()) {
      title = 'Draw';
      msg = 'Insufficient material';
    } else if (game.in_draw()) {
      title = 'Draw';
      msg = '50-move rule';
    }
    gameoverTitle.textContent = title;
    gameoverMessage.textContent = msg;
    gameoverModal.classList.remove('hidden');
  }

  document.getElementById('gameover-newgame').addEventListener('click', () => {
    gameoverModal.classList.add('hidden');
    newGame();
  });

  // ───── Status ─────
  function updateStatus() {
    let text = '';
    if (game.in_checkmate()) {
      text = game.turn() === 'w' ? 'Checkmate \u2013 Black wins' : 'Checkmate \u2013 White wins';
      statusEl.className = 'status-text game-over';
    } else if (game.in_stalemate() || game.in_draw()) {
      text = 'Draw';
      statusEl.className = 'status-text game-over';
    } else if (game.in_check()) {
      text = (game.turn() === 'w' ? 'White' : 'Black') + ' is in check';
      statusEl.className = 'status-text in-check';
    } else {
      text = (game.turn() === 'w' ? 'White' : 'Black') + ' to move';
      statusEl.className = 'status-text';
    }
    statusEl.textContent = text;
  }

  // ───── Move History ─────
  function updateMoveHistory() {
    moveHistoryEl.innerHTML = '';
    for (let i = 0; i < moveHistory.length; i += 2) {
      const num = document.createElement('span');
      num.className = 'move-number';
      num.textContent = (Math.floor(i / 2) + 1) + '.';
      moveHistoryEl.appendChild(num);

      const w = document.createElement('span');
      w.className = 'move-entry';
      w.textContent = moveHistory[i];
      moveHistoryEl.appendChild(w);

      if (i + 1 < moveHistory.length) {
        const b = document.createElement('span');
        b.className = 'move-entry';
        b.textContent = moveHistory[i + 1];
        moveHistoryEl.appendChild(b);
      }
    }
    moveHistoryContainer.scrollTop = moveHistoryContainer.scrollHeight;
  }

  // ───── Captured Pieces ─────
  function updateCaptured() {
    const initialPieces = { w: { p: 8, n: 2, b: 2, r: 2, q: 1 }, b: { p: 8, n: 2, b: 2, r: 2, q: 1 } };
    const currentPieces = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };

    const board = game.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type !== 'k') {
          currentPieces[p.color][p.type]++;
        }
      }
    }

    const capturedByWhite = {}; // Black pieces captured by white
    const capturedByBlack = {}; // White pieces captured by black
    const order = ['q', 'r', 'b', 'n', 'p'];

    let whiteMaterial = 0, blackMaterial = 0;

    order.forEach(type => {
      capturedByWhite[type] = initialPieces.b[type] - currentPieces.b[type];
      capturedByBlack[type] = initialPieces.w[type] - currentPieces.w[type];
      whiteMaterial += currentPieces.w[type] * PIECE_VALUES[type];
      blackMaterial += currentPieces.b[type] * PIECE_VALUES[type];
    });

    const symbolsWhite = { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' };
    const symbolsBlack = { q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };

    // Top = opponent from perspective (when not flipped: black side, showing white's captures)
    // Bottom = player side (when not flipped: white side, showing black's captures)
    const topCaptured = boardFlipped ? capturedByBlack : capturedByWhite;
    const bottomCaptured = boardFlipped ? capturedByWhite : capturedByBlack;
    const topSymbols = boardFlipped ? symbolsWhite : symbolsBlack;
    const bottomSymbols = boardFlipped ? symbolsBlack : symbolsWhite;

    function renderCapturedPieces(el, captured, symbols) {
      el.innerHTML = '';
      order.forEach(type => {
        for (let i = 0; i < captured[type]; i++) {
          const s = document.createElement('span');
          s.textContent = symbols[type];
          el.appendChild(s);
        }
      });
    }

    renderCapturedPieces(
      boardFlipped ? capturedWhiteEl : capturedBlackEl,
      topCaptured,
      topSymbols
    );
    renderCapturedPieces(
      boardFlipped ? capturedBlackEl : capturedWhiteEl,
      bottomCaptured,
      bottomSymbols
    );

    const diff = whiteMaterial - blackMaterial;
    const topDiff = boardFlipped ? (diff > 0 ? '+' + Math.floor(diff / 100) : '') : (diff < 0 ? '+' + Math.floor(-diff / 100) : '');
    const bottomDiff = boardFlipped ? (diff < 0 ? '+' + Math.floor(-diff / 100) : '') : (diff > 0 ? '+' + Math.floor(diff / 100) : '');

    diffTopEl.textContent = topDiff;
    diffBottomEl.textContent = bottomDiff;
  }

  // ───── AI Engine (Backend Worker) ─────
  // Use the VM backend API when hosted anywhere (including GitHub Pages)
  const AI_API_URL = (function() {
    // If running on the VM directly, use relative path
    if (window.location.port === '8080' || window.location.hostname === '213.35.120.193') {
      return window.location.origin + window.location.pathname.replace(/\/(?:index\.html)?$/, '') + '/api/ai-move';
    }
    // For external hosting (GitHub Pages etc), call VM backend
    return 'http://213.35.120.193:8080/chess/api/ai-move';
  })();

  function scheduleAI() {
    aiThinking = true;
    thinkingEl.classList.remove('hidden');

    const fen = game.fen();

    fetch(AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: fen, depth: 3 })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.move) {
        var bestMove = data.move;
        animating = true;
        animateMove(bestMove.from, bestMove.to, function() {
          var result = game.move(bestMove);
          lastMove = { from: bestMove.from, to: bestMove.to };
          moveHistory.push(result.san);
          animating = false;
          aiThinking = false;
          thinkingEl.classList.add('hidden');

          if (game.in_check()) {
            playSound('check');
          } else if (result.captured) {
            playSound('capture');
          } else {
            playSound('move');
          }

          renderBoard();
          updateStatus();
          updateMoveHistory();
          updateCaptured();

          if (game.game_over()) {
            showGameOver();
          }
        });
      } else {
        aiThinking = false;
        thinkingEl.classList.add('hidden');
      }
    })
    .catch(function(err) {
      console.error('AI worker error:', err);
      aiThinking = false;
      thinkingEl.classList.add('hidden');
      // Fallback: pick a random legal move
      var moves = game.moves({ verbose: true });
      if (moves.length > 0) {
        var fallback = moves[Math.floor(Math.random() * moves.length)];
        var result = game.move(fallback);
        lastMove = { from: fallback.from, to: fallback.to };
        moveHistory.push(result.san);
        playSound('move');
        renderBoard();
        updateStatus();
        updateMoveHistory();
        updateCaptured();
        if (game.game_over()) showGameOver();
      }
    });
  }

  // ───── Controls ─────
  document.getElementById('btn-new').addEventListener('click', () => {
    if (game.history().length > 0) {
      confirmModal.classList.remove('hidden');
    } else {
      newGame();
    }
  });

  document.getElementById('confirm-yes').addEventListener('click', () => {
    confirmModal.classList.add('hidden');
    newGame();
  });

  document.getElementById('confirm-no').addEventListener('click', () => {
    confirmModal.classList.add('hidden');
  });

  document.getElementById('btn-undo').addEventListener('click', () => {
    if (aiThinking || animating) return;
    // Undo both AI and player move
    if (game.history().length >= 2 && game.turn() === 'w') {
      game.undo(); // undo AI move
      game.undo(); // undo player move
      moveHistory.pop();
      moveHistory.pop();
    } else if (game.history().length >= 1 && game.turn() === 'w') {
      // edge case: after game over or at start
      game.undo();
      moveHistory.pop();
    } else {
      return;
    }

    selectedSquare = null;
    legalMovesForSelected = [];
    lastMove = null;

    // Reconstruct last move from history
    const hist = game.history({ verbose: true });
    if (hist.length > 0) {
      const lm = hist[hist.length - 1];
      lastMove = { from: lm.from, to: lm.to };
    }

    renderBoard();
    updateStatus();
    updateMoveHistory();
    updateCaptured();
  });

  document.getElementById('btn-flip').addEventListener('click', () => {
    boardFlipped = !boardFlipped;
    selectedSquare = null;
    legalMovesForSelected = [];
    renderLabels();
    renderBoard();
    updateCaptured();
  });

  // ───── New Game ─────
  function newGame() {
    game = new Chess();
    boardFlipped = false;
    selectedSquare = null;
    legalMovesForSelected = [];
    lastMove = null;
    aiThinking = false;
    animating = false;
    moveHistory = [];
    pendingPromotion = null;
    thinkingEl.classList.add('hidden');
    gameoverModal.classList.add('hidden');
    promotionModal.classList.add('hidden');
    renderLabels();
    renderBoard();
    updateStatus();
    updateMoveHistory();
    updateCaptured();
  }

  // ───── Init ─────
  renderLabels();
  renderBoard();
  updateStatus();
  updateMoveHistory();
  updateCaptured();

  // Activate audio context on first interaction
  document.addEventListener('touchstart', ensureAudio, { once: true });
  document.addEventListener('click', ensureAudio, { once: true });

})();
