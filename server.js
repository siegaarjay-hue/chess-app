/* =========================================================
   Chess AI Backend Worker
   Runs on the VM, handles AI move computation via HTTP API
   ========================================================= */
const express = require('express');
const cors = require('cors');
const { Chess } = require('chess.js');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(__dirname, { index: 'index.html' }));

// ───── Piece values & tables ─────
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

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

// ───── AI Engine ─────
function moveOrderScore(move) {
  let score = 0;
  if (move.captured) {
    score += PIECE_VALUES[move.captured] * 10 - PIECE_VALUES[move.piece];
  }
  if (move.promotion) score += PIECE_VALUES[move.promotion];
  return score;
}

function evaluateAbsolute(game) {
  const board = game.board();
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type];
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

function quiescence(game, alpha, beta, isMaximizing, depthLeft) {
  const standPat = evaluateAbsolute(game);
  if (depthLeft === 0) return standPat;

  if (isMaximizing) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    const captures = game.moves({ verbose: true }).filter(m => m.captured);
    captures.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
    for (const move of captures) {
      game.move(move);
      const score = quiescence(game, alpha, beta, false, depthLeft - 1);
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
      const score = quiescence(game, alpha, beta, true, depthLeft - 1);
      game.undo();
      if (score <= alpha) return alpha;
      if (score < beta) beta = score;
    }
    return beta;
  }
}

function alphaBeta(game, depth, alpha, beta, isMaximizing) {
  if (depth === 0) {
    return quiescence(game, alpha, beta, isMaximizing, 4);
  }

  const moves = game.moves({ verbose: true });
  if (moves.length === 0) {
    if (game.isCheck()) {
      return isMaximizing ? -99999 - depth : 99999 + depth;
    }
    return 0;
  }

  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      game.move(move);
      const eval_ = alphaBeta(game, depth - 1, alpha, beta, false);
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
      const eval_ = alphaBeta(game, depth - 1, alpha, beta, true);
      game.undo();
      if (eval_ < minEval) minEval = eval_;
      if (eval_ < beta) beta = eval_;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function findBestMove(fen, depth) {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;

  let bestScore = -Infinity;
  let bestMove = moves[0];

  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

  for (const move of moves) {
    game.move(move);
    const score = alphaBeta(game, depth - 1, -Infinity, Infinity, false);
    game.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion || undefined };
}

// ───── API Endpoint ─────
app.post('/api/ai-move', (req, res) => {
  const { fen, depth } = req.body;
  if (!fen) {
    return res.status(400).json({ error: 'FEN string required' });
  }

  const searchDepth = Math.min(depth || 3, 5); // Cap at depth 5

  try {
    const start = Date.now();
    const bestMove = findBestMove(fen, searchDepth);
    const elapsed = Date.now() - start;

    if (bestMove) {
      res.json({ move: bestMove, time: elapsed });
    } else {
      res.json({ move: null, time: elapsed });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'chess-ai-worker' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chess AI worker running on port ${PORT}`);
});
