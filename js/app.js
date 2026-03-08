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

  // Piece-square tables (from white's perspective; flip for black)
  const PST = {
    p: [
       0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
       5,  5, 10, 25, 25, 10,  5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5, -5,-10,  0,  0,-10, -5,  5,
       5, 10, 10,-20,-20, 10, 10,  5,
       0,  0,  0,  0,  0,  0,  0,  0
    ],
    n: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50
    ],
    b: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20
    ],
    r: [
       0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       0,  0,  0,  5,  5,  0,  0,  0
    ],
    q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20
    ],
    k: [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20
    ]
  };

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

  // ───── AI Engine ─────
  function scheduleAI() {
    aiThinking = true;
    thinkingEl.classList.remove('hidden');
    setTimeout(() => {
      const bestMove = findBestMove();
      if (bestMove) {
        animating = true;
        animateMove(bestMove.from, bestMove.to, () => {
          const result = game.move(bestMove);
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
    }, 100); // Small delay so UI updates before AI computes
  }

  function findBestMove() {
    const moves = game.moves({ verbose: true });
    if (moves.length === 0) return null;

    let bestScore = -Infinity;
    let bestMove = moves[0];

    // Order moves: captures first for better pruning
    moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

    // AI is black (maximizing black's score).
    // At the root (black to move), we maximize evaluateAbsolute() (positive = good for black).
    for (const move of moves) {
      game.move(move);
      // After black moves, it's white's turn: white minimizes the score.
      const score = alphaBeta(2, -Infinity, Infinity, false);
      game.undo();
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  function moveOrderScore(move) {
    let score = 0;
    if (move.captured) {
      // MVV-LVA: Most Valuable Victim - Least Valuable Attacker
      score += PIECE_VALUES[move.captured] * 10 - PIECE_VALUES[move.piece];
    }
    if (move.promotion) score += PIECE_VALUES[move.promotion];
    return score;
  }

  /**
   * Alpha-beta minimax.
   * isMaximizing = true means it's black's turn (AI), false means white's turn.
   * The evaluation function returns a score where positive = good for black.
   */
  function alphaBeta(depth, alpha, beta, isMaximizing) {
    if (depth === 0) {
      return quiescence(alpha, beta, isMaximizing, 4);
    }

    const moves = game.moves({ verbose: true });

    if (moves.length === 0) {
      if (game.in_check()) {
        // Checkmate: bad for the side to move
        return isMaximizing ? -99999 - depth : 99999 + depth;
      }
      return 0; // Stalemate
    }

    // Move ordering
    moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of moves) {
        game.move(move);
        const eval_ = alphaBeta(depth - 1, alpha, beta, false);
        game.undo();
        if (eval_ > maxEval) maxEval = eval_;
        if (eval_ > alpha) alpha = eval_;
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of moves) {
        game.move(move);
        const eval_ = alphaBeta(depth - 1, alpha, beta, true);
        game.undo();
        if (eval_ < minEval) minEval = eval_;
        if (eval_ < beta) beta = eval_;
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  function quiescence(alpha, beta, isMaximizing, depthLeft) {
    const standPat = evaluateAbsolute();

    if (depthLeft === 0) return standPat;

    if (isMaximizing) {
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;

      const captures = game.moves({ verbose: true }).filter(m => m.captured);
      captures.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

      for (const move of captures) {
        game.move(move);
        const score = quiescence(alpha, beta, false, depthLeft - 1);
        game.undo();
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    } else {
      if (standPat <= alpha) return alpha;
      if (standPat < beta) beta = standPat;

      const captures = game.moves({ verbose: true }).filter(m => m.captured);
      captures.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

      for (const move of captures) {
        game.move(move);
        const score = quiescence(alpha, beta, true, depthLeft - 1);
        game.undo();
        if (score <= alpha) return alpha;
        if (score < beta) beta = score;
      }
      return beta;
    }
  }

  /**
   * Absolute evaluation: positive = good for black (AI), negative = good for white.
   */
  function evaluateAbsolute() {
    const board = game.board();
    let score = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;

        const value = PIECE_VALUES[piece.type];
        // PST index: for white pieces, use row as-is; for black, mirror vertically
        const pstIndex = piece.color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
        const pst = PST[piece.type] ? PST[piece.type][pstIndex] : 0;

        if (piece.color === 'b') {
          score += value + pst;
        } else {
          score -= value + pst;
        }
      }
    }

    return score;
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
